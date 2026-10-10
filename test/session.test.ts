import { afterAll, expect, test } from "bun:test"
import { appendFile, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ModelMessage } from "ai"

const home = await mkdtemp(path.join(os.tmpdir(), "ot-session-"))
const previous = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home

const { closeDanglingToolCalls, listSessions, loadSession, Session, sessionsDir } = await import("../src/core/session/store")
const { transcriptFromMessages } = await import("../src/core/session/transcript")

afterAll(async () => {
  if (previous === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = previous
  await rm(home, { recursive: true, force: true })
})

const info = { cwd: "/w", provider: "groq", model: "m1", promptVersion: "abc", skills: [{ name: "devil-advocate", version: "1" }] }

const turn1: ModelMessage[] = [
  {
    role: "user",
    content: [
      { type: "text", text: "<nhac_nho>\n<phien_giao_dich>…</phien_giao_dich>\n</nhac_nho>" },
      { type: "text", text: "Mấy giờ rồi?" },
    ],
  },
  { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "current_time", input: {} }] },
  {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: "c1", toolName: "current_time", output: { type: "text", value: "10:00" } }],
  },
  { role: "assistant", content: [{ type: "text", text: "Bây giờ là 10:00." }] },
]
const turn2: ModelMessage[] = [
  { role: "user", content: "Cảm ơn" },
  { role: "assistant", content: "Không có gì." },
]

test("a session is created lazily, written turn by turn, and read back identically", async () => {
  const s = Session.create(new Date("2026-09-30T03:15:00Z"))
  expect(s.path).toBeUndefined() // nothing on disk before the first turn
  await s.appendTurn(turn1, info)
  await s.appendTurn(turn2, { ...info, model: "m2" })
  expect(s.file!.split(path.sep).join("/")).toMatch(/^2026\/09\/20260930-031500-\w+\.jsonl$/)

  const [summary] = await listSessions()
  expect(summary).toMatchObject({ id: s.id, title: "Mấy giờ rồi?", turns: 2, model: "m2" })
  const loaded = await loadSession(s.id)
  expect(loaded.messages).toEqual([...turn1, ...turn2])
  expect(loaded.meta).toMatchObject({ type: "meta", format: 1, cwd: "/w", promptVersion: "abc" })
  expect(loaded.patched).toBe(0)

  // Id prefixes are enough, as in `--resume 20260930`.
  expect((await loadSession(s.id.slice(0, 15))).summary.id).toBe(s.id)
})

test("continuing a session appends to the same file; newest session is listed first", async () => {
  const older = (await listSessions())[0]!
  const newer = Session.create()
  await newer.appendTurn(turn2, info)
  expect((await listSessions())[0]!.id).toBe(newer.id)

  const resumed = Session.continue(older)
  await resumed.appendTurn(turn2, info)
  const list = await listSessions()
  expect(list[0]).toMatchObject({ id: older.id, turns: 3 })
  expect((await loadSession(older.id)).messages).toHaveLength(turn1.length + turn2.length * 2)
})

test("a torn last line (crash mid-write) is skipped", async () => {
  const s = Session.create()
  await s.appendTurn(turn2, info)
  await appendFile(path.join(sessionsDir(), s.file!), '{"type":"message","ts":"x","message":{"role":"us')
  expect((await loadSession(s.id)).messages).toEqual(turn2)
})

test("tool calls without results are closed with an interrupted error", () => {
  const dangling: ModelMessage[] = [
    { role: "user", content: "x" },
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "a", toolName: "t", input: {} },
        { type: "tool-call", toolCallId: "b", toolName: "t", input: {} },
      ],
    },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "a", toolName: "t", output: { type: "text", value: "ok" } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "ghost", toolName: "t", output: { type: "text", value: "?" } }] },
  ]
  const { messages, patched } = closeDanglingToolCalls(dangling)
  expect(patched).toBe(1)
  expect(messages[2]).toMatchObject({ role: "tool", content: [{ toolCallId: "b", output: { type: "error-text" } }] })
  expect(JSON.stringify(messages)).not.toContain("ghost")
})

test("the transcript is rebuilt without reminder blocks", () => {
  const items = transcriptFromMessages([...turn1, ...turn2])
  expect(items).toEqual([
    { kind: "user", text: "Mấy giờ rồi?" },
    { kind: "tool", callId: "c1", name: "current_time", input: {}, ok: true, output: "10:00" },
    { kind: "assistant", text: "Bây giờ là 10:00." },
    { kind: "user", text: "Cảm ơn" },
    { kind: "assistant", text: "Không có gì." },
  ])
})

test("tools loaded by tool_search survive a resume (derived from the stored history)", async () => {
  const { loadedTools } = await import("../src/core/tools/loaded")
  const turn: ModelMessage[] = [
    { role: "user", content: "giá FPT" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "s1", toolName: "tool_search", input: { query: "select:a" } }] },
    {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "s1", toolName: "tool_search", output: { type: "text", value: "Đã nạp tool: mcp__ot__a, mcp__ot__b\n\n## mcp__ot__a" } }],
    },
    { role: "assistant", content: "xong" },
  ]
  const s = Session.create(new Date("2026-10-03T03:15:00Z"))
  await s.appendTurn(turn, info)
  const loaded = await loadSession(s.id)
  expect(loadedTools(loaded.messages)).toEqual(["tool_search", "mcp__ot__a", "mcp__ot__b"])
})

test("the todo list survives a resume (derived from the stored history)", async () => {
  const { currentTodos } = await import("../src/core/tools/todos")
  const todos = [
    { content: "Lấy giá", status: "completed" },
    { content: "So sánh ngành", status: "in_progress" },
  ] as const
  const turn: ModelMessage[] = [
    { role: "user", content: "phân tích FPT" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "t1", toolName: "todo_write", input: { todos } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "t1", toolName: "todo_write", output: { type: "text", value: "Đã cập nhật việc cần làm: 1/2 xong." } }] },
    { role: "assistant", content: "đang làm" },
  ]
  const s = Session.create(new Date("2026-10-06T03:15:00Z"))
  await s.appendTurn(turn, info)
  expect(currentTodos((await loadSession(s.id)).messages)).toEqual([...todos])
})

test("a compaction replaces the model's history on resume; the transcript still shows everything", async () => {
  const { compactPair } = await import("../src/core/compact-marker")
  const s = Session.create(new Date("2026-10-06T04:00:00Z"))
  await s.appendTurn(turn1, { ...info, contextTokens: 50_000 })
  await s.appendTurn(turn2, info)
  const compacted = [...compactPair("TÓM TẮT", { tools: ["mcp__ot__a"], skills: [], todos: [] }), ...turn2]
  await s.appendCompact({ trigger: "manual", before: 60_000, after: 9_000, messages: compacted })
  const turn3: ModelMessage[] = [
    { role: "user", content: "tiếp" },
    { role: "assistant", content: "ừ" },
  ]
  await s.appendTurn(turn3, { ...info, contextTokens: 9_500 })

  const loaded = await loadSession(s.id)
  expect(loaded.messages).toEqual([...compacted, ...turn3])
  expect(loaded.contextTokens).toBe(9_500)
  // Display: the original turns, then the marker and summary where the compaction happened.
  expect(loaded.display).toEqual([...turn1, ...turn2, ...compacted.slice(0, 2), ...turn3])
  const items = transcriptFromMessages(loaded.display)
  expect(items.filter((i) => i.kind === "compact")).toEqual([{ kind: "compact", text: "TÓM TẮT" }])
  expect(JSON.stringify(items)).not.toContain("tom_tat_hoi_thoai")

  // Pruning only (no summary): the model history is replaced, the transcript gains nothing.
  const p = Session.create(new Date("2026-10-06T04:10:00Z"))
  await p.appendTurn(turn1, info)
  await p.appendCompact({ trigger: "auto", before: 10_000, after: 4_000, messages: turn2 })
  const pruned = await loadSession(p.id)
  expect(pruned.messages).toEqual(turn2)
  expect(pruned.display).toEqual(turn1)
  expect(pruned.contextTokens).toBe(4_000)
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
