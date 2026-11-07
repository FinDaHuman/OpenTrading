import { expect, test } from "bun:test"
import { z } from "zod"
import { clearResults } from "../src/core/tools/refs"
import { capTable } from "../src/core/tools/table-cap"
import type { ToolDef } from "../src/core/tools/types"
import { RwLock, runTool } from "../src/core/tools/wrap"

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ t: `2026-${i}`, c: i + 0.5 }))
const envelope = (n: number) => JSON.stringify({ units: { c: "nghìn đồng" }, data: { symbol: "FPT", candles: rows(n) }, provenance: { source: "vnstock" }, warnings: [], availability: "available" })

const parse = (text: string) => JSON.parse(text.replace(/^\[ref r\d+\] /, "")) as { units: object; data: { symbol: string; candles: unknown[] }; provenance: object }

test("a long table stays valid JSON, with its keys and its first and latest rows", () => {
  const out = capTable(envelope(5000), 3000)!
  expect(out.length).toBeLessThanOrEqual(3000)
  const value = parse(out)
  expect(value.units).toEqual({ c: "nghìn đồng" })
  expect(value.provenance).toEqual({ source: "vnstock" })
  expect(value.data.symbol).toBe("FPT")
  const candles = value.data.candles
  expect(candles[0]).toEqual({ t: "2026-0", c: 0.5 })
  expect(candles.at(-1)).toEqual({ t: "2026-4999", c: 4999.5 })
})

test("it says how many rows went, and where to read them", () => {
  const out = capTable(`[ref r7] ${envelope(5000)}`, 3000)!
  expect(out).toStartWith("[ref r7] ")
  const marker = parse(out).data.candles.find((r) => typeof r === "string") as string
  const shown = parse(out).data.candles.length - 1
  expect(marker).toContain(`đã lược ${5000 - shown}/5000 hàng`)
  expect(marker).toContain("ref r7")
})

test("a result without a ref says how to get less instead", () => {
  expect(capTable(envelope(5000), 3000)).toContain("phạm vi hẹp hơn")
})

test("as many rows as fit are kept", () => {
  const out = capTable(envelope(5000), 3000)!
  expect(out.length).toBeGreaterThan(2700)
})

test("a batch of symbols keeps an even number of rows of each", () => {
  const batch = Object.fromEntries(["FPT", "VCB", "MWG", "HPG"].map((s) => [s, rows(3000)]))
  const out = capTable(JSON.stringify(batch), 6000)!
  expect(out.length).toBeLessThanOrEqual(6000)
  const value = JSON.parse(out) as Record<string, unknown[]>
  const sizes = Object.values(value).map((list) => list.length)
  expect(new Set(sizes).size).toBe(1)
  expect(sizes[0]!).toBeGreaterThan(10)
})

test("what rows cannot fix is left to the plain cut", () => {
  expect(capTable("không phải JSON", 10)).toBeUndefined()
  expect(capTable(JSON.stringify({ text: "x".repeat(5000) }), 100)).toBeUndefined()
  expect(capTable(JSON.stringify({ rows: rows(3), text: "x".repeat(5000) }), 100)).toBeUndefined()
})

const tool = (over: Partial<ToolDef>): ToolDef => ({ name: "mcp__ot__q", description: "x", input: z.object({}), readOnly: true, source: "mcp:ot", maxOutputChars: 2000, execute: async () => envelope(5000), ...over })
const call = (def: ToolDef) => runTool(def, {}, { signal: new AbortController().signal, callId: "c" }, new RwLock())

test("an MCP table goes through it, with its ref; other text keeps the plain cut", async () => {
  clearResults()
  const table = await call(tool({}))
  expect(table.output).toStartWith("[ref r1] {")
  expect(table.output.length).toBeLessThanOrEqual(2000)
  expect(parse(table.output).data.candles.length).toBeGreaterThan(5)
  const local = await call(tool({ source: "local" }))
  expect(local.output).toContain("đã lược")
  expect(() => JSON.parse(local.output)).toThrow()
  clearResults()
})

test("a result under the cap is untouched", async () => {
  const short = await call(tool({ execute: async () => envelope(3) }))
  expect(short.output).toContain(envelope(3))
  clearResults()
})
