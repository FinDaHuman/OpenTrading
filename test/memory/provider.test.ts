import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { HookBus } from "../../src/core/hooks"
import { loadInstruments, TickerIndex } from "../../src/core/market/tickers"
import { type Clock, createMemoryProvider, createMemoryService, type IdFactory } from "../../src/core/memory"
import { loadRules } from "../../src/core/rules/load"

const clock: Clock = { now: () => new Date("2026-09-30T03:00:00.000Z") }
function counterIds(): IdFactory {
  let n = 0
  return { next: () => `0190a000-0000-7000-8000-${String(++n).padStart(12, "0")}` }
}
const opened: Database[] = []
afterEach(() => {
  while (opened.length) opened.pop()!.close()
})
function setup(config: unknown = {}) {
  const db = new Database(":memory:")
  opened.push(db)
  const service = createMemoryService(db, {
    config,
    clock,
    ids: counterIds(),
    salt: "t",
    tickers: new TickerIndex(loadInstruments()),
    rules: () => loadRules(),
  })
  const provider = createMemoryProvider(service, { config, now: clock.now })
  const hooks = new HookBus()
  const off = provider.register!(hooks) as () => void
  const prompt = (text: string, sessionId = "s1") => hooks.emit({ type: "user-prompt", sessionId, prompt: text })
  const ctx = { sessionId: "s1" }
  return { db, service, provider, hooks, off, prompt, ctx }
}
const ctx = { signal: new AbortController().signal, callId: "c" }

describe("commands typed in chat (user-prompt hook)", () => {
  test('"Ghi nhớ: …" saves an active profile and lets the model acknowledge it', async () => {
    const m = setup()
    const out = await m.prompt("Ghi nhớ: Tôi không sử dụng margin")
    expect(out.block).toBeUndefined()
    expect(out.context[0]).toContain("#000001")
    expect(out.context[0]).not.toContain("margin") // the reminder is stored in history: no memory text in it
    expect(await m.provider.list!()).toMatchObject([
      { status: "active", text: "[hồ sơ] Tôi không sử dụng margin", source: { via: "user" } },
    ])
  })

  test("rejected content is blocked before the model and never stored", async () => {
    const m = setup()
    const out = await m.prompt("Ghi nhớ: giá vốn HPG 25.000 đ")
    expect(out.block).toContain("Không lưu")
    expect(out.block).not.toContain("25.000")
    const again = await m.prompt("Xác nhận ghi nhớ: giá vốn HPG 25.000 đ")
    expect(again.block).toContain("Không lưu")
    expect(await m.provider.list!()).toEqual([])
  })

  test("ambiguous content asks for confirmation; the confirm form stores it", async () => {
    const m = setup()
    const out = await m.prompt("Ghi nhớ: không vượt 20% danh mục cho một mã")
    expect(out.block).toContain("Xác nhận ghi nhớ: không vượt 20% danh mục cho một mã")
    expect(await m.provider.list!()).toEqual([])
    expect((await m.prompt("Xác nhận ghi nhớ: không vượt 20% danh mục cho một mã")).block).toBeUndefined()
    expect((await m.provider.list!()).map((i) => i.text)).toEqual(["[hồ sơ] không vượt 20% danh mục cho một mã"])
  })

  test('"Ghi chú VCB đến …: …" stores a dated note; unknown codes are refused', async () => {
    const m = setup()
    expect((await m.prompt("Ghi chú VCB đến 2026-12-31: Chờ kết quả ĐHCĐ")).block).toBeUndefined()
    expect((await m.provider.list!()).map((i) => i.text)).toEqual(["[ghi chú VCB] Chờ kết quả ĐHCĐ (đến 2026-12-31)"])
    expect((await m.prompt("Ghi chú XYZ: abc")).block).toContain("không có mã")
  })

  test('"Góp ý: …" rates the last answer and proposes a lesson that waits in /memory', async () => {
    const m = setup()
    await m.prompt("Ghi nhớ: Tôi không sử dụng margin")
    await m.provider.recall!("Phân tích VCB", m.ctx)
    await m.hooks.emit({ type: "turn-end", sessionId: "s1", messages: [] })
    const out = await m.prompt("Góp ý: Báo cáo cần nêu rủi ro tỷ giá khi phân tích")
    expect(out.block).toContain("chờ duyệt trong /memory")
    const pending = (await m.provider.list!()).find((i) => i.status === "pending")!
    expect(pending).toMatchObject({
      text: "[bài học] Báo cáo cần nêu rủi ro tỷ giá khi phân tích",
      source: { via: "model" },
    })
    expect(await m.provider.index!(m.ctx)).not.toContain("tỷ giá")
    await m.provider.approve!(pending.id)
    expect(await m.provider.index!({ sessionId: "other" })).toContain("rủi ro tỷ giá")
  })

  test('"Focus: …" sets or clears the instruments; ordinary questions pass through untouched', async () => {
    const m = setup()
    expect((await m.prompt("Focus: VCB HPG")).block).toBe("Đang theo dõi: HPG, VCB.")
    expect((await m.prompt("focus clear")).block).toBe("Không theo dõi mã nào.")
    const plain = await m.prompt("giá FPT hôm nay?")
    expect(plain.block).toBeUndefined()
    expect(plain.context).toEqual([])
  })
})

describe("index and recall", () => {
  test("content goes through index(); recall() returns references only", async () => {
    const m = setup()
    await m.prompt("Ghi nhớ: Tôi không sử dụng margin")
    await m.prompt("Ghi chú VCB: Chờ kết quả ĐHCĐ")
    const refs = await m.provider.recall!("Phân tích VCB", m.ctx)
    const texts = refs.map((r) => r.text)
    expect(texts).toEqual(["rule nguon-so-lieu", "rule ngan-hang", "memory #000001", "memory #000002"])
    expect(texts.join(" ")).not.toContain("margin")
    const index = (await m.provider.index!(m.ctx))!
    expect(index).toContain("Tôi không sử dụng margin")
    expect(index).toContain("Chờ kết quả ĐHCĐ")
    expect(index).toContain(`<rule name="ngan-hang">`)
  })

  test("the index fits the smallest tier by default and respects a larger budget when given", async () => {
    const m = setup()
    for (let i = 0; i < 12; i++)
      await m.prompt(`Ghi nhớ: Sở thích trình bày thứ ${"abcdefghijkl"[i]} cho báo cáo dài hạn`)
    await m.provider.recall!("x", m.ctx)
    const small = (await m.provider.index!(m.ctx))!
    expect(small.length).toBeLessThanOrEqual(1200)
    expect(small.trimEnd().endsWith("</memory_context>")).toBe(true) // never cut mid-item
    const refs = await m.provider.recall!("x", { sessionId: "s1", maxChars: 4000 } as never)
    expect(refs[0]!.text).not.toContain("⚠")
    expect((await m.provider.index!({ sessionId: "s1", maxChars: 4000 } as never))!.length).toBeGreaterThan(
      small.length,
    )
  })

  test("warnings surface as ⚠ items so the harness shows them", async () => {
    const m = setup()
    for (let i = 0; i < 12; i++)
      await m.prompt(`Ghi nhớ: Sở thích trình bày thứ ${"abcdefghijkl"[i]} cho báo cáo dài hạn`)
    const refs = await m.provider.recall!("x", m.ctx)
    expect(refs[0]!.text).toStartWith("⚠")
    m.db.close()
    const broken = await m.provider.recall!("x", m.ctx)
    expect(broken.map((r) => r.text).join(" ")).toContain("Không đọc được memory")
  })

  test("pending items never reach index() or recall()", async () => {
    const m = setup()
    await m.service.system.propose({ body: "Luôn nêu rủi ro thanh khoản", origin: "feedback" })
    await m.provider.recall!("thanh khoản", m.ctx)
    expect((await m.provider.index!(m.ctx)) ?? "").not.toContain("thanh khoản")
  })
})

describe("tools and management", () => {
  test("the model gets read-only search_memory and load_rule, and no write tool", async () => {
    const m = setup()
    await m.prompt("Ghi nhớ: Báo cáo ngân hàng cần tỷ lệ bao phủ nợ xấu")
    const tools = m.provider.tools!()
    expect(tools.map((t) => [t.name, t.readOnly])).toEqual([
      ["search_memory", true],
      ["load_rule", true],
    ])
    const search = tools[0]!
    expect(await search.execute({ query: "bao phu no xau" }, ctx)).toContain("tỷ lệ bao phủ nợ xấu")
    expect(await search.execute({ query: "zzz" }, ctx)).toBe("Không tìm thấy memory nào khớp.")
    expect(await tools[1]!.execute({ name: "phai-sinh" }, ctx)).toContain("VN30F1M")
  })

  test("remove purges; reject erases a proposal", async () => {
    const m = setup()
    await m.prompt("Ghi nhớ: Tôi không sử dụng margin")
    const [item] = await m.provider.list!()
    await m.provider.remove!(item!.id)
    expect(await m.provider.list!()).toEqual([])
    const p = await m.service.system.propose({ body: "Luôn nêu rủi ro", origin: "feedback" })
    await m.provider.reject!(p.ok ? p.item.id : "")
    expect(await m.provider.list!()).toEqual([])
  })

  test("unregistering removes the hooks (switching provider at runtime)", async () => {
    const m = setup()
    m.off()
    await m.prompt("Ghi nhớ: A")
    expect(await m.provider.list!()).toEqual([])
  })

  test("works as the runtime's memory: tools registered, hooks attached, swapped out cleanly", async () => {
    const { initRuntime, switchMemory } = await import("../../src/core/runtime")
    const { NoopMemory } = await import("../../src/core/memory/types")
    const m = setup()
    m.off()
    const runtime = initRuntime({ skills: () => [], memory: m.provider })
    expect(runtime.registry.get("search_memory")).toBeDefined()
    expect(runtime.registry.get("propose_memory")).toBeUndefined()
    expect(
      (await runtime.hooks.emit({ type: "user-prompt", sessionId: "s", prompt: "Ghi nhớ: A rất quan trọng" })).block,
    ).toBeUndefined()
    switchMemory(runtime, new NoopMemory())
    expect(runtime.registry.get("search_memory")).toBeUndefined()
    await runtime.hooks.emit({ type: "user-prompt", sessionId: "s", prompt: "Ghi nhớ: B" })
    expect((await m.provider.list!()).map((i) => i.text)).toEqual(["[hồ sơ] A rất quan trọng"])
  })
})
