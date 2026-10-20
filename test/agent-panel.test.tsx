import { afterAll, afterEach, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { reconcile } from "solid-js/store"
import { AgentPanel, LINGER_MS, panelRowsFor, panelWindow } from "../src/tui/agent-panel"
import { formatResult } from "../src/core/subagents/result"
import type { SubagentView } from "../src/core/subagents/types"
import { SPAWN_SUBAGENT } from "../src/core/tools/subagent/spawn"
import { setState } from "../src/tui/state"
import { Transcript } from "../src/tui/transcript"
import { setClockForTests } from "../src/tui/ui/clock"

let t = 5_000_000
const at = (ms: number) => {
  t = ms
  setClockForTests(() => t)
}

let setup: Awaited<ReturnType<typeof testRender>> | undefined
afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
  // The store is shared with the other test files.
  setState("agents", reconcile({}))
  setState({ approvals: [], panelFocus: undefined, lines: [], expandTools: false, agentSlots: { running: 0, waiting: 0, max: 10 } })
})
afterAll(() => setClockForTests(undefined))

function agent(id: string, over: Partial<SubagentView> = {}): SubagentView {
  return {
    id,
    type: "nghien-cuu",
    description: `Việc ${id}`,
    prompt: "",
    background: false,
    model: "",
    status: "running",
    createdAt: t - 60_000 + Number(id.replace(/\D/g, "") || 0),
    startedAt: t - 53_000,
    tools: [],
    toolCount: 0,
    usage: { input: 90_000, output: 12_400 },
    text: "",
    ...over,
  }
}

async function frame() {
  await setup!.renderOnce()
  return setup!.captureCharFrame()
}

test("main, then one row per agent: time and output tokens, the call it makes, a slot, a retry countdown", async () => {
  at(5_000_000)
  setState("agentSlots", { running: 10, waiting: 1, max: 10 })
  setState(
    "agents",
    reconcile({
      a1: agent("a1", { tools: [{ callId: "c", name: "valuation_run", label: "valuation_run(FPT)", status: "running" }] }),
      a2: agent("a2", { status: "queued", startedAt: undefined }),
      a3: agent("a3", { retry: { attempt: 1, max: 4, until: t + 5000, label: "provider lỗi tạm thời (503)" } }),
    }),
  )
  setup = await testRender(() => <AgentPanel />, { width: 100, height: 30 })
  const f = await frame()
  expect(f).toContain("main")
  expect(f).toMatch(/nghien-cuu\s+Việc a1 · valuation_run\(FPT\)\s+53s · ↓ 12,4k token/)
  expect(f).toMatch(/◌ nghien-cuu\s+Việc a2\s+chờ slot \(10\/10\)/)
  expect(f).toMatch(/Việc a3\s+△ thử lại sau 5s \(lần 1\/4\)/)
})

test("more agents than rows: the rest are counted, and the window follows the selected row", async () => {
  at(5_000_000)
  setState("agents", reconcile(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`a${i}`, agent(`a${i}`)]))))
  setup = await testRender(() => <AgentPanel />, { width: 100, height: 30 })
  let f = await frame()
  expect(f).toContain("Việc a0")
  expect(f).toContain("Việc a3")
  expect(f).not.toContain("Việc a4")
  expect(f).toContain("… +3 agent")
  setState("panelFocus", 6)
  f = await frame()
  expect(f).toMatch(/❯ nghien-cuu\s+Việc a6/)
  expect(f).not.toContain("Việc a0")
  expect(panelWindow(7, undefined)).toEqual({ start: 0, end: 4 })
  // A short terminal keeps fewer rows, never fewer than one agent and the count.
  expect(panelRowsFor(30)).toBe(5)
  expect(panelRowsFor(14)).toBe(5)
  expect(panelRowsFor(12)).toBe(3)
  expect(panelRowsFor(8)).toBe(2)
  expect(panelWindow(3, 2)).toEqual({ start: 0, end: 3 })
})

test("a finished agent lingers a few seconds with how it ended, then leaves (and so does the panel)", async () => {
  at(5_000_000)
  setState("agents", reconcile({ done: agent("done", { status: "completed", endedAt: t - 1000 }), bad: agent("bad", { status: "failed", endedAt: t - 1000 }) }))
  setup = await testRender(() => <AgentPanel />, { width: 100, height: 30 })
  let f = await frame()
  expect(f).toMatch(/✓ nghien-cuu\s+Việc done\s+xong · 52s · ↓ 12,4k token/)
  expect(f).toMatch(/✘ nghien-cuu\s+Việc bad\s+lỗi · 52s/)
  at(t + LINGER_MS)
  f = await frame()
  expect(f).not.toContain("main")
  expect(f.trim()).toBe("")
})

test("a resumed session's subagent is one line from its stored result; ctrl+o shows the report", async () => {
  const output = formatResult(
    { id: "ag-abc123", type: "nghien-cuu" },
    { status: "completed", text: "BÁO-CÁO: FPT ổn.", toolCount: 2, usage: { input: 1000, output: 234 }, durationMs: 5000 },
  )
  setState("lines", [{ kind: "tool", callId: "c1", name: SPAWN_SUBAGENT, label: "nghien-cuu(Đọc FPT)", status: "ok", output, step: 1 }])
  setup = await testRender(() => <Transcript />, { width: 100, height: 12 })
  let f = await frame()
  expect(f).toContain("● nghien-cuu (Đọc FPT) · xong · 2 tool · 1,2k token · 5s")
  expect(f).not.toContain("BÁO-CÁO")
  setState("expandTools", true)
  f = await frame()
  expect(f).toContain("BÁO-CÁO: FPT ổn.")
})
