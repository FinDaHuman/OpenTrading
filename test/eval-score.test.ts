import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { answerFigures, plainValues, sourceNumbers, tracesTo, wrongDong } from "../src/core/loop/figures"
import { readTrace } from "../scripts/eval/read-trace"
import { bootstrap, compare, mcnemar, parseLabels, scoreTrace, type Score } from "../scripts/eval/scoring"
import { TRACE_VERSION } from "../scripts/eval/trace"

const golden = readFileSync(path.join(import.meta.dir, "fixtures/eval/trace-v1.jsonl"), "utf8")
const labels = parseLabels(JSON.stringify([{ id: "good", expected: { kind: "number", value: 64270, tolerance_pct: 0.1 } }, { id: "bad", expected: { kind: "number", value: 64270, tolerance_pct: 0.1 } }]))

test("the golden trace still reads: changing the format must bump the version", () => {
  expect(TRACE_VERSION).toBe(1)
  const trace = readTrace(golden)
  expect(trace.attempts.map((a) => a.q)).toEqual(["good", "bad", "cut"])
  expect(trace.attempts[0]!.raws).toHaveLength(1)
})

test("a trace of another version or with a broken line is refused, not scored", () => {
  expect(() => readTrace(golden.replace('"trace_version":1', '"trace_version":2'))).toThrow("bản 2")
  expect(() => readTrace(golden.replace('"visible":', '"seen":'))).toThrow("Dòng 5")
  expect(() => readTrace(golden.split("\n").filter((l) => !l.includes('"q":"good","rep":1,"group"')).join("\n"))).toThrow("chưa có câu good#1")
})

test("a good answer scores clean: right, traced, cited", () => {
  const { scores } = scoreTrace(readTrace(golden), labels)
  expect(scores.find((s) => s.q === "good")).toMatchObject({ correct: true, untraced: [], wrongUnit: [], cited: true, figures: 1 })
})

test("a bad answer shows each fault apart", () => {
  const { scores } = scoreTrace(readTrace(golden), labels)
  expect(scores.find((s) => s.q === "bad")).toMatchObject({ correct: false, untraced: ["3,5%", "12,3 lần"], wrongUnit: ["64,27 đ"], cited: false })
})

test("a cut-off question is counted apart, never as wrong", () => {
  const report = scoreTrace(readTrace(golden), labels)
  expect(report.unscored).toBe(1)
  expect(report.all.attempts).toBe(2)
  expect(report.all.correct).toMatchObject({ n: 2, mean: 0.5 })
})

test("figures: dates and periods are not figures, units and groups are read", () => {
  const figures = answerFigures("Ngày 09/10/2026, quý 3 và Q2/2026: giá 128.400đ, vốn hoá 2,5 tỷ, ROE 24,1%, có 3 mã.")
  expect(figures.map((f) => f.text)).toEqual(["128.400đ", "2,5 tỷ", "24,1%"])
  expect(plainValues(figures[1]!)).toEqual([2.5e9])
  expect(plainValues(answerFigures("1.200 nghìn tỷ")[0]!)).toContain(1.2e12)
})

test("figures: 'tính từ' marks arithmetic, but not a period", () => {
  expect(answerFigures("Tăng 12,5% (tính từ 100 và 112,5)")[0]!.derived).toBe(true)
  expect(answerFigures("Tăng 99,9% tính từ đầu năm")[0]!.derived).toBe(false)
  expect(answerFigures("P/E 15,2 lần (tự tính)")[0]!.derived).toBe(true)
})

test("sources: JSON stays JSON, so a compact array does not glue its numbers", () => {
  const numbers = sourceNumbers("[ref r3] " + JSON.stringify({ c: [64.27, 64.5, 65.1], text: "65.9" }))
  expect([...numbers].sort()).toEqual([64.27, 64.5, 65.1, 65.9])
  expect(tracesTo(answerFigures("64,5 đ")[0]!, numbers)).toBe(true)
})

test("sources: a capped table and a result after a notice keep their numbers apart", () => {
  const capped = sourceNumbers('[ref r1] {"c":[64.27,64.5,65.1,[... đã lược 900 ký tự ...]66.2,1.5e3]}')
  for (const n of [64.27, 64.5, 65.1, 66.2, 1500]) expect(capped.has(n)).toBe(true)
  expect(capped.has(6427.64)).toBe(false)
  const noticed = sourceNumbers('[Dữ liệu một phần] FPT: thiếu một phần\n[ref r2] {"data":{"c":[64.27,64.5]}}')
  expect([...noticed].sort()).toEqual([64.27, 64.5])
})

test("sources: cut JSON is read as JSON, so no number comes from a separator", () => {
  const numbers = sourceNumbers('{"c":[1.234,5.6,64.27,64.5, [... đã lược')
  expect([...numbers].sort((a, b) => a - b)).toEqual([1.234, 5.6, 64.27, 64.5])
})

test("sources: a Vietnamese page keeps its grouped numbers", () => {
  const numbers = sourceNumbers("Doanh thu đạt 1.234,5 tỷ, biên 24,1%.")
  expect(numbers.has(1234.5)).toBe(true)
  expect(numbers.has(24.1)).toBe(true)
})

test("sources: a number inside a text field counts", () => {
  expect(sourceNumbers(JSON.stringify([{ content: "P/E 19,5 lần, giá 1.234,5" }])).has(19.5)).toBe(true)
})

test("a fall traces to a negative number, the sign is in the words", () => {
  expect(tracesTo(answerFigures("giảm 3,2%")[0]!, new Set([-3.2]))).toBe(true)
})

test("tracing allows rounding and scale, but not a factor of ten", () => {
  const numbers = new Set([0.241, 18.2174, 195])
  expect(tracesTo(answerFigures("ROE 24,1%")[0]!, numbers)).toBe(true)
  expect(tracesTo(answerFigures("18,2 lần")[0]!, numbers)).toBe(true)
  expect(tracesTo(answerFigures("19,5 lần")[0]!, numbers)).toBe(false)
})

test("a thousand-dong price written as dong is a unit error, the right form is not", () => {
  const prices = new Set([62.2])
  expect(wrongDong(answerFigures("giá 62,2 đ"), prices).map((f) => f.text)).toEqual(["62,2 đ"])
  expect(wrongDong(answerFigures("giá 62.200 đ"), prices)).toEqual([])
})

test("a timeout is wrong and counted; a cap stop is not scored", () => {
  const timedOut = golden.replace('"outcome":"aborted","abort":"cap"', '"outcome":"aborted","abort":"timeout"')
  const report = scoreTrace(readTrace(timedOut), parseLabels(JSON.stringify([{ id: "cut", expected: { kind: "contains", any: ["x"] } }])))
  expect(report.unscored).toBe(0)
  expect(report.scores.find((s) => s.q === "cut")).toMatchObject({ correct: false, timedOut: true })
  expect(report.all.timeouts).toBe(1)
})

test("line_has keeps a table from answering by chance", () => {
  const trace = (answer: string) => golden.split("\n").slice(0, 1).concat(
    JSON.stringify({ type: "question", q: "x", rep: 1, group: "A", question: "q", now: "n" }),
    JSON.stringify({ type: "answer", q: "x", rep: 1, text: answer, outcome: "completed", model_steps: 1, input_tokens: 0, output_tokens: 0, duration_ms: 0 }),
  ).join("\n")
  const label = parseLabels(JSON.stringify([{ id: "x", expected: { kind: "number", value: 64270, tolerance_pct: 0, line_has: "09/10" } }]))
  expect(scoreTrace(readTrace(trace("09/10: 64.270 đ\n08/10: 64.500 đ")), label).scores[0]!.correct).toBe(true)
  expect(scoreTrace(readTrace(trace("09/10: 64.500 đ\n08/10: 64.270 đ")), label).scores[0]!.correct).toBe(false)
})

test("labels: order, contains and no figures", () => {
  const text = (answer: string) => golden.split("\n").slice(0, 1).concat(
    JSON.stringify({ type: "question", q: "x", rep: 1, group: "C", question: "q", now: "n" }),
    JSON.stringify({ type: "answer", q: "x", rep: 1, text: answer, outcome: "completed", model_steps: 1, input_tokens: 0, output_tokens: 0, duration_ms: 0 }),
  ).join("\n")
  const score = (expected: object, answer: string) => scoreTrace(readTrace(text(answer)), parseLabels(JSON.stringify([{ id: "x", expected }]))).scores[0]!.correct
  expect(score({ kind: "order", items: ["VCB", "ACB"] }, "VCB rồi ACB")).toBe(true)
  expect(score({ kind: "order", items: ["VCB", "ACB"] }, "ACB rồi VCB")).toBe(false)
  expect(score({ kind: "contains", any: ["Q2/2026"] }, "Quý gần nhất là Q2/2026")).toBe(true)
  expect(score({ kind: "no_figures" }, "Chưa có số liệu công bố.")).toBe(true)
  expect(score({ kind: "no_figures" }, "Lợi nhuận 1.200 tỷ.")).toBe(false)
})

test("the interval is fixed by the seed and covers the mean", () => {
  const values = [1, 1, 0, 1, 0, 1, 1, 1, 0, 1]
  const [low, high] = bootstrap(values)
  expect(bootstrap(values)).toEqual([low, high])
  expect(low).toBeLessThan(0.7)
  expect(high).toBeGreaterThan(0.7)
})

test("McNemar is exact on small counts", () => {
  expect(mcnemar(0, 0)).toBe(1)
  expect(mcnemar(5, 0)).toBeCloseTo(0.0625, 6)
  expect(mcnemar(10, 2)).toBeCloseTo(0.0386, 3)
})

test("systems compare on questions: repeats vote, and unmatched questions drop out", () => {
  const s = (q: string, correct: boolean) => ({ q, correct }) as Score
  const left = [s("a", true), s("a", true), s("a", false), s("b", false), s("only-left", true)]
  const right = [s("a", false), s("b", true)]
  expect(compare(left, right)).toMatchObject({ pairs: 2, only_first: 1, only_second: 1 })
})
