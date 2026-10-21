import { readFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import { DESK_SIZES } from "../../src/core/desk/types"
import { PLAYBOOKS } from "../../src/core/desk/playbooks"

/**
 * Ultradesk eval (ADR 0006): does a playbook answer better than one agent, and at what cost?
 * Anthropic's method for its research system: ~20 real questions, an LLM judge with one
 * prompt scoring factual accuracy, citations, completeness and grounding 0–1, small samples
 * first. The two answers are shown blind as A and B; which arm is A alternates by case so
 * position bias averages out. The offline test checks this file; scripts/dev/desk-eval.ts
 * runs the arms and the judge on real models (the user's quota, never the tests).
 */

export const DeskEvalCase = z.object({
  id: z.number().int().positive(),
  playbook: z.string(),
  /** What the user would type; the single agent gets exactly this. */
  question: z.string().min(10),
  /** What desk_run would get for the same question. */
  args: z.record(z.string(), z.unknown()),
  size: z.enum(DESK_SIZES as [string, ...string[]]).optional(),
})
export type DeskEvalCase = z.infer<typeof DeskEvalCase>

export function loadDeskCases(root: string): DeskEvalCase[] {
  const raw = JSON.parse(readFileSync(path.join(root, "test/fixtures/desk-eval/cases.json"), "utf8")) as unknown[]
  return raw.map((c) => DeskEvalCase.parse(c))
}

/** A case's args must be valid for its playbook (the desk arm would refuse them otherwise). */
export function caseProblems(cases: DeskEvalCase[]): string[] {
  const problems: string[] = []
  const ids = new Set<number>()
  for (const c of cases) {
    if (ids.has(c.id)) problems.push(`#${c.id}: id trùng`)
    ids.add(c.id)
    const playbook = PLAYBOOKS.find((p) => p.meta.name === c.playbook)
    if (!playbook) problems.push(`#${c.id}: không có playbook ${c.playbook}`)
    else if (!playbook.meta.args.safeParse(c.args).success) problems.push(`#${c.id}: args sai cho ${c.playbook}`)
  }
  return problems
}

export interface ArmResult {
  text: string
  /** Model requests the arm made (the judge's are counted apart). */
  requests: number
  tokens: number
  seconds: number
  error?: string
}

export const CRITERIA = ["chinh_xac", "trich_dan", "day_du", "co_so_du_lieu"] as const
const Score = z.object(Object.fromEntries(CRITERIA.map((k) => [k, z.number().min(0).max(1)])) as Record<(typeof CRITERIA)[number], z.ZodNumber>)
export const JudgeVerdict = z.object({ a: Score, b: Score, tot_hon: z.enum(["a", "b", "hoa"]), ly_do: z.string() })
export type JudgeVerdict = z.infer<typeof JudgeVerdict>

/** Odd ids show the desk answer as A, even ids as B. */
export const deskIsA = (id: number) => id % 2 === 1

export function judgePrompt(c: DeskEvalCase, a: string, b: string): string {
  return [
    "Bạn chấm hai câu trả lời cho cùng một câu hỏi về chứng khoán Việt Nam. Không biết câu nào do hệ thống nào viết; đừng ưu tiên câu dài hơn hay câu đứng trước.",
    `Câu hỏi: ${c.question}`,
    `<tra_loi_a>\n${a}\n</tra_loi_a>`,
    `<tra_loi_b>\n${b}\n</tra_loi_b>`,
    "Chấm mỗi câu trả lời theo 4 tiêu chí, mỗi tiêu chí từ 0 đến 1:",
    "- chinh_xac: số liệu và nhận định có đúng, nhất quán, không bịa (số không có nguồn mà đáng ngờ thì trừ điểm).",
    "- trich_dan: mỗi số quan trọng có nguồn và thời điểm.",
    "- day_du: trả lời hết câu hỏi, nêu cả rủi ro hoặc phía ngược lại khi câu hỏi cần.",
    "- co_so_du_lieu: kết luận dựa trên dữ liệu đã lấy, không phải ý kiến chung chung; không khuyến nghị mua bán thiếu cơ sở.",
    'Chỉ trả về một khối JSON: {"a":{"chinh_xac":0..1,"trich_dan":0..1,"day_du":0..1,"co_so_du_lieu":0..1},"b":{…},"tot_hon":"a"|"b"|"hoa","ly_do":"một câu"}',
  ].join("\n")
}

/** The judge's JSON, from a fenced block or the first {...}; undefined when it is not valid. */
export function parseJudge(text: string): JudgeVerdict | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1]
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  for (const candidate of [fenced, start >= 0 && end > start ? text.slice(start, end + 1) : undefined]) {
    if (!candidate) continue
    try {
      const parsed = JudgeVerdict.safeParse(JSON.parse(candidate))
      if (parsed.success) return parsed.data
    } catch {
      // try the next candidate
    }
  }
  return undefined
}

export const overall = (s: JudgeVerdict["a"]) => CRITERIA.reduce((n, k) => n + s[k], 0) / CRITERIA.length

export interface Row {
  id: number
  playbook: string
  single?: ArmResult
  desk?: ArmResult
  /** Overall 0–1 per arm, when the judge answered. */
  scores?: { desk: number; single: number }
  winner?: "desk" | "single" | "tie"
  reason?: string
  judgeRequests: number
}

export interface EvalDeps {
  single(c: DeskEvalCase): Promise<ArmResult>
  desk(c: DeskEvalCase): Promise<ArmResult>
  judge(prompt: string): Promise<{ text: string; requests: number }>
  log?(line: string): void
}

const failed = (error: unknown): ArmResult => ({ text: "", requests: 0, tokens: 0, seconds: 0, error: error instanceof Error ? error.message : String(error) })

/** One case at a time (free tiers count requests per minute): single, desk, then the judge. */
export async function runDeskEval(cases: DeskEvalCase[], deps: EvalDeps, arms: { single: boolean; desk: boolean } = { single: true, desk: true }): Promise<Row[]> {
  const rows: Row[] = []
  for (const c of cases) {
    const row: Row = { id: c.id, playbook: c.playbook, judgeRequests: 0 }
    if (arms.single) row.single = await deps.single(c).catch(failed)
    if (arms.desk) row.desk = await deps.desk(c).catch(failed)
    if (row.single?.text && row.desk?.text) {
      const [a, b] = deskIsA(c.id) ? [row.desk.text, row.single.text] : [row.single.text, row.desk.text]
      const judged = await deps.judge(judgePrompt(c, a, b)).catch((e) => ({ text: "", requests: 0, error: e }))
      row.judgeRequests = judged.requests
      const verdict = parseJudge(judged.text)
      if (verdict) {
        const [deskScore, singleScore] = deskIsA(c.id) ? [verdict.a, verdict.b] : [verdict.b, verdict.a]
        row.scores = { desk: overall(deskScore), single: overall(singleScore) }
        const pick = verdict.tot_hon === "hoa" ? "tie" : (verdict.tot_hon === "a") === deskIsA(c.id) ? "desk" : "single"
        row.winner = pick
        row.reason = verdict.ly_do
      } else row.reason = "judge không trả JSON hợp lệ"
    }
    deps.log?.(rowLine(row))
    rows.push(row)
  }
  return rows
}

export function rowLine(r: Row) {
  const arm = (a?: ArmResult) => (!a ? "—" : a.error ? `lỗi: ${a.error.slice(0, 60)}` : `${a.requests} req · ${a.seconds}s`)
  const scores = r.scores ? `desk ${r.scores.desk.toFixed(2)} vs single ${r.scores.single.toFixed(2)} → ${r.winner}` : r.reason ?? "chưa chấm"
  return `#${r.id} ${r.playbook}: single ${arm(r.single)} · desk ${arm(r.desk)} · ${scores}`
}

/** The thresholds ADR 0006 asks for; heuristics, stated so the decision is not made by eye. */
export const WORTH = { minDelta: 0.1, minWinRate: 0.6 }

export interface Summary {
  judged: number
  deskMean: number
  singleMean: number
  deskWins: number
  singleWins: number
  ties: number
  requests: { desk: number; single: number; judge: number }
  perPlaybook: Record<string, { judged: number; deskMean: number; singleMean: number; deskRequests: number; singleRequests: number }>
  worth: boolean
}

export function summarize(rows: Row[]): Summary {
  const judged = rows.filter((r) => r.scores)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const perPlaybook: Summary["perPlaybook"] = {}
  for (const name of [...new Set(rows.map((r) => r.playbook))]) {
    const mine = rows.filter((r) => r.playbook === name)
    const scored = mine.filter((r) => r.scores)
    perPlaybook[name] = {
      judged: scored.length,
      deskMean: mean(scored.map((r) => r.scores!.desk)),
      singleMean: mean(scored.map((r) => r.scores!.single)),
      deskRequests: sum(mine.map((r) => r.desk?.requests ?? 0)),
      singleRequests: sum(mine.map((r) => r.single?.requests ?? 0)),
    }
  }
  const deskMean = mean(judged.map((r) => r.scores!.desk))
  const singleMean = mean(judged.map((r) => r.scores!.single))
  const deskWins = judged.filter((r) => r.winner === "desk").length
  return {
    judged: judged.length,
    deskMean,
    singleMean,
    deskWins,
    singleWins: judged.filter((r) => r.winner === "single").length,
    ties: judged.filter((r) => r.winner === "tie").length,
    requests: { desk: sum(rows.map((r) => r.desk?.requests ?? 0)), single: sum(rows.map((r) => r.single?.requests ?? 0)), judge: sum(rows.map((r) => r.judgeRequests)) },
    perPlaybook,
    worth: judged.length > 0 && deskMean - singleMean >= WORTH.minDelta && deskWins / judged.length >= WORTH.minWinRate,
  }
}

/** Requests the run may spend before it starts: the desk estimate, ~10 per single answer, 1 per judge. */
export function projectedRequests(cases: DeskEvalCase[], arms: { single: boolean; desk: boolean }, defaultSize: string) {
  let n = 0
  for (const c of cases) {
    const playbook = PLAYBOOKS.find((p) => p.meta.name === c.playbook)
    if (arms.desk && playbook) n += playbook.meta.estimate(playbook.meta.args.parse(c.args), (c.size ?? defaultSize) as never).requests
    if (arms.single) n += 10
    if (arms.single && arms.desk) n += 1
  }
  return n
}
