import { beforeEach, expect, test } from "bun:test"
import { PermissionGate } from "../src/core/permission"
import { clearFetchCache, runFetch, webFetchTool, type FetchDeps } from "../src/core/tools/web/fetch"
import { checkUrl, fetchPublic, isPrivateAddress, isPrivateHost } from "../src/core/tools/web/net"
import { clearSearchCache, filterHits, parseDuckDuckGo, planSearch, runSearch, webSearchTool } from "../src/core/tools/web/search"

const signal = () => new AbortController().signal
const publicDns = async () => ["93.184.216.34"]

beforeEach(() => {
  clearFetchCache()
  clearSearchCache()
})

/** A fake web: path → response. */
function site(routes: Record<string, () => Response>) {
  const sent: string[] = []
  const fetchImpl = (async (input: URL) => {
    sent.push(input.href)
    const route = routes[input.href]
    return route ? route() : new Response("not found", { status: 404, statusText: "Not Found" })
  }) as unknown as typeof fetch
  return { sent, deps: { fetch: fetchImpl, resolve: publicDns } satisfies FetchDeps }
}

const html = (body: string, title = "Trang") =>
  new Response(`<!doctype html><html><head><title>${title}</title></head><body><nav>MENU TRÊN</nav><article>${body}</article><footer>CHÂN TRANG</footer></body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  })

test("URLs: http becomes https; credentials, other schemes and bare hosts are refused", () => {
  expect(checkUrl("http://cafef.vn/a").href).toBe("https://cafef.vn/a")
  expect(() => checkUrl("ftp://x.vn/y")).toThrow("http")
  expect(() => checkUrl("https://user:pw@cafef.vn/")).toThrow("tên đăng nhập")
  expect(() => checkUrl("https://intranet/")).toThrow("Tên miền")
  expect(() => checkUrl(`https://a.vn/${"x".repeat(2100)}`)).toThrow("2000")
})

test("private addresses, including CGNAT and v4-mapped v6; look-alike public names are fine", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
    expect(isPrivateAddress(ip)).toBe(true)
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1"]) expect(isPrivateAddress(ip)).toBe(false)
  for (const host of ["localhost", "a.localhost", "printer.local", "[::1]"]) expect(isPrivateHost(host)).toBe(true)
  for (const host of ["cafef.vn", "fd.example.com"]) expect(isPrivateHost(host)).toBe(false)
})

test("a public name resolving to a private IP is refused before any request", async () => {
  const sent: string[] = []
  const f = (async (u: URL) => (sent.push(u.href), new Response("x"))) as unknown as typeof fetch
  await expect(fetchPublic(new URL("https://rebind.example/"), signal(), { fetch: f, resolve: async () => ["10.0.0.5"] })).rejects.toThrow("nội bộ")
  expect(sent).toEqual([])
})

test("same-site redirects are followed; a cross-host redirect is reported to the model, never followed", async () => {
  const { sent, deps } = site({
    "https://cafef.vn/old": () => new Response(null, { status: 301, headers: { location: "https://www.cafef.vn/new" } }),
    "https://www.cafef.vn/new": () => html("<h1>Mới</h1><p>Nội dung</p>"),
    "https://short.link/x": () => new Response(null, { status: 302, headers: { location: "https://other.example/article" } }),
  })
  expect(await runFetch({ url: "https://cafef.vn/old" }, signal(), deps)).toContain("URL: https://www.cafef.vn/new | HTTP 200")
  const out = await runFetch({ url: "https://short.link/x", prompt: "tóm tắt" }, signal(), deps)
  expect(out).toContain("REDIRECT")
  expect(out).toContain('url: "https://other.example/article"')
  expect(out).toContain('prompt: "tóm tắt"')
  expect(sent).not.toContain("https://other.example/article")
})

test("HTML becomes markdown: main content, links and tables kept, menus dropped; cached for the next call", async () => {
  const filler = "Doanh nghiệp công bố kết quả kinh doanh quý ba với nhiều điểm đáng chú ý. ".repeat(12)
  const { sent, deps } = site({
    "https://vietstock.vn/bai": () =>
      html(`<h1>VCB lãi kỷ lục</h1><p>${filler}</p><p>Xem <a href="/chi-tiet">chi tiết</a>.</p><table><tr><th>Quý</th><th>LNST</th></tr><tr><td>Q3</td><td>10.000</td></tr></table>`, "VCB lãi kỷ lục"),
  })
  const out = await runFetch({ url: "https://vietstock.vn/bai" }, signal(), deps)
  expect(out).toContain("Tiêu đề: VCB lãi kỷ lục")
  expect(out).toContain("[chi tiết](https://vietstock.vn/chi-tiet)")
  expect(out).toContain("| Q3 | 10.000 |")
  expect(out).not.toContain("MENU TRÊN")
  expect(await runFetch({ url: "https://vietstock.vn/bai" }, signal(), deps)).toContain("(cache)")
  expect(sent).toHaveLength(1)
})

test("long pages are paged with start_char; prompt sends the page to the side model instead", async () => {
  const long = "Đoạn văn dài về thị trường. ".repeat(4000)
  const { deps } = site({ "https://cafef.vn/dai": () => new Response(long, { headers: { "content-type": "text/plain; charset=utf-8" } }) })
  const first = await runFetch({ url: "https://cafef.vn/dai" }, signal(), deps)
  expect(first).toContain("gọi lại web_fetch với start_char=50000")
  expect(await runFetch({ url: "https://cafef.vn/dai", start_char: 50_000 }, signal(), deps)).toContain("(từ ký tự 50000)")
  let seen = ""
  const asked = await runFetch({ url: "https://cafef.vn/dai", prompt: "điểm chính?" }, signal(), {
    ...deps,
    extract: async (content, prompt) => ((seen = content), `TRẢ LỜI: ${prompt}`),
  })
  expect(asked).toContain("TRẢ LỜI: điểm chính?")
  expect(seen.length).toBeLessThanOrEqual(100_100)
})

test("PDFs are read as text; errors are short and say why", async () => {
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 98>>stream
BT /F1 12 Tf 20 40 Td (Bao cao ket qua kinh doanh quy 3 nam 2026 cua cong ty co phan ABC dat ke hoach) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`
  const { deps } = site({
    "https://hsx.vn/a.pdf": () => new Response(pdf, { headers: { "content-type": "application/pdf" } }),
    "https://hsx.vn/img.png": () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }),
  })
  expect(await runFetch({ url: "https://hsx.vn/a.pdf" }, signal(), deps)).toContain("Bao cao ket qua kinh doanh")
  await expect(runFetch({ url: "https://hsx.vn/missing" }, signal(), deps)).rejects.toThrow("HTTP 404")
  await expect(runFetch({ url: "https://hsx.vn/img.png" }, signal(), deps)).rejects.toThrow("image/png")
}, 20_000)

test("web_fetch asks per domain: Vietnamese sources are exempt, other hosts need the user", async () => {
  const fetchTool = webFetchTool()
  expect(fetchTool.askFor!({ url: "https://cafef.vn/x" })).toBeUndefined()
  expect(fetchTool.askFor!({ url: "https://www.sbv.gov.vn/x" })).toBeUndefined()
  expect(fetchTool.askFor!({ url: "https://evil.example/x?q=secret" })).toBe("domain:evil.example")
  const gate = new PermissionGate({ load: async () => [], save: async () => {} })
  expect((await gate.check(fetchTool, { url: "https://cafef.vn/x" }, signal())).allow).toBe(true)
  // No UI attached: an unknown domain is denied, never fetched silently.
  expect(await gate.check(fetchTool, { url: "https://evil.example/x" }, signal())).toEqual({ allow: false, reason: "headless" })
  const always = new PermissionGate({ load: async () => [{ tool: "web_fetch", scope: "native#domain:evil.example" }], save: async () => {} })
  expect((await always.check(fetchTool, { url: "https://evil.example/y" }, signal())).allow).toBe(true)
  expect((await always.check(fetchTool, { url: "https://other.example/y" }, signal())).allow).toBe(false)
})

test("search plan: presets, domain lists (not both), recency; hits outside the allow list are dropped", () => {
  const plan = planSearch({ query: "lãi suất", preset: "vn_official", recency_days: 7 }, new Date("2026-10-11T00:00:00Z"))
  expect(plan.allowed).toContain("sbv.gov.vn")
  expect(plan.since).toBe("2026-10-04")
  expect(() => planSearch({ query: "x y", allowed_domains: ["a.vn"], blocked_domains: ["b.vn"] })).toThrow("cùng lúc")
  const hits = filterHits(
    [{ url: "https://www.sbv.gov.vn/a" }, { url: "https://spam.example/b" }],
    planSearch({ query: "x y", allowed_domains: ["https://sbv.gov.vn/"] }),
  )
  expect(hits.map((h) => h.url)).toEqual(["https://www.sbv.gov.vn/a"])
})

test("search: provider search first, with numbered sources and the citation reminder; falls back on failure; cached", async () => {
  let nativeCalls = 0
  const out = await runSearch({ query: "VCB lợi nhuận quý 3" }, signal(), {
    native: async () => (nativeCalls++, { backend: "gemini-grounding", text: "VCB lãi 10.000 tỷ.", sources: [{ url: "https://cafef.vn/vcb", title: "VCB lãi lớn" }] }),
    backends: () => [],
  })
  expect(out).toContain("(nguồn: gemini-grounding")
  expect(out).toContain("[1] VCB lãi lớn — cafef.vn")
  expect(out).toContain("Tóm tắt của bộ tìm kiếm: VCB lãi 10.000 tỷ.")
  expect(out).toContain('mục "Nguồn:"')
  expect(await runSearch({ query: "VCB lợi nhuận quý 3" }, signal(), { native: async () => undefined, backends: () => [] })).toContain("lưu trong 5 phút")
  expect(nativeCalls).toBe(1)

  const fallback = await runSearch({ query: "HPG thép" }, signal(), {
    native: async () => {
      throw new Error("model không hỗ trợ")
    },
    backends: () => [
      { name: "exa", run: async () => [] },
      { name: "duckduckgo", run: async () => [{ title: "HPG", url: "https://vneconomy.vn/hpg", snippet: "Thép", date: "2026-10-01" }] },
    ],
  })
  expect(fallback).toContain("(nguồn: duckduckgo")
  expect(fallback).toContain("[1] HPG — vneconomy.vn — 2026-10-01")
  expect(fallback).toContain("đã thử: tìm kiếm của model: model không hỗ trợ; exa: không có kết quả")

  await expect(
    runSearch({ query: "không ra gì" }, signal(), { native: async () => undefined, backends: () => [{ name: "duckduckgo", run: async () => { throw new Error("HTTP 403") } }] }),
  ).rejects.toThrow("duckduckgo: HTTP 403")
})

test("DuckDuckGo results are parsed, entities decoded and redirect links unwrapped; web tools are deferred local tools", () => {
  const page =
    '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcafef.vn%2Fa.html&rut=x">VCB <b>l&#227;i</b> kỷ lục</a>' +
    '<a class="result__snippet" href="#">Ngân hàng &amp; lợi nhuận</a>'
  expect(parseDuckDuckGo(page, 8)).toEqual([{ title: "VCB lãi kỷ lục", url: "https://cafef.vn/a.html", snippet: "Ngân hàng & lợi nhuận" }])
  for (const t of [webSearchTool(), webFetchTool()]) {
    expect(t.readOnly).toBe(true)
    expect(t.deferrable).toBe(true)
    expect(t.source).toBe("local")
  }
})

// --- web_fetch's side model: its own limit, and the page instead of an error (30/10) ---

const article = () => {
  const text = "VCB công bố lợi nhuận quý 3 đạt 10.000 tỷ đồng. ".repeat(20)
  return site({ "https://cafef.vn/vcb": () => new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } }) })
}

test("a side model that times out gives the page and a note, not 'The operation timed out.'", async () => {
  const { deps } = article()
  const out = await runFetch({ url: "https://cafef.vn/vcb", prompt: "lợi nhuận quý 3?" }, signal(), {
    ...deps,
    extract: async () => {
      throw new DOMException("The operation timed out.", "TimeoutError")
    },
  })
  expect(out).toContain("Ghi chú: model phụ không đọc xong trang (quá 90s)")
  expect(out).toContain("VCB công bố lợi nhuận quý 3 đạt 10.000 tỷ đồng.")
  expect(out).not.toContain("timed out")
})

test("an empty or cut side answer says why; a cut one is kept above the page", async () => {
  const { deps } = article()
  const empty = await runFetch({ url: "https://cafef.vn/vcb", prompt: "lợi nhuận quý 3?" }, signal(), {
    ...deps,
    extract: async () => ({ text: "  ", finishReason: "length" }),
  })
  expect(empty).toContain("model phụ không đọc xong trang (không trả lời, finishReason=length)")
  expect(empty).toContain("10.000 tỷ đồng")
  const cut = await runFetch({ url: "https://cafef.vn/vcb", prompt: "lợi nhuận quý 3?" }, signal(), {
    ...deps,
    extract: async () => ({ text: "Lợi nhuận quý 3 là", finishReason: "length" }),
  })
  expect(cut).toContain("câu trả lời bị cắt (finishReason=length)")
  expect(cut.indexOf("Trả lời dở của model phụ:\nLợi nhuận quý 3 là")).toBeGreaterThan(-1)
  expect(cut.indexOf("Lợi nhuận quý 3 là")).toBeLessThan(cut.lastIndexOf("VCB công bố"))
  const ok = await runFetch({ url: "https://cafef.vn/vcb", prompt: "lợi nhuận quý 3?" }, signal(), {
    ...deps,
    extract: async () => ({ text: "10.000 tỷ đồng.", finishReason: "stop" }),
  })
  expect(ok).toEndWith("\n\n10.000 tỷ đồng.")
})

test("the side model's limit fits in what the download left of the call's 125s", async () => {
  const { deps } = article()
  let t = 0
  let called = false
  // The download took 115s: less than 10s would be left, so the side model is skipped.
  const out = await runFetch({ url: "https://cafef.vn/vcb", prompt: "lợi nhuận quý 3?" }, signal(), {
    ...deps,
    now: () => (t += 115_000) - 115_000,
    extract: async () => ((called = true), "không tới đây"),
  })
  expect(called).toBe(false)
  expect(out).toContain("model phụ không đọc xong trang (không còn đủ thời gian sau khi tải trang)")
  expect(out).toContain("10.000 tỷ đồng")
})

test("the user's Esc and the side model's own errors stay errors", async () => {
  const { deps } = article()
  const controller = new AbortController()
  controller.abort()
  await expect(
    runFetch({ url: "https://cafef.vn/vcb", prompt: "x?" }, controller.signal, {
      ...deps,
      extract: async () => {
        throw new DOMException("The operation timed out.", "TimeoutError")
      },
    }),
  ).rejects.toThrow()
  await expect(
    runFetch({ url: "https://cafef.vn/vcb", prompt: "x?" }, signal(), {
      ...deps,
      extract: async () => {
        throw new Error("Hết quota trong ngày. Gọi lại web_fetch không kèm prompt để đọc thẳng nội dung trang.")
      },
    }),
  ).rejects.toThrow("Hết quota")
})

test("a long cut answer beside a long page stays under the tool's 60,000 chars, and start_char stays true", async () => {
  const long = "Đoạn văn dài về thị trường. ".repeat(4000)
  const { deps } = site({ "https://cafef.vn/dai2": () => new Response(long, { headers: { "content-type": "text/plain; charset=utf-8" } }) })
  const partial = "Trả lời rất dài. ".repeat(500)
  const out = await runFetch({ url: "https://cafef.vn/dai2", prompt: "x?" }, signal(), {
    ...deps,
    extract: async () => ({ text: partial, finishReason: "length" }),
  })
  expect(out.length).toBeLessThan(60_000)
  const shown = 50_000 - partial.trim().length
  expect(out).toContain(`start_char=${shown}`)
  expect(long.slice(0, shown).endsWith(out.split("\n\n(còn")[0]!.slice(-50))).toBe(true)
})
