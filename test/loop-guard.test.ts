import { expect, test } from "bun:test"
import { z } from "zod"
import { PermissionGate, type RuleStore } from "../src/core/permission"
import { LOOP_THRESHOLD, LoopGuard } from "../src/core/tools/loop-guard"
import type { ToolDef } from "../src/core/tools/types"
import { RwLock, runTool } from "../src/core/tools/wrap"

const store: RuleStore = { load: async () => [], save: async () => {} }
const quote: ToolDef = {
  name: "mcp__opentrading__vn_quote_history",
  description: "Giá lịch sử",
  input: z.object({ symbol: z.string() }),
  readOnly: true,
  execute: async () => "nến",
}
const tick = () => new Promise((r) => setTimeout(r, 5))

test("the guard counts identical calls in a row, whatever the key order", () => {
  const guard = new LoopGuard()
  expect(guard.note("t", { a: 1, b: 2 })).toBeUndefined()
  expect(guard.note("t", { b: 2, a: 1 })).toBeUndefined()
  expect(guard.note("t", { a: 1, b: 2 })).toBe(LOOP_THRESHOLD)
  expect(guard.note("t", { a: 1, b: 2 })).toBe(LOOP_THRESHOLD + 1)
  // Another input (or another tool) starts a new run.
  expect(guard.note("t", { a: 2, b: 2 })).toBeUndefined()
  expect(guard.note("u", { a: 2, b: 2 })).toBeUndefined()
})

test("the third identical read asks; 'deny' tells the model to stop, 'session' stops asking", async () => {
  const gate = new PermissionGate(store)
  gate.interactive = true
  const loop = new LoopGuard()
  const ctx = { signal: new AbortController().signal, callId: "c", loop }
  const lock = new RwLock()
  for (let i = 0; i < LOOP_THRESHOLD - 1; i++) expect(await runTool(quote, { symbol: "FPT" }, ctx, lock, gate)).toEqual({ output: "nến" })
  expect(gate.head()).toBeUndefined() // read-only: no prompt so far

  const third = runTool(quote, { symbol: "FPT" }, ctx, lock, gate).catch((e: Error) => e.message)
  await tick()
  expect(gate.head()!.description).toContain(`cùng tham số ${LOOP_THRESHOLD} lần liên tiếp`)
  await gate.respond(gate.head()!.id, "deny")
  expect(await third).toContain("Người dùng dừng vòng lặp")

  const fourth = runTool(quote, { symbol: "FPT" }, ctx, lock, gate)
  await tick()
  await gate.respond(gate.head()!.id, "session")
  expect(await fourth).toEqual({ output: "nến" })
  expect(await runTool(quote, { symbol: "FPT" }, ctx, lock, gate)).toEqual({ output: "nến" })
  expect(gate.head()).toBeUndefined()
})

test("without a UI the loop is stopped, and other symbols are unaffected", async () => {
  const gate = new PermissionGate(store)
  const loop = new LoopGuard()
  const ctx = { signal: new AbortController().signal, callId: "c", loop }
  const lock = new RwLock()
  await runTool(quote, { symbol: "FPT" }, ctx, lock, gate)
  await runTool(quote, { symbol: "FPT" }, ctx, lock, gate)
  expect(await runTool(quote, { symbol: "FPT" }, ctx, lock, gate).catch((e: Error) => e.message)).toContain("dừng vòng lặp")
  expect(await runTool(quote, { symbol: "HPG" }, ctx, lock, gate)).toEqual({ output: "nến" })
})
