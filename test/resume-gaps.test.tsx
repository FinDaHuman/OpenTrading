import { afterAll, afterEach, expect, test } from "bun:test"
import { appendFile, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { testRender } from "@opentui/solid"
import type { ModelMessage } from "ai"
import { renderedFrame } from "./helpers/tui"

// #342: the "! N nguồn lỗi" line under an answer comes back when the session is reopened.
// Isolated state dir before core modules read it; no network.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-resume-gaps-"))
const previous = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json({})
  throw new Error(`no network in tests: ${url}`)
}) as typeof fetch

const store = await import("../src/core/session/store")
const { loadSession, Session, sessionsDir } = store
const { gapsLine } = await import("../src/core/loop/failures")
const { App } = await import("../src/tui/app")
const { state, setState } = await import("../src/tui/state")
const { resumeSession, startSession } = await import("../src/tui/session")
const { initRuntime } = await import("../src/core/runtime")

type Runtime = ReturnType<typeof initRuntime>
let setup: Awaited<ReturnType<typeof testRender>> | undefined
let runtime: Runtime | undefined

afterEach(async () => {
  setup?.renderer.destroy()
  setup = undefined
  if (runtime) {
    // The next test file must not start on this file's session.
    await startSession(runtime, "clear")
    await runtime.mcp.stop()
  }
  runtime = undefined
  setState({ lines: [], dialog: undefined })
})
afterAll(async () => {
  globalThis.fetch = realFetch
  if (previous === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = previous
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const info = { cwd: "/w", provider: "groq", model: "m1" }
const user = (text: string): ModelMessage => ({ role: "user", content: text })
const answer = (text: string): ModelMessage => ({ role: "assistant", content: text })
const card = (turn: number) => ({ id: `the-${turn}-a1b2`, turn, kind: "constraint" as const, text: "Không gợi ý cổ phiếu penny", quote: "đừng gợi ý cổ phiếu penny" })

test("loadSession places each turn's data gaps right after that turn's answer", async () => {
  const s = Session.create()
  await s.appendTurn([user("Câu 1"), answer("Trả lời 1")], { ...info, dataGaps: ["mcp__ot__price"] })
  await s.appendTurn([user("Câu 2"), answer("Trả lời 2")], info)
  await s.appendTurn([user("Câu 3"), answer("Trả lời 3")], { ...info, dataGaps: ["a", "b"] })
  const loaded = await loadSession(s.id)
  expect(loaded.gaps).toEqual([
    { gaps: ["mcp__ot__price"], at: 2 },
    { gaps: ["a", "b"], at: 6 },
  ])
  expect(loaded.display[1]).toEqual(answer("Trả lời 1"))
  // The model never reads the line.
  expect(JSON.stringify(loaded.messages)).not.toContain("nguồn lỗi")
})

test("a malformed dataGaps value is ignored; the session still loads", async () => {
  const s = Session.create()
  await s.appendTurn([user("Câu 1"), answer("Trả lời 1")], info)
  const file = path.join(sessionsDir(), (await store.listSessions()).find((x) => x.id === s.id)!.file)
  await appendFile(file, JSON.stringify({ type: "turn_end", ts: "x", turn: 2, dataGaps: "not-a-list" }) + "\n")
  await appendFile(file, JSON.stringify({ type: "turn_end", ts: "x", turn: 3, dataGaps: [1, null] }) + "\n")
  const loaded = await loadSession(s.id)
  expect(loaded.gaps).toEqual([])
  expect(loaded.display).toHaveLength(2)
})

test("a resumed session shows the gaps line again under its answer, above that turn's card", async () => {
  const s = Session.create()
  await s.appendTurn([user("Giá HPG?"), answer("CÂU-TRẢ-LỜI-MỘT")], { ...info, dataGaps: ["mcp__ot__price"] })
  s.noteCard(card(2))
  await s.appendTurn([user("Còn FPT?"), answer("CÂU-TRẢ-LỜI-HAI")], { ...info, dataGaps: ["mcp__ot__fs"] })
  await s.appendTurn([user("Cảm ơn"), answer("CÂU-TRẢ-LỜI-BA")], info)

  runtime = initRuntime({ home, skills: () => [] })
  setup = await testRender(() => <App runtime={runtime!} onExit={() => {}} />, { width: 110, height: 44, exitOnCtrlC: false })
  await renderedFrame(setup, "Hỏi về thị trường")
  await resumeSession(runtime, s.id)

  const kinds = state.lines.filter((l) => l.kind !== "info" || l.text.startsWith("!")).map((l) => (l.kind === "info" ? l.text : l.kind))
  expect(kinds).toEqual(["user", "assistant", gapsLine(["mcp__ot__price"]), "user", "assistant", gapsLine(["mcp__ot__fs"]), "card", "user", "assistant"])
  const frame = await renderedFrame(setup, "CÂU-TRẢ-LỜI-BA")
  expect(frame).toContain("! 1 nguồn lỗi chưa khắc phục trong lượt này: mcp__ot__price")
  expect(frame).toContain("! 1 nguồn lỗi chưa khắc phục trong lượt này: mcp__ot__fs")
  expect(frame.indexOf("CÂU-TRẢ-LỜI-MỘT")).toBeLessThan(frame.indexOf("mcp__ot__price"))
  expect(frame.indexOf("mcp__ot__price")).toBeLessThan(frame.indexOf("CÂU-TRẢ-LỜI-HAI"))
})
