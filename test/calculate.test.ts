import { afterEach, expect, test } from "bun:test"
import { calculateTool } from "../src/core/tools/calculate"
import { evaluate } from "../src/core/tools/calculate/expression"
import { describeDims, parseUnit } from "../src/core/tools/calculate/units"
import { clearResults, recallResult, rememberResult } from "../src/core/tools/refs"

const ctx = { signal: new AbortController().signal, callId: "c" }
afterEach(() => clearResults())

type Args = Parameters<ReturnType<typeof calculateTool>["execute"]>[0]
type Out = { result: number; unit: string; inputs: { name: string; value: number; unit?: string; ref?: string; time?: string }[]; warnings?: string[] }

async function run(input: Args) {
  const text = (await calculateTool().execute(input, ctx)) as string
  return { ref: /^\[ref (r\d+)\]/.exec(text)?.[1], ...(JSON.parse(text.replace(/^\[ref r\d+\] /, "")) as Out) }
}
const failure = async (input: Args) => {
  try {
    await run(input)
  } catch (error) {
    return (error as Error).message
  }
  return "(no error)"
}

test("units: magnitudes, a per-share price, the data server's note in brackets, % and lần", () => {
  expect(parseUnit("nghìn đồng/cổ phiếu (64,27 = 64.270 đ)")).toEqual({ factor: 1000, dims: { đồng: 1, "cổ phiếu": -1 } })
  expect(parseUnit("nghìn tỷ đồng")).toEqual({ factor: 1e12, dims: { đồng: 1 } })
  expect(parseUnit("tỷ VND").factor).toBe(1e9)
  expect(parseUnit("triệu cp")).toEqual({ factor: 1e6, dims: { "cổ phiếu": 1 } })
  expect(parseUnit("%")).toEqual({ factor: 0.01, dims: {} })
  expect(parseUnit("lần")).toEqual({ factor: 1, dims: {} })
  expect(describeDims(parseUnit("đồng/cổ phiếu").dims)).toBe("đồng/cổ phiếu")
})

test("P/E from a price in nghìn đồng and an EPS in đồng: the 1000× slip is converted, not made", async () => {
  const out = await run({
    expression: "price / eps",
    values: { price: { value: 64.27, unit: "nghìn đồng/cổ phiếu" }, eps: { value: 4520, unit: "đồng/cổ phiếu", ref: "r5" } },
    unit: "lần",
    decimals: 2,
  })
  expect(out.result).toBe(14.22)
  expect(out.unit).toBe("lần")
  expect(out.inputs.find((i) => i.name === "eps")).toMatchObject({ ref: "r5" })
  // The result is a ref of its own, and the stored text is what the model saw.
  expect(recallResult(out.ref!)?.tool).toBe("calculate")
})

test("adding or converting across dimensions is an error that says why", async () => {
  expect(await failure({ expression: "a + b", values: { a: { value: 64.27, unit: "nghìn đồng/cổ phiếu" }, b: { value: 1_200_000, unit: "cổ phiếu" } } })).toContain("lệch đơn vị")
  expect(await failure({ expression: "a / b", values: { a: { value: 10, unit: "tỷ đồng" }, b: { value: 2, unit: "tỷ đồng" } }, unit: "tỷ đồng" })).toContain("lệch đơn vị")
  // A sum in different magnitudes of the same unit is fine, in the unit asked for.
  const sum = await run({ expression: "a + b", values: { a: { value: 1.2, unit: "nghìn tỷ đồng" }, b: { value: 350, unit: "tỷ đồng" } }, unit: "tỷ đồng" })
  expect(sum.result).toBe(1550)
})

test("growth and CAGR, % in and out", async () => {
  const cagr = await run({ expression: "(end / start) ^ (1 / years) - 1", values: { end: { value: 62_000, unit: "tỷ đồng" }, start: { value: 44_000, unit: "tỷ đồng" }, years: { value: 3 } }, unit: "%", decimals: 1 })
  expect(cagr.result).toBe(12.1)
  const margin = await run({ expression: "rev * m", values: { rev: { value: 2000, unit: "tỷ đồng" }, m: { value: 15, unit: "%" } }, unit: "tỷ đồng" })
  expect(margin.result).toBe(300)
})

test("a value taken straight from a ref keeps the unit the data server published, and its date", async () => {
  const ref = rememberResult(
    "mcp__ot__vn_quote_history",
    JSON.stringify({ units: { "o, h, l, c": "nghìn đồng/cổ phiếu (64,27 = 64.270 đ)", v: "cổ phiếu" }, data: { symbol: "FPT", candles: [{ t: "2026-10-01", c: 120 }, { t: "2026-10-02", c: 125.5 }] } }),
  )
  const out = await run({ expression: "price * shares", values: { price: { from_call: ref, field: "c" }, shares: { value: 1000, unit: "cổ phiếu" } }, unit: "triệu đồng" })
  expect(out.result).toBe(125.5)
  expect(out.inputs[0]).toMatchObject({ ref, value: 125.5, unit: "nghìn đồng/cổ phiếu (64,27 = 64.270 đ)", time: "2026-10-02" })
  expect((await run({ expression: "p", values: { p: { from_call: ref, field: "c", at: "first" } }, unit: "đồng/cổ phiếu" })).result).toBe(120_000)
  // A unit the model claims for a field that publishes another one is refused.
  expect(await failure({ expression: "p", values: { p: { from_call: ref, field: "c", unit: "cổ phiếu" } } })).toContain("ghi đơn vị")
})

test("digits from data typed into the expression get a warning; constants and digits in names do not", async () => {
  expect((await run({ expression: "64.27 * 1000" })).warnings?.[0]).toContain("số viết thẳng")
  expect((await run({ expression: "x / 4", values: { x: { value: 8 } } })).warnings).toBeUndefined()
  // The schema's own example.
  const cagr = await run({ expression: "(rev_2025 / rev_2022) ^ (1/3) - 1", values: { rev_2025: { value: 62_000, unit: "tỷ đồng" }, rev_2022: { value: 44_000, unit: "tỷ đồng" } }, unit: "%" })
  expect(cagr.warnings).toBeUndefined()
})

test("a figure calculate or compute already made is read by its result and unit, not an input inside it", async () => {
  const first = await run({ expression: "a + b", values: { a: { value: 1.2, unit: "nghìn tỷ đồng" }, b: { value: 350, unit: "tỷ đồng" } }, unit: "tỷ đồng" })
  const chained = await run({ expression: "total / shares", values: { total: { from_call: first.ref! }, shares: { value: 1, unit: "tỷ cổ phiếu" } }, unit: "đồng/cổ phiếu" })
  expect(chained.result).toBe(1550)
  expect(chained.inputs[0]).toMatchObject({ value: 1550, unit: "tỷ đồng", ref: first.ref, tool: "calculate" })
  const ranked = rememberResult("compute", JSON.stringify({ op: "rank", result: [{ label: "FPT", value: 1 }] }))
  expect(await failure({ expression: "x", values: { x: { from_call: ranked } } })).toContain("không ra một số")
})

test("the expression is parsed, never run: names, odd characters and bad input fail cleanly", () => {
  expect(() => evaluate("process.exit(1)", {})).toThrow()
  expect(() => evaluate("a; b", {})).toThrow("Ký tự không hợp lệ")
  expect(() => evaluate("1 / 0", {})).toThrow("Chia cho 0")
  expect(() => evaluate("1,5 + 2", {})).toThrow("dấu chấm")
  expect(() => evaluate("10%", {})).toThrow("/100")
  expect(() => evaluate("foo(1)", {})).toThrow("Không có hàm")
  expect(() => evaluate("(1 + 2", {})).toThrow('Thiếu ")"')
  expect(evaluate("2 ^ 3 ^ 2", {}).value).toBe(512)
  expect(evaluate("-2 ^ 2", {}).value).toBe(4)
  expect(evaluate("max(1, 3, 2) + sqrt(16) + avg(2, 4)", {}).value).toBe(10)
})
