import { expect, test } from "bun:test"
import type { AgentDefinition } from "../src/core/agents/schema"
import { DeskEngine, type AgentStarter } from "../src/core/desk/engine"
import { PLAYBOOKS } from "../src/core/desk/playbooks"
import { CHECK, CLAIMS, kiemChung, tally, type Claim } from "../src/core/desk/playbooks/kiem-chung"
import { rank, SCORECARD, sangLoc, VERDICT, weights, type Scorecard } from "../src/core/desk/playbooks/sang-loc"
import { tranhBien } from "../src/core/desk/playbooks/tranh-bien"
import { GAPS, nganh, SCOPE, sectorSkill } from "../src/core/desk/playbooks/nganh"
import { DESK_SIZES, type DeskRunView, type DeskSize, type Playbook } from "../src/core/desk/types"
import type { StartSpec } from "../src/core/subagents/manager"
import type { SubagentResult } from "../src/core/subagents/types"

const AGENTS: AgentDefinition[] = ["co-ban", "phan-bien", "tong-hop", "tra-cuu", "dinh-gia", "tin-tuc", "ky-thuat", "vi-mo", "bull", "bear", "nganh", "chu-ky-nganh", "tai-san-toan-cau"].map((name) => ({ name, description: name, tools: ["@chi-doc"], body: "", file: `${name}.md`, source: "bundled" }))

const ok = (text: string, data?: unknown): SubagentResult => ({ status: "completed", text, ...(data !== undefined ? { data } : {}), toolCount: 1, usage: { input: 10, output: 5 }, requests: 2, durationMs: 1 })
const fail = (failure: SubagentResult["failure"] = "fatal"): SubagentResult => ({ status: "failed", text: "", error: "lỗi", failure, toolCount: 0, usage: { input: 0, output: 0 }, requests: 1, durationMs: 1 })

function starter(respond: (spec: StartSpec) => SubagentResult) {
  const specs: StartSpec[] = []
  const fake: AgentStarter & { specs: StartSpec[] } = {
    specs,
    start(spec) {
      specs.push(spec)
      return { id: `ag-${specs.length}`, done: Promise.resolve().then(() => respond(spec)) }
    },
  }
  return fake
}

async function runPlaybook(playbook: Playbook, args: unknown, size: DeskSize, respond: (spec: StartSpec) => SubagentResult) {
  const fake = starter(respond)
  const engine = new DeskEngine({ starter: fake, agents: () => AGENTS, playbooks: () => PLAYBOOKS, config: async () => ({ desk: { staggerMs: 0, maxConcurrent: 4 } }) })
  const view = (await (await engine.start(playbook.meta.name, args, { size })).done) as DeskRunView
  return { view, specs: fake.specs }
}

const card = (ticker: string, diem: Scorecard["diem"], chi_so: Partial<Scorecard["chi_so"]> = {}): Scorecard => ({
  ticker,
  data_time: "Q2/2026",
  chi_so: { pe: 10, pb: 1.5, roe: 15, tang_truong_lnst: 10, bien_gop: 20, no_vay_von_chu: 0.5, ocf_lnst: 1, ...chi_so },
  diem,
  diem_manh: [],
  rui_ro: [],
  thieu_du_lieu: [],
  nguon: ["vn_fundamentals"],
})
const flat = (n: number) => ({ chat_luong: n, dinh_gia: n, tang_truong: n, suc_khoe: n })
const tickerIn = (prompt: string) => /mã ([A-Z0-9]{3,5})/.exec(prompt)?.[1] ?? "???"

test("every bundled playbook declares its phases, agent types and an estimate per size; small stays well under the warning", () => {
  expect(PLAYBOOKS.map((p) => p.meta.name)).toEqual(["sang-loc", "kiem-chung", "tranh-bien", "nganh"])
  for (const p of PLAYBOOKS) {
    expect(p.meta.phases.length).toBeGreaterThan(0)
    for (const t of p.meta.agentTypes) expect(AGENTS.some((a) => a.name === t)).toBe(true)
  }
  const many = { tickers: Array.from({ length: 40 }, (_, i) => `M${String(i).padStart(2, "0")}`) }
  const text = { noi_dung: "x".repeat(100) }
  const sizes = (p: Playbook, args: unknown) => Object.fromEntries(DESK_SIZES.map((s) => [s, p.meta.estimate(p.meta.args.parse(args), s)]))
  // The tier table of the plan: agents / max requests.
  expect(sizes(sangLoc, many)).toEqual({
    small: { agents: 6, requests: 36 },
    medium: { agents: 14, requests: 84 },
    large: { agents: 46, requests: 276 },
    unrestricted: { agents: 46, requests: 276 },
  })
  expect(sizes(kiemChung, text)).toEqual({
    small: { agents: 6, requests: 22 },
    medium: { agents: 31, requests: 122 },
    large: { agents: 61, requests: 242 },
    unrestricted: { agents: 61, requests: 242 },
  })
  expect(sizes(tranhBien, { ticker: "FPT" })).toEqual({
    small: { agents: 6, requests: 30 },
    medium: { agents: 10, requests: 50 },
    large: { agents: 18, requests: 92 },
    unrestricted: { agents: 18, requests: 92 },
  })
  expect(sizes(nganh, { nganh: "thép" })).toEqual({
    small: { agents: 7, requests: 40 },
    medium: { agents: 14, requests: 79 },
    large: { agents: 22, requests: 157 },
    unrestricted: { agents: 22, requests: 157 },
  })
  for (const p of PLAYBOOKS) {
    const args = p === sangLoc ? many : p === kiemChung ? text : p === tranhBien ? { ticker: "FPT" } : { nganh: "thép" }
    expect(p.meta.estimate(p.meta.args.parse(args), "small").requests).toBeLessThanOrEqual(40)
  }
  // Fewer tickers than the tier: fewer agents.
  expect(sangLoc.meta.estimate(sangLoc.meta.args.parse({ tickers: ["FPT", "MWG"] }), "medium")).toEqual({ agents: 5, requests: 30 })
})

test("sang-loc args: tickers are normalised and deduplicated; one ticker is refused", () => {
  const args = sangLoc.meta.args.parse({ tickers: [" fpt", "MWG", "FPT"] })
  expect(args.tickers).toEqual(["FPT", "MWG", "FPT"])
  expect(sangLoc.meta.summarize!(args)).toBe("2 mã: FPT, MWG")
  expect(sangLoc.meta.args.safeParse({ tickers: ["FPT"] }).success).toBe(false)
  expect(sangLoc.meta.args.safeParse({ tickers: ["FPT", "Ngân hàng"] }).success).toBe(false)
})

test("rank: weights follow the criteria; a few tickers rank by the weighted card, many blend in z-scores", () => {
  expect(weights("định giá rẻ, nợ thấp")).toEqual({ chat_luong: 1, dinh_gia: 2, tang_truong: 1, suc_khoe: 2 })
  const cheap = card("AAA", { chat_luong: 4, dinh_gia: 9, tang_truong: 5, suc_khoe: 5 })
  const quality = card("BBB", { chat_luong: 9, dinh_gia: 4, tang_truong: 5, suc_khoe: 5 })
  expect(rank([cheap, quality], "định giá rẻ").map((r) => r.card.ticker)).toEqual(["AAA", "BBB"])
  expect(rank([cheap, quality], "chất lượng").map((r) => r.card.ticker)).toEqual(["BBB", "AAA"])
  // 12 tickers with equal cards: the raw ratios decide (higher ROE, lower P/E first).
  const many = Array.from({ length: 12 }, (_, i) => card(`T${String(i).padStart(2, "0")}`, flat(5), { roe: 5 + i, pe: 30 - i }))
  expect(rank(many)[0]!.card.ticker).toBe("T11")
  expect(rank(many).at(-1)!.card.ticker).toBe("T00")
})

test("sang-loc medium: scorecards in parallel, refuters move a ticker down, the referee writes, code keeps the table", async () => {
  const scores: Record<string, number> = { FPT: 8, MWG: 7, HPG: 6, VNM: 5 }
  const { view, specs } = await runPlaybook(sangLoc, { tickers: ["fpt", "MWG", "HPG", "VNM", "XXX"], tieu_chi: "chất lượng" }, "medium", (spec) => {
    if (spec.schema === SCORECARD) {
      const t = tickerIn(spec.prompt)
      if (t === "XXX") return fail()
      return ok("", card(t, flat(scores[t]!)))
    }
    if (spec.schema === VERDICT) {
      // FPT's numbers do not hold up: refuted and marked down by 3.
      const refuted = spec.prompt.includes("mã FPT")
      return ok("", { giu_nguyen: !refuted, dieu_chinh: refuted ? -3 : 0, so_lieu_sai: refuted ? ["ROE 12% chứ không phải 25% (Q2/2026)"] : [], ly_do: "kiểm" })
    }
    return ok("BÁO CÁO TỔNG HỢP")
  })
  expect(view.status).toBe("done")
  const types = specs.map((s) => s.type)
  expect(types.filter((t) => t === "co-ban")).toHaveLength(5)
  expect(types.filter((t) => t === "phan-bien")).toHaveLength(3) // top 3 × 1 vote
  expect(types.filter((t) => t === "tong-hop")).toHaveLength(1)
  expect(specs.find((s) => s.type === "co-ban")).toMatchObject({ effort: "low", maxSteps: 6 })
  expect(specs.find((s) => s.type === "phan-bien")).toMatchObject({ effort: "high" })
  const result = String(view.result)
  expect(result).toContain("BÁO CÁO TỔNG HỢP")
  // FPT fell from first (8) to below MWG (7) after the refuters' −3.
  const order = [...result.matchAll(/^\| \d+ \| ([A-Z]{3})/gm)].map((m) => m[1])
  expect(order).toEqual(["MWG", "HPG", "FPT", "VNM"])
  expect(result).toContain("bị phản biện (1/1): ROE 12%")
  expect(view.logs.some((l) => l.includes("Không lấy được thẻ điểm: XXX"))).toBe(true)
  // The referee sees the cards as framed evidence, and is told the ranking is done.
  const referee = specs.find((s) => s.type === "tong-hop")!.prompt
  expect(referee).toContain("<bang_chung")
  expect(referee).toContain("không xếp lại")
  expect(referee).toContain("Không khuyến nghị mua, bán")
})

test("sang-loc small: more tickers than the tier are cut with a log line, no refuters", async () => {
  const { view, specs } = await runPlaybook(sangLoc, { tickers: ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG"] }, "small", (spec) =>
    spec.schema === SCORECARD ? ok("", card(tickerIn(spec.prompt), flat(5))) : ok("tổng hợp"),
  )
  expect(specs.filter((s) => s.type === "co-ban")).toHaveLength(5)
  expect(specs.some((s) => s.type === "phan-bien")).toBe(false)
  expect(view.logs.some((l) => l.includes("bỏ 2: FFF, GGG"))).toBe(true)
})

test("sang-loc: too few scorecards ends early with a resumable note, no referee", async () => {
  const { view, specs } = await runPlaybook(sangLoc, { tickers: ["AAA", "BBB", "CCC"] }, "small", (spec) =>
    spec.schema === SCORECARD && tickerIn(spec.prompt) === "AAA" ? ok("", card("AAA", flat(5))) : fail(),
  )
  expect(String(view.result)).toContain("Không đủ dữ liệu")
  expect(specs.some((s) => s.type === "tong-hop")).toBe(false)
})

test("tally: majority of the votes; no valid vote is unchecked, never wrong", () => {
  const v = (ket_luan: "dung" | "sai" | "khong_kiem_duoc") => ({ ket_luan, giai_thich: "" })
  expect(tally([v("sai")]).outcome).toBe("sai")
  expect(tally([v("sai"), v("sai"), v("dung")]).outcome).toBe("sai")
  expect(tally([v("sai"), v("dung"), null]).outcome).toBe("chua_kiem_chung")
  expect(tally([v("dung"), v("dung"), null]).outcome).toBe("dung")
  expect(tally([null, null, null])).toMatchObject({ outcome: "chua_kiem_chung", valid: 0, errored: 3 })
  expect(tally([v("khong_kiem_duoc")]).outcome).toBe("chua_kiem_chung")
})

test("kiem-chung medium: claims by importance, three lenses per claim, wrong vs unchecked kept apart", async () => {
  const claims: Claim[] = [
    { ma: "FPT", chi_tieu: "P/E", gia_tri: "18 lần", nguyen_van: "P/E 18", muc_quan_trong: "thap" },
    { ma: "FPT", chi_tieu: "LNST Q2", gia_tri: "2.100 tỷ", ky: "Q2/2026", nguyen_van: "LNST 2.100 tỷ", muc_quan_trong: "cao" },
    { ma: "MWG", chi_tieu: "ROE", gia_tri: "25%", nguyen_van: "ROE 25%", muc_quan_trong: "vua" },
  ]
  const { view, specs } = await runPlaybook(kiemChung, { noi_dung: "FPT lãi 2.100 tỷ quý 2, P/E 18; MWG ROE 25%. ".repeat(2) }, "medium", (spec) => {
    if (spec.schema === CLAIMS) return ok("", { claims })
    if (spec.schema === CHECK) {
      if (spec.prompt.includes('"chi_tieu":"ROE"')) return fail("daily-quota")
      if (spec.prompt.includes('"chi_tieu":"P/E"')) return ok("", { ket_luan: spec.prompt.includes("kỳ và đơn vị") ? "dung" : "sai", gia_tri_tim_thay: "24 lần", nguon: "vn_fundamentals", giai_thich: "P/E là 24" })
      return ok("", { ket_luan: "dung", gia_tri_tim_thay: "2.098 tỷ", nguon: "financial_statements", thoi_diem: "Q2/2026", giai_thich: "khớp" })
    }
    return ok("?")
  })
  const checks = specs.filter((s) => s.schema === CHECK)
  // The quota cut stops agents that had not started yet: at least the first claim got its 3 lenses.
  expect(checks.slice(0, 3).map((s) => (s.prompt.includes("số liệu gốc") ? 0 : s.prompt.includes("kỳ và đơn vị") ? 1 : 2))).toEqual([0, 1, 2])
  expect(checks[0]!.prompt).toContain("LNST Q2")
  const result = String(view.result)
  expect(result).toContain("✓ đúng")
  expect(result).toContain("? chưa kiểm chứng")
  expect(result).toMatch(/không phải kết luận "sai"/)
  expect(view.cut).toBe("quota")
})

test("kiem-chung: the text reaches the extractor framed as evidence; nothing to check ends quietly", async () => {
  const { view, specs } = await runPlaybook(kiemChung, { noi_dung: "Thị trường có thể hồi phục trong ngắn hạn theo nhận định của tôi." }, "small", () => ok("", { claims: [] }))
  expect(specs[0]!.prompt).toContain("<bang_chung")
  expect(specs[0]!).toMatchObject({ type: "tra-cuu", maxSteps: 2, effort: "low" })
  expect(String(view.result)).toContain("Không tìm thấy khẳng định")
})

test("deterministic: each playbook makes the same agent calls on the same answers", async () => {
  const respond = (spec: StartSpec) =>
    spec.schema === SCORECARD
      ? ok("", card(tickerIn(spec.prompt), flat(6)))
      : spec.schema === VERDICT
        ? ok("", { giu_nguyen: true, dieu_chinh: 0, so_lieu_sai: [], ly_do: "" })
        : spec.schema === CLAIMS
          ? ok("", { claims: [{ chi_tieu: "ROE", gia_tri: "20%", nguyen_van: "ROE 20%", muc_quan_trong: "cao" }] })
          : spec.schema === CHECK
            ? ok("", { ket_luan: "dung", giai_thich: "" })
            : ok("báo cáo")
  for (const [p, args] of [
    [sangLoc, { tickers: ["FPT", "MWG", "HPG", "VNM"] }],
    [kiemChung, { noi_dung: "VNM ROE 20% năm 2025, cao nhất ngành sữa." }],
  ] as const) {
    const keys = async () => (await runPlaybook(p as Playbook, args, "large", respond)).view.agents.map((a) => a.key).sort()
    expect(await keys()).toEqual(await keys())
  }
})

test("sector names map to the sector skills of #116 (accents, wording); unknown sectors get none", () => {
  expect(sectorSkill("Ngân hàng")).toBe("ngan-hang-vn")
  expect(sectorSkill("nhóm thép")).toBe("thep-vn")
  expect(sectorSkill("BĐS khu công nghiệp")).toBe("bat-dong-san-vn")
  expect(sectorSkill("điện")).toBe("dien-luc-vn")
  expect(sectorSkill("bán lẻ điện thoại")).toBe("tieu-dung-ban-le-vn")
  expect(sectorSkill("cảng biển")).toBe("van-tai-vn")
  expect(sectorSkill("hàng không")).toBe("van-tai-vn")
  expect(sectorSkill("phân bón")).toBe("hoa-chat-vn")
  expect(sectorSkill("ngành gì đó")).toBeUndefined()
})

const debateRespond = (spec: StartSpec): SubagentResult => {
  if (spec.schema === CLAIMS) return ok("", { claims: [{ ma: "FPT", chi_tieu: "LNST", gia_tri: "2.100 tỷ", nguyen_van: "LNST 2.100 tỷ", muc_quan_trong: "cao" }] })
  if (spec.schema === CHECK) return ok("", { ket_luan: "sai", gia_tri_tim_thay: "1.900 tỷ", nguon: "financial_statements", giai_thich: "lệch" })
  if (spec.type === "bull" || spec.type === "bear") return ok(`${spec.type.toUpperCase()}: ${spec.description} — LNST 2.100 tỷ, P/E 18 lần (Q2/2026)`)
  if (spec.type === "tong-hop") return ok("PHÁN QUYẾT TRỌNG TÀI")
  return ok(`Báo cáo ${spec.type}: LNST 2.100 tỷ (Q2/2026)`)
}

test("tranh-bien medium: 5 analysts, bull and bear open then rebut once, the referee gets everything framed", async () => {
  const { view, specs } = await runPlaybook(tranhBien, { ticker: "fpt", cau_hoi: "có nên giữ qua quý 3" }, "medium", debateRespond)
  expect(view.status).toBe("done")
  expect(specs.filter((s) => ["co-ban", "dinh-gia", "tin-tuc", "ky-thuat", "vi-mo"].includes(s.type!))).toHaveLength(5)
  expect(specs.filter((s) => s.type === "bull").map((s) => s.description)).toEqual(["bull mở màn FPT", "bull vòng 1"])
  expect(specs.filter((s) => s.type === "bear")).toHaveLength(2)
  // A rebuttal quotes the other side's last argument as evidence.
  const rebut = specs.find((s) => s.description === "bear vòng 1")!.prompt
  expect(rebut).toContain("BULL: bull mở màn FPT")
  expect(rebut).toContain("<bang_chung")
  const judge = specs.find((s) => s.type === "tong-hop")!.prompt
  expect(judge).toContain("Báo cáo vi-mo")
  expect(judge).toContain("BEAR: bear vòng 1")
  expect(judge).toContain("Không khuyến nghị mua, bán, giữ")
  expect(String(view.result)).toBe("PHÁN QUYẾT TRỌNG TÀI")
  expect(view.counters.agents).toBe(tranhBien.meta.estimate(tranhBien.meta.args.parse({ ticker: "FPT" }), "medium").agents)
})

test("tranh-bien large: the debaters' numbers go through kiem-chung at the small tier, inside the same run", async () => {
  const { view, specs } = await runPlaybook(tranhBien, { ticker: "FPT" }, "large", debateRespond)
  expect(specs.filter((s) => s.type === "bull")).toHaveLength(3)
  expect(specs.filter((s) => s.schema === CLAIMS)).toHaveLength(1)
  // Small tier: one voter per claim.
  expect(specs.filter((s) => s.schema === CHECK)).toHaveLength(1)
  expect(view.agents.some((a) => a.phase.startsWith("kiem-chung › "))).toBe(true)
  expect(specs.find((s) => s.type === "tong-hop")!.prompt).toContain("kiểm chứng số liệu")
  expect(String(view.result)).toContain("✘ sai")
  expect(view.counters.agents).toBeLessThanOrEqual(tranhBien.meta.estimate(tranhBien.meta.args.parse({ ticker: "FPT" }), "large").agents)
})

test("tranh-bien: a failed analyst is logged and named to the referee; no report at all ends early", async () => {
  const partial = await runPlaybook(tranhBien, { ticker: "FPT" }, "small", (spec) => (spec.type === "tin-tuc" ? fail() : debateRespond(spec)))
  expect(partial.view.logs.some((l) => l.includes("Thiếu báo cáo: tin-tuc"))).toBe(true)
  expect(partial.specs.find((s) => s.type === "tong-hop")!.prompt).toContain("thiếu báo cáo tin-tuc")
  const none = await runPlaybook(tranhBien, { ticker: "FPT" }, "small", () => fail())
  expect(String(none.view.result)).toContain("Không lấy được báo cáo nào")
  expect(none.specs.some((s) => s.type === "bull")).toBe(false)
})

const sectorRespond =
  (scope: { ma: string }[], gaps: { cau_hoi: string }[] = []) =>
  (spec: StartSpec): SubagentResult => {
    if (spec.schema === SCOPE) return ok("", { nganh: "Thép", doanh_nghiep: scope, dong_luc: ["giá quặng", "đầu tư công"], chi_tieu_nganh: ["giá bán HRC", "sản lượng tiêu thụ"] })
    if (spec.schema === SCORECARD) return ok("", card(tickerIn(spec.prompt), flat(tickerIn(spec.prompt) === "HPG" ? 8 : 5)))
    if (spec.schema === GAPS) return ok("", { thieu: gaps })
    if (spec.type === "tong-hop") return ok("BÁO CÁO NGÀNH")
    return ok(`Báo cáo ${spec.type}: thép (Q2/2026)`)
  }

test("nganh small: scope picks the companies (cut to the tier) and the sector metrics, themes and scorecards run together", async () => {
  const { view, specs } = await runPlaybook(nganh, { nganh: "thép" }, "small", sectorRespond([{ ma: "hpg" }, { ma: "HSG" }, { ma: "NKG" }, { ma: "TLH" }, { ma: "SMC" }]))
  expect(view.status).toBe("done")
  expect(specs.filter((s) => s.schema === SCORECARD).map((s) => tickerIn(s.prompt))).toEqual(["HPG", "HSG", "NKG"])
  expect(view.logs.some((l) => l.includes("bỏ 2: TLH, SMC"))).toBe(true)
  expect(view.logs).toContain("Skill ngành: thep-vn")
  // The sector skill is loaded once, by the scope agent; the companies get its metrics.
  expect(specs.find((s) => s.schema === SCOPE)!.prompt).toContain("Nạp skill thep-vn")
  const cardText = specs.find((s) => s.schema === SCORECARD)!.prompt
  expect(cardText).toContain("giá bán HRC, sản lượng tiêu thụ")
  expect(cardText).not.toContain("load_skill")
  expect(specs.filter((s) => s.type === "chu-ky-nganh" || s.type === "vi-mo")).toHaveLength(2)
  expect(specs.some((s) => s.schema === GAPS)).toBe(false)
  const result = String(view.result)
  expect(result).toContain("BÁO CÁO NGÀNH")
  expect([...result.matchAll(/^\| \d+ \| ([A-Z]{3})/gm)].map((m) => m[1])[0]).toBe("HPG")
  expect(view.agents.filter((a) => a.phase === "Bối cảnh")).toHaveLength(2)
  expect(view.agents.filter((a) => a.phase === "Doanh nghiệp")).toHaveLength(3)
})

test("nganh medium: the user's tickers win over the scope; the critic's gaps get one extra round", async () => {
  const { view, specs } = await runPlaybook(
    nganh,
    { nganh: "ngân hàng", tickers: ["VCB", "TCB"], cau_hoi: "NIM có cải thiện không" },
    "medium",
    sectorRespond([{ ma: "BID" }], [{ cau_hoi: "NIM quý 2 của TCB là bao nhiêu?" }, { cau_hoi: "Tín dụng toàn ngành tăng bao nhiêu?" }]),
  )
  expect(specs.find((s) => s.schema === SCOPE)!.prompt).toContain("VCB, TCB")
  expect(specs.filter((s) => s.schema === SCORECARD).map((s) => tickerIn(s.prompt))).toEqual(["VCB", "TCB"])
  expect(specs.filter((s) => s.type === "tai-san-toan-cau")).toHaveLength(1)
  const extra = specs.filter((s) => s.type === "tra-cuu")
  expect(extra).toHaveLength(2)
  expect(extra[0]!.prompt).toContain("NIM quý 2 của TCB")
  expect(specs.find((s) => s.type === "tong-hop")!.prompt).toContain("Tín dụng toàn ngành tăng bao nhiêu?")
  expect(view.counters.agents).toBeLessThanOrEqual(nganh.meta.estimate(nganh.meta.args.parse({ nganh: "ngân hàng", tickers: ["VCB", "TCB"] }), "medium").agents)
})

test("nganh: no company found ends early with advice", async () => {
  const { view } = await runPlaybook(nganh, { nganh: "ngành lạ" }, "small", sectorRespond([]))
  expect(String(view.result)).toContain("Không xác định được doanh nghiệp")
})

test("deterministic: tranh-bien and nganh make the same agent calls on the same answers", async () => {
  for (const [p, args, respond] of [
    [tranhBien, { ticker: "FPT" }, debateRespond],
    [nganh, { nganh: "thép" }, sectorRespond([{ ma: "HPG" }, { ma: "HSG" }, { ma: "NKG" }], [{ cau_hoi: "giá HRC?" }])],
  ] as const) {
    const keys = async () => (await runPlaybook(p as Playbook, args, "large", respond)).view.agents.map((a) => a.key).sort()
    expect(await keys()).toEqual(await keys())
  }
})
