import { expect, test } from "bun:test"
import path from "node:path"
import { rank, rankingTable } from "../src/core/desk/playbooks/sang-loc"
import {
  blindText,
  caseProblems,
  deskIsA,
  judgePrompt,
  loadDeskCases,
  parseJudge,
  projectedRequests,
  runDeskEval,
  summarize,
  type ArmResult,
  type DeskEvalCase,
} from "./helpers/desk-eval"

const root = path.resolve(import.meta.dir, "..")
const arm = (text: string, requests = 5): ArmResult => ({ text, requests, tokens: 100, seconds: 1 })
const score = (n: number) => ({ chinh_xac: n, trich_dan: n, day_du: n, co_so_du_lieu: n })

test("the eval set: ~20 real questions, 5 per playbook, args valid for each playbook", () => {
  const cases = loadDeskCases(root)
  expect(cases.length).toBeGreaterThanOrEqual(20)
  expect(caseProblems(cases)).toEqual([])
  const per = Object.fromEntries(["sang-loc", "kiem-chung", "tranh-bien", "nganh"].map((p) => [p, cases.filter((c) => c.playbook === p).length]))
  expect(per).toEqual({ "sang-loc": 5, "kiem-chung": 5, "tranh-bien": 5, nganh: 5 })
  expect(caseProblems([{ id: 1, playbook: "sang-loc", question: "so sánh FPT", args: { tickers: ["FPT"] } }])).toEqual(["#1: args sai cho sang-loc"])
})

test("the judge sees both answers blind, A/B alternating by case", () => {
  const c: DeskEvalCase = { id: 3, playbook: "sang-loc", question: "Xếp hạng 5 ngân hàng", args: {} }
  const prompt = judgePrompt(c, "ĐÁP-ÁN-A", "ĐÁP-ÁN-B")
  expect(prompt).toContain("<tra_loi_a>\nĐÁP-ÁN-A")
  expect(prompt).not.toMatch(/desk|single|playbook|ultradesk/i)
  expect([1, 2, 3, 4].map(deskIsA)).toEqual([true, false, true, false])
})

test("parseJudge reads a fenced or bare JSON verdict; anything else is no verdict", () => {
  const verdict = { a: score(0.8), b: score(0.5), tot_hon: "a", ly_do: "A có nguồn" }
  expect(parseJudge("```json\n" + JSON.stringify(verdict) + "\n```")?.tot_hon).toBe("a")
  expect(parseJudge(`Kết quả: ${JSON.stringify(verdict)} hết.`)?.b.day_du).toBe(0.5)
  expect(parseJudge("A tốt hơn")).toBeUndefined()
  expect(parseJudge(JSON.stringify({ ...verdict, a: score(1.4) }))).toBeUndefined()
})

test("runDeskEval maps the blind verdict back to desk vs single, skips the judge when an arm failed", async () => {
  const cases: DeskEvalCase[] = [
    { id: 1, playbook: "sang-loc", question: "q1 xếp hạng", args: {} }, // desk is A
    { id: 2, playbook: "sang-loc", question: "q2 xếp hạng", args: {} }, // desk is B
    { id: 3, playbook: "kiem-chung", question: "q3 kiểm tra", args: {} },
  ]
  const prompts: string[] = []
  const rows = await runDeskEval(cases, {
    single: async (c) => (c.id === 3 ? Promise.reject(new Error("429")) : arm(`SINGLE-${c.id}`, 4)),
    desk: async (c) => arm(`DESK-${c.id}`, 30),
    judge: async (prompt) => {
      prompts.push(prompt)
      // The judge always prefers whichever answer says DESK.
      const deskFirst = prompt.indexOf("DESK") < prompt.indexOf("SINGLE")
      return { text: JSON.stringify({ a: score(deskFirst ? 0.9 : 0.4), b: score(deskFirst ? 0.4 : 0.9), tot_hon: deskFirst ? "a" : "b", ly_do: "x" }), requests: 1 }
    },
  })
  expect(prompts).toHaveLength(2)
  expect(prompts[0]!.indexOf("DESK-1")).toBeLessThan(prompts[0]!.indexOf("SINGLE-1"))
  expect(prompts[1]!.indexOf("SINGLE-2")).toBeLessThan(prompts[1]!.indexOf("DESK-2"))
  expect(rows.map((r) => r.winner)).toEqual(["desk", "desk", undefined])
  expect(rows[0]!.scores).toEqual({ desk: 0.9, single: 0.4 })
  expect(rows[2]!.single?.error).toBe("429")
  expect(rows[2]!.reason).toBe("chưa chấm (hạ tầng)")
  const s = summarize(rows)
  expect(s).toMatchObject({ judged: 2, deskWins: 2, singleWins: 0, worth: true, requests: { desk: 90, single: 8, judge: 2 } })
  expect(s.perPlaybook["kiem-chung"]).toMatchObject({ judged: 0, deskRequests: 30, singleRequests: 0 })
})

test("blindText strips what gives the desk away from a real sang-loc result, keeping the substance", () => {
  const card = (ticker: string) => ({
    ticker,
    data_time: "Q2/2026",
    chi_so: { pe: 10, pb: 1.5, roe: 18, tang_truong_lnst: 12, bien_gop: 20, no_vay_von_chu: 0.4, ocf_lnst: 1.1 },
    diem: { chat_luong: 7, dinh_gia: 6, tang_truong: 6, suc_khoe: 7 },
    diem_manh: [],
    rui_ro: [],
    thieu_du_lieu: [],
    nguon: ["vn_fundamentals"],
  })
  const table = rankingTable(rank([card("FPT"), card("MWG")]))
  // What sang-loc returns: the referee's text, then the code-built table under its heading.
  const desk = `Bảng xếp hạng FPT dẫn đầu nhờ ROE 18%.\n\n**Bảng điểm (tính bằng code, để đối chiếu):**\n\n${table}\n\nRun bị cắt trước bước tổng hợp. Chạy tiếp bằng /desk resume dk-abc123`
  const blind = blindText(desk)
  expect(blind).not.toMatch(/tính bằng code|desk resume|Run bị cắt|dk-abc123/)
  expect(blind).toContain("ROE 18%")
  expect(blind).toContain("| 1 | FPT")
  expect(blindText("Theo playbook ultradesk, subagent đã kiểm 5 mã.")).not.toMatch(/playbook|ultradesk|subagent/i)
})

test("an arm that failed or was cut is not judged (infrastructure is not quality); the judge gets both answers blinded", async () => {
  const prompts: string[] = []
  const rows = await runDeskEval(
    [
      { id: 1, playbook: "sang-loc", question: "q1 xếp hạng", args: {} },
      { id: 2, playbook: "sang-loc", question: "q2 xếp hạng", args: {} },
    ],
    {
      single: async (c) => arm(`mặc định ${c.id}`),
      desk: async (c) => (c.id === 1 ? { ...arm("một phần"), error: "run bị cắt (quota)" } : arm("**Bảng điểm (tính bằng code, để đối chiếu):**\n\nbảng ultradesk")),
      judge: async (prompt) => {
        prompts.push(prompt)
        return { text: JSON.stringify({ a: score(0.5), b: score(0.5), tot_hon: "hoa", ly_do: "x" }), requests: 1 }
      },
    },
  )
  expect(rows[0]).toMatchObject({ reason: "chưa chấm (hạ tầng)", judgeRequests: 0 })
  expect(rows[0]!.scores).toBeUndefined()
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).not.toMatch(/tính bằng code|ultradesk/)
  expect(rows[1]!.winner).toBe("tie")
})

test("a reference fact reaches the judge when the case has one", () => {
  const c: DeskEvalCase = { id: 6, playbook: "kiem-chung", question: "Kiểm tra LNST FPT", args: {}, tham_chieu: "LNST FPT 2024: 7.856 tỷ (BCTC kiểm toán)" }
  expect(judgePrompt(c, "a", "b")).toContain("Dữ kiện tham chiếu (đáng tin, dùng để chấm chinh_xac): LNST FPT 2024")
  expect(judgePrompt({ ...c, tham_chieu: undefined }, "a", "b")).not.toContain("tham chiếu")
})

test("worth needs both a clear score gap and a win rate", () => {
  const row = (id: number, desk: number, single: number) => ({
    id,
    playbook: "nganh",
    judgeRequests: 1,
    scores: { desk, single },
    winner: (desk > single ? "desk" : desk < single ? "single" : "tie") as "desk" | "single" | "tie",
  })
  expect(summarize([row(1, 0.8, 0.75), row(2, 0.8, 0.75)]).worth).toBe(false) // gap 0.05
  expect(summarize([row(1, 0.9, 0.5), row(2, 0.4, 0.6), row(3, 0.4, 0.6)]).worth).toBe(false) // 1/3 wins
  expect(summarize([row(1, 0.9, 0.6), row(2, 0.8, 0.6), row(3, 0.5, 0.6)]).worth).toBe(true)
  expect(summarize([]).worth).toBe(false)
})

test("projected requests: the desk estimate per case, ~10 per single answer, 1 per judge", () => {
  const cases = loadDeskCases(root)
  const sangLoc = cases.filter((c) => c.id === 1)
  expect(projectedRequests(sangLoc, { single: true, desk: true }, "small")).toBe(36 + 10 + 1)
  expect(projectedRequests(sangLoc, { single: false, desk: true }, "small")).toBe(36)
  expect(projectedRequests(cases, { single: true, desk: true }, "small")).toBeGreaterThan(500)
})
