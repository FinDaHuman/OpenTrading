import { expect, test } from "bun:test"
import path from "node:path"
import { extractFromRef } from "../src/core/tools/chart/extract"
import { clearResults, hasDataArray, parseResult, rememberResult } from "../src/core/tools/refs"
import { parseQuotes } from "../src/core/tools/watchlist/quotes"

/** Real outputs of opentrading-mcp 26392e7 (FPT, VNINDEX, VCB/FPT/HPG on 2026-10-11), not invented shapes. */
const fixture = (name: string) => Bun.file(path.join(import.meta.dir, "fixtures/mcp-results", `${name}.json`)).text()

test("from_call reads real candles: vn_quote_history (t/o/h/l/c/v) and vn_equity_ohlcv (time/open/…)", async () => {
  clearResults()
  for (const name of ["vn_quote_history", "vn_equity_ohlcv"]) {
    const text = await fixture(name)
    expect(hasDataArray(parseResult(text))).toBe(true)
    const ref = rememberResult(`mcp__opentrading__${name}`, text)
    const got = extractFromRef(ref, { ohlc: true })
    expect(got.symbol).toBe("FPT")
    expect(got.bars!.length).toBeGreaterThanOrEqual(15)
    for (const b of got.bars!) expect(b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c)).toBe(true)
    expect(got.times![0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(got.times![0]! < got.times![got.times!.length - 1]!).toBe(true) // oldest first
    expect(got.bars!.every((b) => b.v !== undefined)).toBe(true)
  }
})

test("the /watchlist panel reads real quotes: price, % (already in percent) and volume", async () => {
  const q = parseQuotes(await fixture("vn_equity_quote_batch"), ["VCB", "FPT", "HPG"])
  expect(q.error).toBeUndefined()
  expect(q.rows.map((r) => r.symbol).sort()).toEqual(["FPT", "HPG", "VCB"])
  const vcb = q.rows.find((r) => r.symbol === "VCB")!
  expect(vcb.price).toBeGreaterThan(1000) // VND, e.g. 56700
  expect(vcb.volume).toBeGreaterThan(0)
  // percent_change is a percent: price_change / reference × 100.
  const raw = (JSON.parse(await fixture("vn_equity_quote_batch")) as { data: { quotes: Record<string, number>[] } }).data.quotes.find((x) => x.symbol === ("VCB" as never))!
  expect(vcb.changePct).toBeCloseTo((raw.price_change! / raw.reference_price!) * 100, 3)
})
