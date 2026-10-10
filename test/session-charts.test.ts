import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const home = await mkdtemp(path.join(os.tmpdir(), "ot-session-chart-"))
const previous = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home
const { Session, loadSession } = await import("../src/core/session/store")

afterAll(async () => {
  if (previous === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = previous
  await rm(home, { recursive: true, force: true })
})

test("a chart drawn during a turn is written with the turn and comes back on resume, keyed by its tool call", async () => {
  const session = Session.create()
  // Drawn mid-turn, before the session file exists.
  session.noteChart("call_7", { kind: "line", symbol: "FPT", series: [1, 2, 3] })
  await session.appendTurn(
    [
      { role: "user", content: "vẽ FPT" },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "call_7", toolName: "chart_render", input: { kind: "line", from_call: "r1" } }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "call_7", toolName: "chart_render", output: { type: "text", value: "Đã vẽ line FPT 3 điểm" } }] },
    ],
    { cwd: home },
  )
  const loaded = await loadSession(session.id)
  expect(loaded.charts.get("call_7")).toEqual({ kind: "line", symbol: "FPT", series: [1, 2, 3] })
  // Written once: the next turn does not repeat it.
  await session.appendTurn([{ role: "user", content: "tiếp" }], { cwd: home })
  expect((await loadSession(session.id)).charts.size).toBe(1)
})
