import { z } from "zod"
import { REPLAY_MISS } from "./cassette"
import { answerFigures, plainValues, sourceNumbers, thousandDongPrices, tracesTo, wrongDong, type Figure } from "../../src/core/loop/figures"
import type { Attempt, Trace } from "./read-trace"

const EXPECTED = z.discriminatedUnion("kind", [
  /**
   * One value, in plain units (2.5e9 for "2,5 tỷ"), within `tolerance_pct`. Any figure of the
   * answer counts, so a table holds it by chance; `line_has` limits it to lines with this text.
   */
  z.object({ kind: z.literal("number"), value: z.number(), tolerance_pct: z.number().min(0), line_has: z.string().optional() }),
  /** Names that must appear in this order (a ranking). */
  z.object({ kind: z.literal("order"), items: z.array(z.string()).min(2) }),
  /** At least one of these strings (a period, a name). */
  z.object({ kind: z.literal("contains"), any: z.array(z.string()).min(1) }),
  /** The right answer is no figure at all: a refusal or a stated limit. */
  z.object({ kind: z.literal("no_figures") }),
])

export type Expected = z.infer<typeof EXPECTED>

const LABELS = z.array(z.looseObject({ id: z.string(), expected: EXPECTED.optional() }))

/** Labels live beside each question; the runner reads the same file and never sends them. */
export function parseLabels(text: string) {
  const labels = new Map<string, Expected>()
  for (const { id, expected } of LABELS.parse(JSON.parse(text))) if (expected) labels.set(id, expected)
  return labels
}

function isCorrect(expected: Expected, text: string, figures: Figure[]) {
  if (expected.kind === "number") {
    const margin = (Math.abs(expected.value) * expected.tolerance_pct) / 100
    const anchored = expected.line_has === undefined ? figures : figures.filter((f) => f.line.includes(expected.line_has!))
    return anchored.some((f) => plainValues(f).some((v) => Math.abs(v - expected.value) <= margin))
  }
  if (expected.kind === "contains") return expected.any.some((s) => text.includes(s))
  if (expected.kind === "no_figures") return figures.every((f) => f.derived)
  const places = expected.items.map((item) => text.indexOf(item))
  return places.every((place, i) => place >= 0 && (i === 0 || place > places[i - 1]!))
}

const CITES = /^\s*\**\s*Nguồn\s*:|mcp__\w+/imu

export interface Score {
  q: string
  rep: number
  group: string
  /** Undefined when the question has no label. */
  correct?: boolean
  figures: number
  /** Stated, not marked as computed, and found in nothing the model received. */
  untraced: string[]
  derived: number
  wrongUnit: string[]
  cited: boolean
  requests?: number
  tokens: number
  ms: number
  replayMisses: number
  timedOut: boolean
}

/** What the model could have read: what it saw, and for subagents what their tools returned. */
function received(attempt: Attempt) {
  const shown = new Set(attempt.results.map((r) => r.call_id))
  const texts = [...attempt.results.map((r) => r.visible), ...attempt.raws.filter((r) => !shown.has(r.call_id)).map((r) => r.raw)]
  const numbers = sourceNumbers(attempt.question.question)
  for (const text of texts) for (const n of sourceNumbers(text)) numbers.add(n)
  return numbers
}

export function scoreAttempt(attempt: Attempt, labels: Map<string, Expected>): Score | undefined {
  const { answer } = attempt
  // Cut off by the run's own request cap, or by a killed run: nothing about the harness. A
  // timeout is the harness failing to answer, and scores as wrong.
  if (!answer || answer.abort === "cap") return undefined
  const figures = answerFigures(answer.text)
  const numbers = received(attempt)
  const prices = new Set(attempt.raws.flatMap((r) => [...thousandDongPrices(r.raw)]))
  const expected = labels.get(attempt.q)
  return {
    q: attempt.q,
    rep: attempt.rep,
    group: attempt.question.group,
    ...(expected ? { correct: answer.outcome === "completed" && isCorrect(expected, answer.text, figures) } : {}),
    figures: figures.length,
    untraced: figures.filter((f) => !f.derived && !tracesTo(f, numbers)).map((f) => f.text),
    derived: figures.filter((f) => f.derived).length,
    wrongUnit: wrongDong(figures, prices).map((f) => f.text),
    cited: CITES.test(answer.text),
    ...(answer.requests !== undefined ? { requests: answer.requests } : {}),
    tokens: answer.input_tokens + answer.output_tokens,
    ms: answer.duration_ms,
    replayMisses: attempt.raws.filter((r) => r.raw.includes(REPLAY_MISS)).length,
    timedOut: answer.abort === "timeout",
  }
}

/** A small seeded generator: the same trace gives the same interval. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Interval of a mean over questions. Repeats of a question are not independent, so whole
 * questions are resampled, not attempts.
 */
export function bootstrap(perQuestion: number[], rounds = 2000, seed = 1): [number, number] {
  if (perQuestion.length === 0) return [0, 0]
  const next = random(seed)
  const means: number[] = []
  for (let i = 0; i < rounds; i++) {
    let sum = 0
    for (let j = 0; j < perQuestion.length; j++) sum += perQuestion[Math.floor(next() * perQuestion.length)]!
    means.push(sum / perQuestion.length)
  }
  means.sort((a, b) => a - b)
  return [means[Math.floor(rounds * 0.025)]!, means[Math.floor(rounds * 0.975)]!]
}

/** Exact two-sided McNemar on `b` and `c`, the pairs only one system got right. */
export function mcnemar(b: number, c: number) {
  const n = b + c
  if (n === 0) return 1
  let tail = 0
  let term = 0.5 ** n
  for (let k = 0; k <= Math.min(b, c); k++) {
    tail += term
    term *= (n - k) / (k + 1)
  }
  return Math.min(1, 2 * tail)
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0)

function byQuestion(scores: Score[], value: (s: Score) => number | undefined) {
  const groups = new Map<string, number[]>()
  for (const score of scores) {
    const v = value(score)
    if (v === undefined) continue
    groups.set(score.q, [...(groups.get(score.q) ?? []), v])
  }
  return [...groups.values()].map(mean)
}

const rate = (scores: Score[], value: (s: Score) => number | undefined) => {
  const values = byQuestion(scores, value)
  return { n: values.length, mean: mean(values), ci: bootstrap(values) }
}

export function summarize(scores: Score[]) {
  const figures = scores.reduce((sum, s) => sum + s.figures, 0)
  return {
    attempts: scores.length,
    correct: rate(scores, (s) => (s.correct === undefined ? undefined : Number(s.correct))),
    /** Share of a question's stated figures found in nothing it received. */
    untraced: rate(scores, (s) => (s.figures ? s.untraced.length / s.figures : undefined)),
    cited: rate(scores, (s) => (s.figures ? Number(s.cited) : undefined)),
    figures,
    wrong_unit: scores.reduce((sum, s) => sum + s.wrongUnit.length, 0),
    requests: mean(scores.flatMap((s) => (s.requests === undefined ? [] : [s.requests]))),
    tokens: mean(scores.map((s) => s.tokens)),
    seconds: mean(scores.map((s) => s.ms)) / 1000,
    replay_misses: scores.reduce((sum, s) => sum + s.replayMisses, 0),
    timeouts: scores.filter((s) => s.timedOut).length,
  }
}

export function scoreTrace(trace: Trace, labels: Map<string, Expected>) {
  const scores = trace.attempts.flatMap((a) => scoreAttempt(a, labels) ?? [])
  const groups = [...new Set(scores.map((s) => s.group))].sort()
  return {
    harness: trace.run.harness,
    model: `${trace.run.provider}/${trace.run.model}`,
    /** Questions asked and not scored: stopped by the cap or by a killed run. Not the same as wrong. */
    unscored: trace.attempts.length - scores.length,
    stopped: trace.stopped,
    all: summarize(scores),
    groups: Object.fromEntries(groups.map((g) => [g, summarize(scores.filter((s) => s.group === g))])),
    scores,
  }
}

/** Paired on questions: a question counts as right when most of its repeats were. */
export function compare(a: Score[], b: Score[]) {
  const verdicts = (scores: Score[]) => {
    const out = new Map<string, boolean>()
    const values = new Map<string, boolean[]>()
    for (const s of scores) if (s.correct !== undefined) values.set(s.q, [...(values.get(s.q) ?? []), s.correct])
    for (const [q, list] of values) out.set(q, list.filter(Boolean).length * 2 > list.length)
    return out
  }
  const left = verdicts(a)
  const right = verdicts(b)
  let onlyLeft = 0
  let onlyRight = 0
  let pairs = 0
  for (const [q, verdict] of left) {
    const other = right.get(q)
    if (other === undefined) continue
    pairs++
    if (verdict && !other) onlyLeft++
    if (!verdict && other) onlyRight++
  }
  return { pairs, only_first: onlyLeft, only_second: onlyRight, p: mcnemar(onlyLeft, onlyRight) }
}
