import { afterAll, beforeEach, expect, test } from "bun:test"
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { mkdtempSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { ModelMessage } from "ai"

// #344: the images a user attached come back on --resume.
const home = mkdtempSync(path.join(os.tmpdir(), "ot-session-images-"))
const previous = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home

const { loadSession, Session, sessionsDir } = await import("../src/core/session/store")
const { IMAGE_MAX_BYTES, imagesDirOf, userImages, writeImages } = await import("../src/core/session/images")
const { saveConfig } = await import("../src/core/config")

afterAll(async () => {
  if (previous === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = previous
  await rm(home, { recursive: true, force: true })
})

beforeEach(async () => {
  await saveConfig({ sessions: undefined })
})

const info = { cwd: "/w", provider: "groq", model: "m1" }
const PNG = Buffer.from("fake-png-bytes-" + "x".repeat(2_000)).toString("base64")
const OTHER = Buffer.from("another-image-" + "y".repeat(500)).toString("base64")

const withImage = (image = PNG): ModelMessage[] => [
  { role: "user", content: [{ type: "text", text: "Xem biểu đồ này" }, { type: "image", image, mediaType: "image/png" }] },
  { role: "assistant", content: [{ type: "text", text: "Đã xem." }] },
]

const imagePart = (m: ModelMessage | undefined) => (m && typeof m.content !== "string" ? (m.content as { type: string; image?: unknown; mediaType?: string }[]).find((p) => p.type === "image") : undefined)
const lineOf = async (file: string) =>
  (await readFile(path.join(sessionsDir(), file), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))

test("an attached image is kept beside the session and comes back on resume; the line keeps its placeholder for older readers", async () => {
  const session = Session.create()
  await session.appendTurn(withImage(), info)
  const lines = await lineOf(session.file!)
  const user = lines.find((l) => l.type === "message" && l.message.role === "user")
  // What an older ot reads: the text placeholder it always wrote, no base64 in the file.
  expect(user.message.content[1].type).toBe("text")
  expect(JSON.stringify(lines)).not.toContain(PNG.slice(0, 40))
  expect(user.images).toHaveLength(1)
  expect(user.images[0]).toMatchObject({ message: 0, part: 1, mediaType: "image/png" })
  const dir = path.join(sessionsDir(), imagesDirOf(session.file!))
  expect(await readdir(dir)).toEqual([`${user.images[0].sha256}.png`])
  if (process.platform !== "win32") {
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    expect((await stat(path.join(dir, `${user.images[0].sha256}.png`))).mode & 0o777).toBe(0o600)
  }
  const loaded = await loadSession(session.id)
  expect(imagePart(loaded.messages[0])).toEqual({ type: "image", image: PNG, mediaType: "image/png" })
  expect(imagePart(loaded.display[0])?.image).toBe(PNG)
})

test("the same image twice is one file; a second image is another", async () => {
  const session = Session.create()
  await session.appendTurn(withImage(), info)
  await session.appendTurn(withImage(), info)
  await session.appendTurn(withImage(OTHER), info)
  expect(await readdir(path.join(sessionsDir(), imagesDirOf(session.file!)))).toHaveLength(2)
  const loaded = await loadSession(session.id)
  expect(loaded.messages.filter((m) => imagePart(m)).map((m) => imagePart(m)!.image)).toEqual([PNG, PNG, OTHER])
})

test("a missing or altered image file leaves the placeholder, and the rest of the session loads", async () => {
  const session = Session.create()
  await session.appendTurn(withImage(), info)
  await session.appendTurn(withImage(OTHER), info)
  const dir = path.join(sessionsDir(), imagesDirOf(session.file!))
  const [first, second] = (await lineOf(session.file!)).filter((l) => l.images).map((l) => l.images[0].sha256 as string)
  await rm(path.join(dir, `${first}.png`))
  await writeFile(path.join(dir, `${second}.png`), "changed")
  const loaded = await loadSession(session.id)
  expect(loaded.messages.some((m) => imagePart(m))).toBe(false)
  expect(loaded.messages.filter((m) => m.role === "user")).toHaveLength(2)
  expect(JSON.stringify(loaded.messages[0]!.content)).toContain("Xem biểu đồ này")
})

test("sessions.images: false keeps only the placeholder, as before", async () => {
  await saveConfig({ sessions: { images: false } })
  const session = Session.create()
  await session.appendTurn(withImage(), info)
  expect((await lineOf(session.file!)).some((l) => l.images)).toBe(false)
  expect(await readdir(path.join(sessionsDir(), imagesDirOf(session.file!))).catch(() => "none")).toBe("none")
  expect(imagePart((await loadSession(session.id)).messages[0])).toBeUndefined()
})

test("a compaction that keeps the image keeps it on resume too", async () => {
  const session = Session.create()
  await session.appendTurn(withImage(), info)
  await session.appendCompact({ trigger: "manual", before: 10, after: 5, messages: withImage() })
  const compact = (await lineOf(session.file!)).find((l) => l.type === "compact")
  expect(compact.messages[0].content[1].type).toBe("text")
  expect(compact.images).toHaveLength(1)
  expect(imagePart((await loadSession(session.id)).messages[0])?.image).toBe(PNG)
})

test("limits: an image over IMAGE_MAX_BYTES is not kept; past the session's room an image stays a placeholder", async () => {
  const huge = Buffer.alloc(IMAGE_MAX_BYTES + 1, 1).toString("base64")
  expect(userImages(withImage(huge))).toEqual([])
  // A URL is not ours to keep.
  expect(userImages(withImage("https://example.com/a.png"))).toEqual([])
  const dir = path.join(home, "room")
  const images = userImages([...withImage(), ...withImage(OTHER)])
  const { refs, written } = await writeImages(dir, images, images[0]!.bytes.length)
  expect(refs.map((r) => r.sha256)).toEqual([images[0]!.sha256])
  expect(written).toBe(images[0]!.bytes.length)
})
