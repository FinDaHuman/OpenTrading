import { beforeEach, expect, test } from "bun:test"
import { z } from "zod"
import { isoFromNetDate, normalizeNetDates } from "../src/core/tools/net-dates"
import { clearResults, recallResult } from "../src/core/tools/refs"
import { RwLock, runTool } from "../src/core/tools/wrap"
import type { ToolDef } from "../src/core/tools/types"

beforeEach(() => clearResults())

test("the value stock_overview sent on 11/10 is Friday 09/10 14:54 Vietnam time; midnight stays a date", () => {
  expect(isoFromNetDate(1791532464487)).toBe("2026-10-09T14:54:24+07:00")
  expect(isoFromNetDate(1784739600000)).toBe("2026-07-23")
})

test("only whole quoted .NET date values are rewritten, escaped slashes included", () => {
  const text = JSON.stringify({ TradingDate: "/Date(1791532464487)/", ReportDate: "/Date(1784739600000+0700)/", note: "xem /Date(1)/ nhé", bad: "/Date(x)/" })
  const out = JSON.parse(normalizeNetDates(text))
  expect(out).toEqual({ TradingDate: "2026-10-09T14:54:24+07:00", ReportDate: "2026-07-23", note: "xem /Date(1)/ nhé", bad: "/Date(x)/" })
  expect(normalizeNetDates('{"d":"\\/Date(1784739600000)\\/"}')).toBe('{"d":"2026-07-23"}')
  expect(normalizeNetDates("không có ngày")).toBe("không có ngày")
})

const tool = (source: string): ToolDef => ({
  name: `${source}_tool`,
  source,
  description: "x",
  input: z.object({}),
  readOnly: true,
  execute: async () => JSON.stringify({ data: { rows: [{ TradingDate: "/Date(1791532464487)/", c: 1 }, { TradingDate: "/Date(1791446064487)/", c: 2 }] } }),
})

test("an MCP result reaches the model and the chart ref with ISO dates; a local tool's text is left alone", async () => {
  const ctx = { signal: new AbortController().signal, callId: "c1" }
  const out = (await runTool(tool("mcp:ot"), {}, ctx, new RwLock())).output
  expect(out).toContain('"TradingDate":"2026-10-09T14:54:24+07:00"')
  expect(out).not.toContain("/Date(")
  const ref = /^\[ref (r\d+)\]/.exec(out)![1]!
  expect(recallResult(ref)!.text).not.toContain("/Date(")
  const local = (await runTool(tool("local"), {}, ctx, new RwLock())).output
  expect(local).toContain("/Date(1791532464487)/")
})

test("web sources are dated in Vietnam time (30/10 03:23 VN was printed as 2026-10-29)", async () => {
  const { vnDay, vnStamp } = await import("../src/core/tools/net-dates")
  const at = Date.parse("2026-10-29T20:23:33Z")
  expect(vnDay(at)).toBe("2026-10-30")
  expect(vnStamp(at)).toBe("2026-10-30T03:23:33+07:00")
  expect(vnDay(Date.parse("2026-10-29T16:59:59Z"))).toBe("2026-10-29")
})
