import { afterEach, beforeEach, expect, test } from "bun:test"
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import type { ModelMessage } from "ai"
import { pruneToolResults } from "../src/core/compact"
import { readResultTool } from "../src/core/tools/builtin/read-result"
import { evidenceFile, readEvidence } from "../src/core/tools/evidence"
import { extractFromRef } from "../src/core/tools/chart/extract"
import { clearResults, recallResult, useResultSession } from "../src/core/tools/refs"
import type { ToolDef } from "../src/core/tools/types"
import { RwLock, runTool } from "../src/core/tools/wrap"

const dirs: string[] = []
const sessionDir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ot-evidence-"))
  dirs.push(dir)
  return dir
}

// Refs are process-wide: another test file may have left some.
beforeEach(() => clearResults())

afterEach(() => {
  clearResults()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const candles = (close: number) => JSON.stringify({ data: { symbol: "FPT", candles: [{ t: "2026-10-08", c: close }, { t: "2026-10-09", c: close + 1 }, { t: "2026-10-10", c: close + 2 }] } })

const mcpTool = (output: string): ToolDef => ({
  name: "mcp__data__quote",
  description: "Giá",
  input: z.object({ symbol: z.string() }),
  readOnly: true,
  source: "mcp:data",
  execute: async () => output,
})

const call = (def: ToolDef, callId = "c1") => runTool(def, { symbol: "FPT" }, { signal: new AbortController().signal, callId }, new RwLock())

/** A restart: RAM is gone, the session is opened again. */
function restart(id: string, dir: string, history?: string) {
  clearResults()
  useResultSession(id, history, dir)
}

test("every MCP result is saved in full, with what asked for it", async () => {
  const dir = sessionDir()
  useResultSession("s", undefined, dir)
  const long = JSON.stringify({ data: { rows: Array.from({ length: 3000 }, (_, i) => ({ i, c: i / 7 })) } })
  const result = await call({ ...mcpTool(long), maxOutputChars: 1000 })
  expect(result.output.length).toBeLessThan(long.length)
  const [saved] = readEvidence(evidenceFile(dir))
  expect(saved).toMatchObject({ ref: "r1", callId: "c1", tool: "mcp__data__quote", input: { symbol: "FPT" }, text: long })
  expect(Number.isNaN(Date.parse(saved!.at))).toBe(false)
})

test("a single-row result has no ref but is saved too", async () => {
  const dir = sessionDir()
  useResultSession("s", undefined, dir)
  await call(mcpTool(JSON.stringify({ data: { price: 64.27 } })))
  const [saved] = readEvidence(evidenceFile(dir))
  expect(saved!.ref).toBeUndefined()
  expect(saved!.text).toContain("64.27")
})

test("a local tool's result is not evidence", async () => {
  const dir = sessionDir()
  useResultSession("s", undefined, dir)
  await call({ ...mcpTool("[1,2,3]"), source: "local" })
  expect(readEvidence(evidenceFile(dir))).toEqual([])
})

test("after a restart a ref still reads, and a chart can use it", async () => {
  const dir = sessionDir()
  useResultSession("s", undefined, dir)
  await call(mcpTool(candles(64)))
  restart("s", dir)
  expect(recallResult("r1")?.tool).toBe("mcp__data__quote")
  expect(extractFromRef("r1", {}).series).toEqual([64, 65, 66])
})

test("an evicted ref reads from disk in the same run", async () => {
  const dir = sessionDir()
  useResultSession("s", undefined, dir)
  for (let i = 0; i < 45; i++) await call(mcpTool(candles(i)), `c${i}`)
  expect(recallResult("r1")?.text).toContain('"c":0')
})

test("new refs never reuse one a subagent took, even if the conversation never named it", async () => {
  const dir = sessionDir()
  useResultSession("s", undefined, dir)
  await call(mcpTool(candles(1)), "a")
  await call(mcpTool(candles(2)), "b")
  // Only r1 reached the main conversation; r2 belonged to a subagent.
  restart("s", dir, JSON.stringify([{ content: "[ref r1]" }]))
  await call(mcpTool(candles(3)), "c")
  expect(readEvidence(evidenceFile(dir)).map((e) => e.ref)).toEqual(["r1", "r2", "r3"])
})

test("another session's refs stay out of reach", async () => {
  const first = sessionDir()
  useResultSession("a", undefined, first)
  await call(mcpTool(candles(1)))
  restart("b", sessionDir())
  expect(recallResult("r1")).toBeUndefined()
})

test("a line cut by a crash does not cost the others", async () => {
  const dir = sessionDir()
  useResultSession("s", undefined, dir)
  await call(mcpTool(candles(1)))
  appendFileSync(evidenceFile(dir), '{"ref":"r2","tex')
  expect(readEvidence(evidenceFile(dir)).map((e) => e.ref)).toEqual(["r1"])
})

test("reading again after a new result sees it", async () => {
  const dir = sessionDir()
  useResultSession("s", undefined, dir)
  await call(mcpTool(candles(1)), "a")
  expect(readEvidence(evidenceFile(dir))).toHaveLength(1)
  expect(readEvidence(evidenceFile(dir))).toBe(readEvidence(evidenceFile(dir)))
  await call(mcpTool(candles(2)), "b")
  expect(readEvidence(evidenceFile(dir))).toHaveLength(2)
})

test("a session with no folder (headless) keeps working from RAM", async () => {
  useResultSession("")
  const result = await call(mcpTool(candles(1)))
  expect(result.output).toStartWith("[ref r1]")
  expect(recallResult("r1")).toBeDefined()
})

test("a folder that cannot be written does not fail the tool", async () => {
  const dir = sessionDir()
  const blocked = path.join(dir, "file")
  appendFileSync(blocked, "x")
  useResultSession("s", undefined, blocked)
  const result = await call(mcpTool(candles(1)))
  expect(result.output).toStartWith("[ref r1]")
  expect(readFileSync(blocked, "utf8")).toBe("x")
})

const read = (input: { id: string; offset?: number }) => readResultTool().execute(input, { signal: new AbortController().signal, callId: "r" }) as Promise<string>

test("read_result gives a result back as fetched, by ref or by call id", async () => {
  const dir = sessionDir()
  useResultSession("s", undefined, dir)
  await call(mcpTool(candles(64)), "call-1")
  await call(mcpTool(JSON.stringify({ data: { price: 7 } })), "call-2")
  restart("s", dir)
  expect(await read({ id: "r1" })).toContain("[ref r1]")
  expect(await read({ id: "call-1" })).toContain('"c":64')
  expect(await read({ id: "call-2" })).toContain('"price":7')
  expect(await read({ id: "nope" })).toContain("Không còn kết quả")
})

test("read_result pages a long result, and a headless run reads from RAM", async () => {
  useResultSession("")
  await call(mcpTool(JSON.stringify({ data: { rows: Array.from({ length: 9000 }, (_, i) => ({ i, c: i / 7 })) } })))
  const first = await read({ id: "r1" })
  const offset = Number(/offset (\d+)/.exec(first)![1])
  const rest = await read({ id: "r1", offset })
  expect(rest).not.toContain("[ref r1]")
  expect(rest.length).toBeGreaterThan(100)
})

test("a pruned data result names the way back, and that way works", async () => {
  const dir = sessionDir()
  useResultSession("s", undefined, dir)
  const big = JSON.stringify({ data: { rows: Array.from({ length: 100 }, (_, i) => ({ i, c: 64.27 })) } })
  await call(mcpTool(big), "old-call")
  const turn = (id: string, value: string): ModelMessage[] => [
    { role: "user", content: "hỏi" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: id, toolName: "mcp__data__quote", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: id, toolName: "mcp__data__quote", output: { type: "text", value } }] },
  ]
  const first = pruneToolResults([...turn("old-call", big), ...turn("b", "x"), ...turn("c", "y")])
  const text = JSON.stringify(first.messages)
  expect(first.pruned).toBe(1)
  expect(text).toContain("read_result")
  expect(pruneToolResults(first.messages).pruned).toBe(0)
  const id = /read_result id=\\"([^\\]+)\\"/.exec(text)![1]!
  expect(await read({ id })).toContain("64.27")
})

test("after the first read only appended bytes are parsed; a line being written counts once it ends", async () => {
  const dir = sessionDir()
  const file = evidenceFile(dir)
  useResultSession("s", undefined, dir)
  await call(mcpTool(candles(1)), "a")
  expect(readEvidence(file).map((e) => e.callId)).toEqual(["a"])
  // Half of a line, then the rest of it: invisible, then read.
  const line = JSON.stringify({ callId: "b", tool: "t", input: {}, at: "2026-11-08T00:00:00Z", text: "Giá đóng cửa 12.500 đ" })
  appendFileSync(file, line.slice(0, 20))
  expect(readEvidence(file).map((e) => e.callId)).toEqual(["a"])
  appendFileSync(file, `${line.slice(20)}\n`)
  expect(readEvidence(file).map((e) => e.callId)).toEqual(["a", "b"])
  expect(readEvidence(file).at(-1)!.text).toBe("Giá đóng cửa 12.500 đ")
  // The same records a parse of the whole file gives.
  const whole = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).callId)
  expect(readEvidence(file).map((e) => e.callId)).toEqual(whole)
})

test("a file that got shorter is read again from the start", async () => {
  const dir = sessionDir()
  const file = evidenceFile(dir)
  useResultSession("s", undefined, dir)
  await call(mcpTool(candles(1)), "a")
  await call(mcpTool(candles(2)), "b")
  expect(readEvidence(file)).toHaveLength(2)
  const first = readFileSync(file, "utf8").split("\n")[0]!
  writeFileSync(file, `${first}\n`)
  expect(readEvidence(file).map((e) => e.callId)).toEqual(["a"])
})
