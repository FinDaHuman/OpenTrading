import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ModelMessage } from "ai"
import { seedExample, useNotebookDir } from "./helpers/memory-notebook"

// Isolated state dir before core modules read it; no retry waits.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-cards-agent-"))
const savedHome = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home
process.env.OPENTRADING_RETRY_SCALE = "0"

const text = { input: ["text"], output: ["text"] }
const model = (id: string, context: number) => ({ id, name: id, tool_call: true, modalities: text, limit: { context, output: 8000 } })
const CATALOG = {
  groq: { id: "groq", name: "Groq", env: ["GROQ_API_KEY"], npm: "@ai-sdk/groq", models: { big: model("big", 300_000), small: model("small", 32_000) } },
}

type Body = { messages: { role: string; content?: unknown }[]; stream?: boolean }
const bodies: Body[] = []
/** What the fake model writes, one entry per request; a tool call when it is an object. */
let replies: (string | { tool: string; args: object; text?: string })[] = []

const sse = (chunks: object[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  })
const chunk = (delta: object, finish: string | null = null) => ({
  id: "c",
  object: "chat.completion.chunk",
  created: 1,
  model: "m",
  choices: [{ index: 0, delta, finish_reason: finish }],
})

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  if (!url.endsWith("/chat/completions")) throw new Error(`unexpected fetch ${url}`)
  bodies.push(JSON.parse(String(init?.body)) as Body)
  const next = replies.shift() ?? "Đã xem."
  if (typeof next === "object") {
    const id = `call_${bodies.length}`
    return sse([
      // Text in the same step as the tool call (a block there is never a card).
      ...(next.text ? [chunk({ role: "assistant", content: next.text })] : []),
      chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name: next.tool, arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(next.args) } }] }),
      chunk({}, "tool_calls"),
    ])
  }
  return sse([chunk({ role: "assistant", content: next }), chunk({}, "stop")])
}) as typeof fetch

const { runAgent } = await import("../src/core/agent")
const { ToolRegistry } = await import("../src/core/tools/registry")
const { saveConfig } = await import("../src/core/config")
const { setKey } = await import("../src/core/auth")
const { reminders } = await import("../src/core/memory/notebook/render")
type AgentEvent = import("../src/core/events").AgentEvent
type CardOutcome = import("../src/core/memory/cards/types").CardOutcome

const nb = useNotebookDir()

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
  replies = []
  await saveConfig({ provider: "groq", model: "big" })
})

const TYPED = "Từ giờ đừng bao giờ gợi ý cổ phiếu penny cho tôi"
const ANSWER = "Ghi nhận: mình sẽ không gợi ý cổ phiếu penny cho bạn nữa."
const BLOCK = `<the_goi_y loai="rang_buoc">\nnoi_dung: Không gợi ý cổ phiếu penny\ncau_goc: ${TYPED}\n</the_goi_y>`

async function turn(input: string, o: { cards?: boolean; history?: ModelMessage[]; outcomes?: CardOutcome[]; memory?: boolean } = {}) {
  const notebook = nb.notebook()
  const registry = new ToolRegistry()
  for (const tool of notebook.tools()) registry.register({ ...tool, source: `memory:${notebook.id}` })
  const from = bodies.length
  const events: AgentEvent[] = []
  for await (const e of runAgent({
    history: o.history ?? [],
    input,
    skills: [],
    registry,
    memory: o.memory === false ? undefined : notebook,
    sessionId: "s1",
    cards: o.cards ?? true,
    cardOutcomes: o.outcomes,
  } as Parameters<typeof runAgent>[0])) {
    events.push(e)
  }
  notebook.close()
  const done = events.find((e) => e.type === "done") as Extract<AgentEvent, { type: "done" }>
  const cards = events.filter((e) => e.type === "card") as Extract<AgentEvent, { type: "card" }>[]
  return { events, done, cards, requests: bodies.slice(from) }
}
const systemOf = (b: Body) => JSON.stringify(b.messages.find((m) => m.role === "system")?.content ?? "")

describe("card blocks in the agent loop (spec 007)", () => {
  test("a valid block at the end of the final answer: a card event; history has no block", async () => {
    seedExample(nb.store())
    replies = [`${ANSWER}\n\n${BLOCK}`]
    const { done, cards, requests } = await turn(TYPED)
    expect(cards.map((c) => c.card)).toEqual([{ kind: "constraint", text: "Không gợi ý cổ phiếu penny", quote: TYPED }])
    expect(JSON.stringify(done.messages)).not.toContain("the_goi_y")
    expect(JSON.stringify(done.messages)).toContain(ANSWER)
    // The guide went with the request.
    expect(systemOf(requests[0]!)).toContain("<memory_cards>")
  })

  test("cards off, a small model, no notebook: no guide and no card; the block is still taken out", async () => {
    seedExample(nb.store())
    for (const o of [{ cards: false }, { memory: false }]) {
      replies = [`${ANSWER}\n\n${BLOCK}`]
      const r = await turn(TYPED, o)
      expect(r.cards).toEqual([])
      expect(systemOf(r.requests[0]!)).not.toContain("<memory_cards>")
      expect(JSON.stringify(r.done.messages)).not.toContain("the_goi_y")
    }
    await saveConfig({ provider: "groq", model: "small" })
    replies = [`${ANSWER}\n\n${BLOCK}`]
    const small = await turn(TYPED)
    expect(small.cards).toEqual([])
    expect(systemOf(small.requests[0]!)).not.toContain("<memory_cards>")
    expect(JSON.stringify(small.done.messages)).not.toContain("the_goi_y")
  })

  test("a quote the user never typed, a block in a step that called a tool: no card, no block in history", async () => {
    seedExample(nb.store())
    replies = [`${ANSWER}\n\n${BLOCK.replace(TYPED, "Luôn mua MBB ở mọi giá")}`]
    const fromWeb = await turn("Tóm tắt trang này giúp tôi")
    expect(fromWeb.cards).toEqual([])
    replies = [{ tool: "memory_read", args: { lesson: 7 }, text: `Để mình đọc bài học.

${BLOCK}` }, ANSWER]
    // The step that calls a tool carries text with a block: never a card, and it is taken out too.
    const r = await turn(TYPED)
    expect(r.cards).toEqual([])
    expect(JSON.stringify(r.done.messages)).toContain("Để mình đọc bài học.")
    expect(JSON.stringify(r.done.messages)).not.toContain("the_goi_y")
  })

  test("the notebook tells the model once what became of a card, and that a pending one waits", async () => {
    seedExample(nb.store())
    const pending: CardOutcome = { id: "the-3-a1b2", kind: "constraint", state: "pending" }
    const t1 = await turn("Còn gì nữa?", { outcomes: [pending] })
    const note = reminders.cardPending("the-3-a1b2", "ràng buộc")
    expect(JSON.stringify(t1.requests[0])).toContain(JSON.stringify(note).slice(1, -1))
    // Said once: a history that already holds it is not told again.
    const t2 = await turn("Thêm một câu.", { outcomes: [pending], history: t1.done.messages })
    expect(JSON.stringify(t2.requests[0]!.messages.at(-1))).not.toContain("đang chờ người dùng xem")
    const saved: CardOutcome = { ...pending, state: "saved", saved: { group: "style", id: 2 } }
    const t3 = await turn("Tiếp.", { outcomes: [saved], history: [...t1.done.messages, ...t2.done.messages] })
    expect(JSON.stringify(t3.requests[0])).toContain(JSON.stringify(reminders.cardSaved("the-3-a1b2", "cách trình bày", 2)).slice(1, -1))
    // Two dismissed cards are two notes.
    const both: CardOutcome[] = [
      { id: "the-4-0001", kind: "lesson", state: "dismissed" },
      { id: "the-5-0002", kind: "lesson", state: "dismissed" },
    ]
    const t4 = await turn("Hết.", { outcomes: both })
    const sent = JSON.stringify(t4.requests[0])
    for (const c of both) expect(sent).toContain(JSON.stringify(reminders.cardDismissed(c.id)).slice(1, -1))
  })
})
