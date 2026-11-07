import { afterAll, afterEach, expect, spyOn, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ModelMessage } from "ai"

// Isolated state dir before core modules read it.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-cards-session-"))
const previous = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home
const store = await import("../src/core/session/store")
const { loadSession, Session, sessionsDir } = store
afterAll(async () => {
  if (previous === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = previous
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})
const spies: { mockRestore(): void }[] = []
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore()
})

const info = { cwd: "/w", provider: "groq", model: "m1" }
const user = (text: string): ModelMessage => ({ role: "user", content: text })
const answer = (text: string): ModelMessage => ({ role: "assistant", content: text })
const card = (turn: number) => ({
  id: `the-${turn}-a1b2`,
  turn,
  kind: "constraint" as const,
  text: "Không gợi ý cổ phiếu penny",
  quote: "đừng bao giờ gợi ý cổ phiếu penny",
})

test("a card is written with its turn, its state changes are lines of their own, the last one wins", async () => {
  const s = Session.create()
  await s.appendTurn([user("Câu 1"), answer("Trả lời 1")], info)
  expect(s.nextTurn).toBe(2)
  s.noteCard(card(2))
  await s.appendTurn([user("Từ giờ đừng bao giờ gợi ý cổ phiếu penny"), answer("Ghi nhận.")], info)
  await s.appendTurn([user("Câu 3"), answer("Trả lời 3")], info)
  await s.appendCardState("the-2-a1b2", "saved", { group: "style", id: 4 })

  const text = await readFile(path.join(sessionsDir(), (await store.listSessions())[0]!.file), "utf8")
  const lines = text.trim().split("\n").map((l) => JSON.parse(l))
  const cardLines = lines.filter((l) => l.type === "card")
  expect(cardLines.map((l) => l.state)).toEqual(["pending", "saved"])
  // Written before its turn's turn_end.
  const created = lines.findIndex((l) => l.type === "card")
  expect(lines[created + 1]).toMatchObject({ type: "turn_end", turn: 2 })

  const loaded = await loadSession(s.id)
  expect(loaded.cards).toHaveLength(1)
  const [c] = loaded.cards
  expect(c!.card).toEqual(card(2))
  expect(c!.state).toBe("saved")
  expect(c!.saved).toEqual({ group: "style", id: 4 })
  // Right after the answer it came with: two turns of two messages before it.
  expect(loaded.display[c!.at - 1]).toEqual(answer("Ghi nhận."))
  // The model never sees a card.
  expect(JSON.stringify(loaded.messages)).not.toContain("Không gợi ý cổ phiếu penny")
})

test("a state line for an unknown id, or a malformed card line, is skipped; the session still loads", async () => {
  const s = Session.create()
  await s.appendTurn([user("Câu 1"), answer("Trả lời 1")], info)
  await s.appendCardState("the-9-ffff", "dismissed")
  const file = path.join(sessionsDir(), (await store.listSessions()).find((x) => x.id === s.id)!.file)
  const { appendFile } = await import("node:fs/promises")
  await appendFile(file, JSON.stringify({ type: "card", ts: "x", id: "bad", state: "pending", kind: "thesis", turn: 1 }) + "\n")
  const loaded = await loadSession(s.id)
  expect(loaded.cards).toEqual([])
  expect(loaded.display).toHaveLength(2)
})

test("a failed write of a state line is caught up on the next write, after the turns before it", async () => {
  const s = Session.create()
  s.noteCard(card(1))
  await s.appendTurn([user("Từ giờ đừng bao giờ gợi ý cổ phiếu penny"), answer("Ghi nhận.")], info)
  const append = spyOn(store.sessionFiles, "append").mockImplementationOnce(async () => {
    throw Object.assign(new Error("disk full"), { code: "ENOSPC" })
  })
  spies.push(append)
  const failed = await s.appendCardState("the-1-a1b2", "dismissed")
  expect(failed.error).toBeDefined()
  await s.appendTurn([user("Câu 2"), answer("Trả lời 2")], info)
  const loaded = await loadSession(s.id)
  expect(loaded.cards.map((c) => c.state)).toEqual(["dismissed"])
})
