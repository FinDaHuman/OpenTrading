import { afterEach, expect, test } from "bun:test"
import { computeTool } from "../src/core/tools/compute"
import { clearResults, rememberResult, useResultSession } from "../src/core/tools/refs"

const ctx = { signal: new AbortController().signal, callId: "c" }

afterEach(() => clearResults())

type Args = Parameters<ReturnType<typeof computeTool>["execute"]>[0]

async function run(input: Partial<Args> & { op: Args["op"]; from_call: string }) {
  const text = (await computeTool().execute(input as Args, ctx)) as string
  return { ref: /^\[ref (r\d+)\]/.exec(text)?.[1], ...(JSON.parse(text.replace(/^\[ref r\d+\] /, "")) as { result: unknown; unit?: string; inputs: { ref: string; points: number; from?: string; to?: string; unit?: string }[] }) }
}

const failure = async (input: Parameters<typeof run>[0]) => {
  try {
    await run(input)
  } catch (error) {
    return (error as Error).message
  }
  return "(no error)"
}

const candles = (symbol: string, closes: number[], units?: object) => {
  const rows = closes.map((c, i) => ({ t: `2026-10-${String(i + 1).padStart(2, "0")}`, c }))
  return rememberResult("mcp__ot__vn_quote_history", JSON.stringify({ ...(units ? { units } : {}), data: { symbol, candles: rows } }))
}

test("pct_change compares the last point with N periods before it, and says which dates", async () => {
  const ref = candles("FPT", [100, 110, 121, 133.1])
  const out = await run({ op: "pct_change", from_call: ref, periods: 2 })
  expect(out.result).toBe(21)
  expect(out.unit).toBe("%")
  expect(out.inputs[0]).toMatchObject({ ref, points: 3, from: "2026-10-02", to: "2026-10-04" })
  expect((await run({ op: "pct_change", from_call: ref })).result).toBe(33.1)
})

test("a series newest first reads the same as oldest first", async () => {
  const rows = [{ t: "2026-10-03", c: 120 }, { t: "2026-10-02", c: 110 }, { t: "2026-10-01", c: 100 }]
  const ref = rememberResult("q", JSON.stringify({ data: { symbol: "FPT", candles: rows } }))
  expect((await run({ op: "pct_change", from_call: ref })).result).toBe(20)
})

test("mean and sum use the last N periods, and sum of 4 quarters is a TTM", async () => {
  const ref = candles("FPT", [1, 2, 3, 4, 5])
  expect((await run({ op: "mean", from_call: ref })).result).toBe(3)
  expect((await run({ op: "mean", from_call: ref, periods: 2 })).result).toBe(4.5)
  expect((await run({ op: "sum", from_call: ref, periods: 4 })).result).toBe(14)
})

test("relative strength is the gap between two returns over the same periods", async () => {
  const a = candles("VNFIN", [100, 105, 120])
  const b = candles("VNINDEX", [100, 102, 110])
  const out = await run({ op: "relative_strength", from_call: a, periods: 2, other: { from_call: b } })
  expect(out.result).toBe(10)
  expect(out.unit).toBe("điểm %")
  expect(out.inputs.map((i) => i.ref)).toEqual([a, b])
})

test("ratio takes the last values, and refuses two different units", async () => {
  const thousand = { "o, h, l, c": "nghìn đồng/cổ phiếu" }
  const dong = { c: "đồng/cổ phiếu" }
  const a = candles("FPT", [60, 64], thousand)
  const b = candles("FPT", [2, 4], thousand)
  const c = candles("FPT", [2000, 4000], dong)
  expect((await run({ op: "ratio", from_call: a, other: { from_call: b } })).result).toBe(16)
  expect(await failure({ op: "ratio", from_call: a, other: { from_call: c } })).toContain("khác đơn vị")
})

test("rank and share name each row", async () => {
  const rows = [{ symbol: "VCB", roe: 18 }, { symbol: "ACB", roe: 22 }, { symbol: "BID", roe: 10 }]
  const ref = rememberResult("q", JSON.stringify({ data: { rows } }))
  expect((await run({ op: "rank", from_call: ref, field: "roe" })).result).toEqual([{ label: "ACB", value: 22 }, { label: "VCB", value: 18 }, { label: "BID", value: 10 }])
  const share = (await run({ op: "share", from_call: ref, field: "roe" })).result as { label: string; value: number }[]
  expect(share.find((r) => r.label === "ACB")?.value).toBe(44)
})

test("annualize scales the periods so far to a year", async () => {
  const ref = candles("VCB", [10, 20, 30, 40])
  expect((await run({ op: "annualize", from_call: ref, periods_done: 2, periods_per_year: 4 })).result).toBe(140)
})

test("the result has its own ref and carries the source's unit", async () => {
  const ref = candles("FPT", [64, 66], { "o, h, l, c": "nghìn đồng/cổ phiếu" })
  const out = await run({ op: "mean", from_call: ref })
  expect(out.ref).toBeDefined()
  expect(out.ref).not.toBe(ref)
  expect(out.unit).toBe("nghìn đồng/cổ phiếu")
})

test("what cannot be computed says why, and never guesses", async () => {
  const ref = candles("FPT", [0, 5])
  expect(await failure({ op: "pct_change", from_call: ref })).toContain("bằng 0")
  expect(await failure({ op: "pct_change", from_call: ref, periods: 5 })).toContain("chuỗi có 2 kỳ")
  expect(await failure({ op: "mean", from_call: ref, periods: 5 })).toContain("chuỗi có 2 kỳ")
  expect(await failure({ op: "ratio", from_call: ref })).toContain("other")
  expect(await failure({ op: "rank", from_call: ref })).toContain("không có trường tên")
  expect(await failure({ op: "annualize", from_call: ref })).toContain("periods_done")
  expect(await failure({ op: "mean", from_call: "r999" })).toContain("Không còn kết quả")
})

test("a ref of another session is out of reach", async () => {
  useResultSession("a")
  const ref = candles("FPT", [1, 2])
  useResultSession("b")
  expect(await failure({ op: "mean", from_call: ref })).toContain("Không còn kết quả")
})
