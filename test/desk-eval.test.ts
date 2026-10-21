import { expect, test } from "bun:test"
import path from "node:path"
import {
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
  const s = summarize(rows)
  expect(s).toMatchObject({ judged: 2, deskWins: 2, singleWins: 0, worth: true, requests: { desk: 90, single: 8, judge: 2 } })
  expect(s.perPlaybook["kiem-chung"]).toMatchObject({ judged: 0, deskRequests: 30, singleRequests: 0 })
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
