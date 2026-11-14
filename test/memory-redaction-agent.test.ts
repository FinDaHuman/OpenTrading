import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import type { ModelMessage } from "ai"
import { HPG_BLOCK_V3, HPG_V3, seedExample, useNotebookDir } from "./helpers/memory-notebook"
import { chunkFor, sse } from "./helpers/chat"

// Isolated state dir before core modules read it; no retry waits.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-redaction-agent-"))
const savedHome = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home
process.env.OPENTRADING_RETRY_SCALE = "0"

const text = { input: ["text"], output: ["text"] }
const CATALOG = {
  groq: {
    id: "groq",
    name: "Groq",
    env: ["GROQ_API_KEY"],
    npm: "@ai-sdk/groq",
    models: { big: { id: "big", name: "big", tool_call: true, modalities: text, limit: { context: 300_000, output: 8000 } } },
  },
}

type Body = { messages: { role: string; content?: unknown }[]; stream?: boolean }
const bodies: Body[] = []
/** Tool calls the fake model makes, one per request, before it answers in text. */
let calls: { tool: string; args: object }[] = []

const chunk = chunkFor("m")

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  if (!url.endsWith("/chat/completions")) throw new Error(`unexpected fetch ${url}`)
  const body = JSON.parse(String(init?.body)) as Body
  bodies.push(body)
  if (!body.stream) {
    return Response.json({
      id: "c",
      object: "chat.completion",
      created: 1,
      model: "m",
      choices: [{ index: 0, message: { role: "assistant", content: "<summary>## Yêu cầu của người dùng\nTÓM-TẮT-GIẢ</summary>" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  }
  const next = calls.shift()
  if (next) {
    const id = `call_${bodies.length}`
    return sse([
      chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name: next.tool, arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(next.args) } }] }),
      chunk({}, "tool_calls"),
    ])
  }
  return sse([chunk({ role: "assistant", content: "Đã xem." }), chunk({}, "stop")])
}) as typeof fetch

const { runAgent, summarizeConversation } = await import("../src/core/agent")
const { compactPair } = await import("../src/core/compact-marker")
const { compactCode } = await import("../src/core/memory/notebook/provider")
const { LABELS_ONLY_NOTE, labelsOnly } = await import("../src/core/memory/notebook/labels-only")
const { ToolRegistry } = await import("../src/core/tools/registry")
const { saveConfig } = await import("../src/core/config")
const { setKey } = await import("../src/core/auth")
const { HookBus } = await import("../src/core/hooks")
const { createConstraintReader, constraintDisk } = await import("../src/core/memory/binding/constraints")
const { createRedactionCheck } = await import("../src/core/memory/redaction/check")
const { alreadyShown, heldLesson, maskedLesson, reminders } = await import("../src/core/memory/notebook/render")
type AgentEvent = import("../src/core/events").AgentEvent
type Waiver = import("../src/core/memory/binding/bind").Waiver

beforeAll(async () => {
  await setKey("groq", "gsk_test")
})
afterAll(async () => {
  globalThis.fetch = realFetch
  if (savedHome === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = savedHome
  await rm(home, { recursive: true, force: true })
})
beforeEach(async () => {
  bodies.length = 0
  calls = []
  await saveConfig({ provider: "groq", model: "big" })
})
const spies: { mockRestore(): void }[] = []
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore()
})

const nb = useNotebookDir()
/** Lesson #7 of the shared example: its summary is the marker looked for in requests. */
const MARK7 = "Dùng P/B và ROE"

/**
 * A session the way the TUI drives it: the history is the TUI's, the masks the core confirms replace it
 * (memory-redaction), the turn's messages are appended. `restart()` is a new app: a new provider, nothing
 * in RAM, the same history (a resumed session).
 */
function session(extraTools: import("../src/core/tools/types").ToolDef[] = []) {
  let notebook = nb.notebook()
  let history: ModelMessage[] = []
  const make = () => {
    const registry = new ToolRegistry()
    for (const tool of notebook.tools()) registry.register({ ...tool, source: `memory:${notebook.id}` })
    for (const tool of extraTools) registry.register(tool)
    const hooks = new HookBus()
    notebook.register(hooks)
    return { registry, hooks }
  }
  let wiring = make()
  const turn = async (input: string, o: { waive?: Waiver; keep?: boolean; compactAt?: number } = {}) => {
    const from = bodies.length
    const events: AgentEvent[] = []
    for await (const e of runAgent({
      history,
      input,
      skills: [],
      ...wiring,
      memory: notebook,
      sessionId: "s1",
      constraints: createConstraintReader(nb.file()),
      redaction: createRedactionCheck(nb.file()),
      waive: o.waive,
      compactAt: o.compactAt,
    })) {
      events.push(e)
      if (e.type === "memory-redaction") history = e.kept
    }
    const done = events.find((e) => e.type === "done") as Extract<AgentEvent, { type: "done" }>
    // keep: false is a turn the app dropped (cut for context) and will send again.
    if (o.keep !== false) history = [...history, ...done.messages]
    return { events, requests: bodies.slice(from) }
  }
  return {
    turn,
    restart() {
      notebook.close()
      notebook = nb.notebook()
      wiring = make()
    },
    history: () => history,
    setHistory(messages: ModelMessage[]) {
      history = messages
    },
  }
}

const all = (requests: Body[]) => JSON.stringify(requests)
/** The memory part of the turn's own user message in its first request. */
function memoryPart(requests: Body[]): string {
  const user = requests[0]!.messages.findLast((m) => m.role === "user")!
  const s = JSON.stringify(user.content)
  const start = s.indexOf("<memory_lien_quan>")
  return start < 0 ? "" : s.slice(start, s.indexOf("</memory_lien_quan>") + 19)
}
const toolOutputs = (requests: Body[]) =>
  requests.flatMap((b) => b.messages.filter((m) => m.role === "tool").map((m) => String(m.content)))
const HPG_LABEL = HPG_BLOCK_V3.split("\n")[0]!
const HPG_V4 = { ...HPG_V3, text: "Hưởng lợi từ đầu tư công và giá thép" }

describe("Story 1: a resumed session neither repeats nor misses blocks", () => {
  test("1: restarted, same history: no new HPG block; the old one goes as it was sent", async () => {
    const ids = seedExample(nb.store())
    void ids
    const s = session()
    const t1 = await s.turn("Hòa Phát?")
    expect(memoryPart(t1.requests)).toContain(HPG_LABEL)
    s.restart()
    const t2 = await s.turn("HPG còn rủi ro nào?")
    expect(memoryPart(t2.requests)).toBe("")
    expect(all(t2.requests).split(JSON.stringify(HPG_LABEL).slice(1, -1)).length - 1).toBe(1)
  })

  test("2 and TC-002: v4 saved before resuming: the v4 block 'replacing v3', no extra note; same bytes as without restart", async () => {
    const other = nb.store()
    const ids = seedExample(other)
    const a = session()
    const b = session()
    await a.turn("Hòa Phát?")
    await b.turn("Hòa Phát?")
    other.writer.saveThesis(ids.hpg, 3, HPG_V4)
    b.restart()
    const ta = memoryPart((await a.turn("HPG còn rủi ro nào?")).requests)
    const tb = memoryPart((await b.turn("HPG còn rủi ro nào?")).requests)
    expect(tb).toContain("bản 4 · ghi 20/10/2026 · người dùng tự ghi · thay cho bản 3 đã gửi trước đó trong phiên")
    expect(tb).not.toContain("đã có bản 4")
    expect(tb).toBe(ta)
  })

  test("3 and 4: out of focus, the v4 note once; restarted again, never repeated", async () => {
    const other = nb.store()
    const ids = seedExample(other)
    const s = session()
    await s.turn("Hòa Phát?")
    // Two typed turns later HPG has left the focus window (this turn and the two before), restart or not.
    await s.turn("VCB có rẻ không?")
    await s.turn("Còn ACB?")
    other.writer.saveThesis(ids.hpg, 3, HPG_V4)
    s.restart()
    const note = reminders.thesisNewVersion("HPG", 4, 3)
    expect(memoryPart((await s.turn("MBB thì sao?")).requests)).toContain(note)
    s.restart()
    expect(memoryPart((await s.turn("Còn TCB?")).requests)).not.toContain(note)
  }, 15_000)

  test("restarted: a follow-up keeps the subjects of the turns before it (the window is rebuilt from the history)", async () => {
    const other = nb.store()
    const ids = seedExample(other)
    const a = session()
    const b = session()
    await a.turn("Hòa Phát?")
    await b.turn("Hòa Phát?")
    other.writer.saveThesis(ids.hpg, 3, HPG_V4)
    b.restart()
    // Nothing in these words names HPG: only the window carries it.
    const ta = memoryPart((await a.turn("Điều kiện thứ hai thì sao?")).requests)
    const tb = memoryPart((await b.turn("Điều kiện thứ hai thì sao?")).requests)
    expect(tb).toContain("bản 4 · ghi 20/10/2026 · người dùng tự ghi · thay cho bản 3 đã gửi trước đó trong phiên")
    expect(tb).toBe(ta)
  })

  test("5: a turn dropped and sent again carries the block", async () => {
    seedExample(nb.store())
    const s = session()
    expect(memoryPart((await s.turn("Hòa Phát?", { keep: false })).requests)).toContain(HPG_LABEL)
    expect(memoryPart((await s.turn("Hòa Phát?")).requests)).toContain(HPG_LABEL)
  })

  test("6: notebook switched off and on (a new provider): the block is not injected again", async () => {
    seedExample(nb.store())
    const s = session()
    await s.turn("Hòa Phát?")
    s.restart()
    expect(memoryPart((await s.turn("Hòa Phát thì sao?")).requests)).toBe("")
  })
})

describe("Story 2: deleting masks the block in the open conversation", () => {
  test("1: #7 read in turn 1, deleted while idle: no later request has it; one note; the confirmed mask is reported", async () => {
    const other = nb.store()
    seedExample(other)
    const s = session()
    calls = [{ tool: "memory_read", args: { lesson: 7 } }]
    const t1 = await s.turn("Bài học định giá ngân hàng?")
    expect(all(t1.requests)).toContain(MARK7)
    other.writer.deleteLesson(7, 1)
    const t2 = await s.turn("Còn ACB thì sao?")
    expect(all(t2.requests)).not.toContain(MARK7)
    const event = t2.events.find((e) => e.type === "memory-redaction") as Extract<AgentEvent, { type: "memory-redaction" }>
    expect(event.record).toEqual([{ kind: "lesson", id: 7, versions: [1] }])
    expect(memoryPart(t2.requests)).toContain(reminders.lessonDeleted(7))
    const t3 = await s.turn("Tiếp")
    expect(all(t3.requests)).not.toContain(MARK7)
    expect(memoryPart(t3.requests)).not.toContain(reminders.lessonDeleted(7))
    expect(t3.events.some((e) => e.type === "memory-redaction")).toBe(false)
  })

  test("7: deleted while the turn runs: the rest of that turn is unchanged, the next turn has no #7", async () => {
    const other = nb.store()
    seedExample(other)
    const remove = {
      name: "xoa_bai_7",
      description: "test",
      input: z.object({}),
      readOnly: true,
      async execute() {
        other.writer.deleteLesson(7, 1)
        return "ok"
      },
    }
    const s = session([remove])
    calls = [
      { tool: "memory_read", args: { lesson: 7 } },
      { tool: "xoa_bai_7", args: {} },
    ]
    const t1 = await s.turn("Bài học định giá ngân hàng?")
    expect(t1.requests.length).toBe(3)
    expect(JSON.stringify(t1.requests[2])).toContain(MARK7)
    const t2 = await s.turn("Còn ACB thì sao?")
    expect(all(t2.requests)).not.toContain(MARK7)
  })
})

describe("held turns (spec 005) and running on without the store", () => {
  test("an unreadable store holds the turn: no redaction event; waived, the block is held in what is sent", async () => {
    seedExample(nb.store())
    const s = session()
    calls = [{ tool: "memory_read", args: { lesson: 7 } }]
    await s.turn("Bài học định giá ngân hàng?")
    const denied = spyOn(constraintDisk, "probe").mockImplementation(async () => {
      throw Object.assign(new Error("không có quyền"), { code: "EACCES" })
    })
    spies.push(denied)
    await expect(s.turn("Tiếp")).rejects.toThrow()
    const run = await s.turn("Tiếp", { waive: { constraints: true } })
    const event = run.events.find((e) => e.type === "memory-redaction") as Extract<AgentEvent, { type: "memory-redaction" }>
    expect(event.temporary).toMatchObject({ state: "failed", blocks: 1 })
    expect(event.record).toEqual([])
    expect(all(run.requests)).not.toContain(MARK7)
    expect(all(run.requests)).toContain(JSON.stringify(heldLesson(7, 1)).slice(1, -1))
    // The history keeps the block: it comes back once the store can vouch for it.
    expect(JSON.stringify(s.history())).toContain(MARK7)
  })
})

describe("Story 6: memory_read answers in one sentence when the block is in view", () => {
  test("read twice: the second answer points at the label; a new version gives the full block", async () => {
    const other = nb.store()
    seedExample(other)
    const s = session()
    calls = [{ tool: "memory_read", args: { lesson: 7 } }]
    await s.turn("Bài học 7?")
    calls = [{ tool: "memory_read", args: { lesson: 7 } }]
    const t2 = await s.turn("Đọc lại bài 7")
    expect(toolOutputs(t2.requests).at(-1)).toContain(alreadyShown.lesson(7, 1))
    other.writer.reviseLesson(7, 1, { title: "Định giá ngân hàng", summary: "Dùng P/B, ROE và NIM" })
    calls = [{ tool: "memory_read", args: { lesson: 7 } }]
    const t3 = await s.turn("Đọc lại lần nữa")
    expect(toolOutputs(t3.requests).at(-1)).toContain("[Memory · bài học · #7 · bản 2 ·")
  })
})

describe("Story 2, the other scenarios, through the agent loop", () => {
  const redactionOf = (events: AgentEvent[]) =>
    events.find((e) => e.type === "memory-redaction") as Extract<AgentEvent, { type: "memory-redaction" }> | undefined
  const lastToolText = (requests: Body[]) => toolOutputs(requests).at(-1)!

  test("2: a search gave #3 and #7, HPG in the reminder: only #7 is replaced, the rest byte for byte", async () => {
    const other = nb.store()
    seedExample(other)
    const s = session()
    calls = [{ tool: "memory_read", args: { query: "ngân hàng giải ngân" } }]
    const t1 = await s.turn("Hòa Phát và bài học ngân hàng giải ngân?")
    const before = lastToolText(t1.requests)
    expect(before).toContain(MARK7)
    expect(before).toContain("Giải ngân từng phần")
    other.writer.deleteLesson(7, 1)
    const t2 = await s.turn("Còn ACB?")
    const start = before.indexOf("[Memory · bài học · #7")
    const end = before.indexOf("\n\n", start)
    const expected = before.slice(0, start) + maskedLesson(7) + (end < 0 ? "" : before.slice(end))
    expect(toolOutputs(t2.requests)).toContain(expected)
    expect(all(t2.requests)).toContain(JSON.stringify(HPG_BLOCK_V3).slice(1, -1))
    expect(all(t2.requests)).not.toContain(MARK7)
  })

  test("3: #7 in two turns (a read, then a search): both places masked", async () => {
    const other = nb.store()
    seedExample(other)
    const s = session()
    calls = [{ tool: "memory_read", args: { lesson: 7 } }]
    await s.turn("Bài 7?")
    await s.turn("Tiếp")
    calls = [{ tool: "memory_read", args: { query: "định giá" } }]
    await s.turn("Tìm bài định giá")
    expect(JSON.stringify(s.history()).split(MARK7).length - 1).toBe(2)
    other.writer.deleteLesson(7, 1)
    const t4 = await s.turn("Còn ACB?")
    expect(all(t4.requests)).not.toContain(MARK7)
    expect(JSON.stringify(s.history()).split(JSON.stringify(maskedLesson(7)).slice(1, -1)).length - 1).toBe(2)
    expect(redactionOf(t4.events)!.record).toEqual([{ kind: "lesson", id: 7, versions: [1] }])
  })

  test("4: the deletion note comes once (also checked in scenario 1)", async () => {
    const other = nb.store()
    seedExample(other)
    const s = session()
    calls = [{ tool: "memory_read", args: { lesson: 7 } }]
    await s.turn("Bài 7?")
    other.writer.deleteLesson(7, 1)
    const notes = async (q: string) => memoryPart((await s.turn(q)).requests).split(reminders.lessonDeleted(7)).length - 1
    expect(await notes("a")).toBe(1)
    expect(await notes("b")).toBe(0)
  })

  test("5: an item this session never showed is deleted: history unchanged, no line, no note", async () => {
    const other = nb.store()
    seedExample(other)
    const s = session()
    calls = [{ tool: "memory_read", args: { lesson: 7 } }]
    await s.turn("Bài 7?")
    const before = s.history().length
    const beforeText = JSON.stringify(s.history())
    other.writer.deleteLesson(3, 1)
    const t2 = await s.turn("Còn ACB?")
    expect(redactionOf(t2.events)).toBeUndefined()
    expect(memoryPart(t2.requests)).not.toContain("#3")
    expect(JSON.stringify(s.history().slice(0, before))).toBe(beforeText)
  })

  test("6: deleted from another window (another connection): the next request has no #7, the line is reported", async () => {
    seedExample(nb.store())
    const s = session()
    calls = [{ tool: "memory_read", args: { lesson: 7 } }]
    await s.turn("Bài 7?")
    // A second window: its own connection to the same file.
    const windowB = nb.store()
    windowB.writer.deleteLesson(7, 1)
    const t2 = await s.turn("Tiếp")
    expect(all(t2.requests)).not.toContain(MARK7)
    expect(redactionOf(t2.events)!.record).toEqual([{ kind: "lesson", id: 7, versions: [1] }])
  })

  test("8: thesis blocks of two versions in the session: both masked when the thesis is deleted", async () => {
    const other = nb.store()
    seedExample(other)
    const vnm = other.writer.createSubject({ kind: "ticker", alias: "VNM" }).id
    other.writer.saveThesis(vnm, null, { text: "VNM-BAN-1", conditions: [] })
    const s = session()
    await s.turn("VNM?")
    other.writer.saveThesis(vnm, 1, { text: "VNM-BAN-2", conditions: [] })
    await s.turn("VNM nữa?")
    expect(JSON.stringify(s.history())).toContain("VNM-BAN-1")
    expect(JSON.stringify(s.history())).toContain("VNM-BAN-2")
    other.writer.deleteThesis(vnm, 2)
    const t3 = await s.turn("Còn ACB?")
    expect(all(t3.requests)).not.toContain("VNM-BAN-")
    expect(redactionOf(t3.events)!.record).toEqual([{ kind: "thesis", name: "VNM", versions: [1, 2] }])
  })
})

describe("Story 6, the other scenarios, through the agent loop", () => {
  test("3: the old result pruned from this step's request: memory_read gives the full block", async () => {
    const other = nb.store()
    seedExample(other)
    // Long enough to be pruned (old tool results over 500 characters).
    const id = other.writer.addLesson({ title: "Bài dài", summary: "Tóm tắt", detail: "chi tiết ".repeat(120) }).id
    const s = session()
    calls = [{ tool: "memory_read", args: { lesson: id } }]
    await s.turn("Bài dài?")
    await s.turn("a")
    await s.turn("b")
    calls = [{ tool: "memory_read", args: { lesson: id } }]
    const pruned = await s.turn("Đọc lại bài dài", { compactAt: 1 })
    expect(toolOutputs(pruned.requests).at(-1)).toContain(`[Memory · bài học · #${id} · bản 1 ·`)
    // Without the pruning, the same call is answered with the one sentence.
    calls = [{ tool: "memory_read", args: { lesson: id } }]
    const plain = await s.turn("Đọc lại lần nữa")
    expect(toolOutputs(plain.requests).at(-1)).toContain(alreadyShown.lesson(id, 1))
  })

  test("4: the block only in the part kept after a compaction: the one sentence", async () => {
    seedExample(nb.store())
    const s = session()
    calls = [{ tool: "memory_read", args: { lesson: 7 } }]
    await s.turn("Bài 7?")
    // What a compaction leaves: a summary in place of the older turns, the recent turns kept as they were.
    const kept = s.history()
    s.setHistory([...compactPair("Tóm tắt phần đầu.", { tools: [], skills: [], todos: [] }), ...kept])
    calls = [{ tool: "memory_read", args: { lesson: 7 } }]
    const t = await s.turn("Đọc lại bài 7")
    expect(toolOutputs(t.requests).at(-1)).toContain(alreadyShown.lesson(7, 1))
  })
})

// ── Spec 007: memory and compaction ──────────────────────────────────────────────────────────────

describe("compaction (spec 007)", () => {
  const LESSON_7_TEXT = "Dùng P/B và ROE, không dùng P/E"
  const carry = { tools: [], skills: [], todos: [] }

  test("labelsOnly: blocks in both channels keep their label line only; a label the user typed is left as it is", async () => {
    seedExample(nb.store())
    const s = session()
    await s.turn("Hòa Phát?")
    calls = [{ tool: "memory_read", args: { lesson: 7 } }]
    await s.turn("Bài 7?")
    const typed: ModelMessage = { role: "user", content: `${HPG_LABEL}\nTôi tự gõ dòng này` }
    const history = [...s.history(), typed]
    const cut = JSON.stringify(labelsOnly(history))
    expect(JSON.stringify(history)).toContain(LESSON_7_TEXT)
    expect(cut).not.toContain(LESSON_7_TEXT)
    expect(cut).not.toContain(JSON.stringify(HPG_V3.text).slice(1, -1))
    expect(cut.split(JSON.stringify(LABELS_ONLY_NOTE).slice(1, -1)).length - 1).toBe(2)
    expect(cut).toContain("Tôi tự gõ dòng này")
    // A message with no block is the very same object.
    expect(labelsOnly(history).at(-1)).toBe(typed)
  })

  test("the summary request carries no memory content, no index and no constraint block", async () => {
    seedExample(nb.store())
    const s = session()
    await s.turn("Hòa Phát?")
    calls = [{ tool: "memory_read", args: { lesson: 7 } }]
    await s.turn("Bài 7?")
    const from = bodies.length
    const registry = new ToolRegistry()
    const summary = await summarizeConversation({
      head: s.history(),
      prompt: "TÓM-TẮT",
      skills: [],
      registry,
      memory: nb.notebook(),
      constraints: createConstraintReader(nb.file()),
    })
    expect(summary).toContain("TÓM-TẮT-GIẢ")
    const sent = all(bodies.slice(from))
    expect(sent).not.toContain(LESSON_7_TEXT)
    expect(sent).not.toContain("[Sổ ghi nhớ · mục lục")
    expect(sent).not.toContain("<rang_buoc>")
    expect(sent).toContain(JSON.stringify(LABELS_ONLY_NOTE).slice(1, -1))
  })

  test("the first turn after a compaction gets the note once; a second compaction gets its own", async () => {
    seedExample(nb.store())
    const s = session()
    await s.turn("Hòa Phát?")
    const first = compactPair("Tóm tắt lần một.", carry)
    s.setHistory([...first, ...s.history().slice(-2)])
    const code1 = compactCode(s.history())!
    const t1 = await s.turn("Còn gì nữa?")
    expect(memoryPart(t1.requests)).toContain(reminders.compacted(code1))
    const t2 = await s.turn("Thêm một câu.")
    expect(memoryPart(t2.requests)).not.toContain("đã được nén")
    // A second compaction whose kept tail still holds the first note: its own note all the same.
    const second = compactPair("Tóm tắt lần hai.", carry)
    s.setHistory([...second, ...s.history().slice(-4)])
    const code2 = compactCode(s.history())!
    expect(code2).not.toBe(code1)
    const t3 = await s.turn("Tiếp nhé.")
    expect(memoryPart(t3.requests)).toContain(reminders.compacted(code2))
  })

  test("no compaction marker, no note; the note survives a restart without being said again", async () => {
    seedExample(nb.store())
    const s = session()
    const t0 = await s.turn("Hòa Phát?")
    expect(memoryPart(t0.requests)).not.toContain("đã được nén")
    s.setHistory([...compactPair("Tóm tắt.", carry), ...s.history()])
    await s.turn("Còn gì nữa?")
    s.restart()
    const t = await s.turn("Thêm một câu.")
    expect(memoryPart(t.requests)).not.toContain("đã được nén")
  })

  test("after a compaction the index is rendered afresh", async () => {
    seedExample(nb.store())
    const s = session()
    await s.turn("Hòa Phát?")
    const added = nb.store().writer.addLesson({ title: "Không bình quân giá xuống", summary: "x" }).id
    const before = await s.turn("Còn gì?")
    expect(all(before.requests)).not.toContain(`#${added} Không bình quân giá xuống`)
    s.setHistory([...compactPair("Tóm tắt.", carry), ...s.history().slice(-2)])
    const after = await s.turn("Tiếp nhé.")
    expect(all(after.requests)).toContain(`#${added} Không bình quân giá xuống`)
  })
})
