import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { testRender } from "@opentui/solid"

// Preferences and config go to a scratch home, never ~/.opentrading.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-model-picker-"))
const savedHome = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home

const { loadModelPrefs, MAX_RECENT, modelPrefsFile, toggleFavorite, withRecent } = await import("../src/core/model-prefs")
const { ModelDialog } = await import("../src/tui/dialogs/model")
const { resetNotifications } = await import("../src/tui/notify")
const { setState, state } = await import("../src/tui/state")

const model = (id: string, name: string, context = 1_000_000) => ({ id, name, limit: { context, output: 8000 } })
const catalog = {
  google: {
    id: "google",
    name: "Google",
    env: [],
    npm: "@ai-sdk/google",
    models: {
      "gemini-3.5-flash-lite": model("gemini-3.5-flash-lite", "Gemini 3.5 Flash Lite"),
      "gemini-3.1-pro": model("gemini-3.1-pro", "Gemini 3.1 Pro"),
    },
  },
  groq: { id: "groq", name: "Groq", env: [], npm: "@ai-sdk/groq", models: { "llama-4": model("llama-4", "Llama 4", 131_072) } },
  anthropic: { id: "anthropic", name: "Anthropic", env: [], npm: "@ai-sdk/anthropic", models: { "claude-sonnet-5-5": model("claude-sonnet-5-5", "Claude Sonnet 5.5") } },
}

let setup: Awaited<ReturnType<typeof testRender>> | undefined
beforeAll(() => {
  setState({ catalog: catalog as never, connected: ["google", "groq"] })
})
afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
  resetNotifications()
  setState({ dialog: undefined, modelPrefs: { favorite: [], recent: [] }, provider: undefined, model: undefined })
})
afterAll(async () => {
  setState({ catalog: {}, connected: [] })
  if (savedHome === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = savedHome
  await rm(home, { recursive: true, force: true })
})

async function open(prefs = { favorite: [] as { provider: string; model: string }[], recent: [] as { provider: string; model: string }[] }) {
  setState({ provider: "google", model: "gemini-3.5-flash-lite", modelPrefs: prefs, dialog: "model" })
  setup = await testRender(() => <ModelDialog />, { width: 100, height: 40 })
  return frameWith("Chọn model")
}
async function frameWith(text: string) {
  let frame = ""
  for (let i = 0; i < 50 && !frame.includes(text); i++) {
    await new Promise((r) => setTimeout(r, 10))
    await setup!.renderOnce()
    frame = setup!.captureCharFrame()
  }
  return frame
}
const rows = (f: string) => f.split("\n").map((r) => r.trimEnd())
const selected = (f: string) => rows(f).find((r) => r.includes("❯ ")) ?? ""

test("groups: ★ favourites, recent (without the favourites), then each provider, the current one first", async () => {
  const f = await open({
    favorite: [{ provider: "groq", model: "llama-4" }],
    recent: [
      { provider: "groq", model: "llama-4" },
      { provider: "google", model: "gemini-3.1-pro" },
    ],
  })
  if (process.env.SHOW_FRAME) console.log(f)
  const order = ["★ Yêu thích", "Llama 4", "Gần đây", "Gemini 3.1 Pro", "Google", "Gemini 3.1 Pro", "Gemini 3.5 Flash Lite", "Groq", "Khác"]
  let at = -1
  const lines = rows(f)
  for (const text of order) {
    const next = lines.findIndex((r, i) => i > at && r.includes(text))
    expect({ text, found: next > at }).toEqual({ text, found: true })
    at = next
  }
  // The current model is ●, a favourite under its provider ★; shortcut rows name the provider.
  expect(f).toMatch(/● Gemini 3\.5 Flash Lite\s+Google · 1M/)
  expect(f).toMatch(/★ Llama 4\s+Groq · 131k/)
  expect(f).toMatch(/Llama 4\s+Groq · 131k/)
})

test("ctrl+f stars the highlighted model and keeps the highlight on it; it is saved to model.json", async () => {
  await open()
  // Down to "Gemini 3.1 Pro" under Google (the first item is Gemini 3.1 Pro: sorted by name).
  let f = await frameWith("Gemini 3.1 Pro")
  expect(selected(f)).toContain("Gemini 3.1 Pro")
  setup!.mockInput.pressKey("f", { ctrl: true })
  f = await frameWith("★ Yêu thích")
  // The row moved nowhere: still the Google one, now starred; the favourite also sits on top.
  expect(selected(f)).toMatch(/❯ ★ Gemini 3\.1 Pro/)
  expect(state.modelPrefs.favorite).toEqual([{ provider: "google", model: "gemini-3.1-pro" }])
  for (let i = 0; i < 50 && !(await readFile(modelPrefsFile(), "utf8").catch(() => "")).includes("gemini-3.1-pro"); i++) await new Promise((r) => setTimeout(r, 10))
  expect(await loadModelPrefs()).toEqual({ favorite: [{ provider: "google", model: "gemini-3.1-pro" }], recent: [] })
  expect(state.notification?.text).toContain("Đã thêm gemini-3.1-pro vào yêu thích")
  // The filter did not move: ctrl+f is not the input's forward-char here.
  setup!.mockInput.pressKey("f", { ctrl: true })
  await frameWith("Đã bỏ")
  expect(state.modelPrefs.favorite).toEqual([])
})

test("←/→ jump between groups while the filter is empty; typing filters into one flat list", async () => {
  await open({ favorite: [{ provider: "groq", model: "llama-4" }], recent: [] })
  let f = await frameWith("★ Yêu thích")
  expect(selected(f)).toContain("Llama 4") // the favourite
  setup!.mockInput.pressArrow("right")
  f = await frameWith("Google")
  await setup!.renderOnce()
  expect(selected(setup!.captureCharFrame())).toContain("Gemini 3.1 Pro")
  setup!.mockInput.pressArrow("right")
  await setup!.renderOnce()
  expect(selected(setup!.captureCharFrame())).toContain("Llama 4")
  setup!.mockInput.pressArrow("left")
  setup!.mockInput.pressArrow("left")
  await setup!.renderOnce()
  expect(selected(setup!.captureCharFrame())).toMatch(/❯ \s*Llama 4\s+Groq/)

  await setup!.mockInput.typeText("llama")
  f = await frameWith("› llama")
  await setup!.renderOnce()
  f = setup!.captureCharFrame()
  expect(f).not.toContain("★ Yêu thích")
  expect(rows(f).filter((r) => r.includes("Llama 4"))).toHaveLength(1)
  setup!.mockInput.pressArrow("left") // moves the cursor in the filter, not the list
  await setup!.renderOnce()
  expect(selected(setup!.captureCharFrame())).toContain("Llama 4")
})

test("a favourite that cannot be used now is greyed with the reason; enter says why and changes nothing", async () => {
  await open({ favorite: [{ provider: "anthropic", model: "claude-sonnet-5-5" }], recent: [] })
  const f = await frameWith("[provider chưa kết nối]")
  expect(f).toMatch(/Claude Sonnet 5\.5.*\[provider chưa kết nối\]/)
  setup!.mockInput.pressEnter()
  await frameWith("Không dùng được")
  expect(state.notification).toMatchObject({ level: "error" })
  expect(state.notification?.text).toContain("provider chưa kết nối")
  expect(state.model).toBe("gemini-3.5-flash-lite")
  expect(state.dialog).toBe("model")
})

test("enter switches the model and puts it first in recent", async () => {
  await writeFile(path.join(home, "config.json"), "{}\n")
  await open({ favorite: [], recent: [{ provider: "google", model: "gemini-3.5-flash-lite" }] })
  setup!.mockInput.pressArrow("right") // to Google
  setup!.mockInput.pressArrow("right") // to Groq
  setup!.mockInput.pressEnter()
  for (let i = 0; i < 50 && state.model !== "llama-4"; i++) await new Promise((r) => setTimeout(r, 10))
  expect({ provider: state.provider, model: state.model }).toEqual({ provider: "groq", model: "llama-4" })
  expect(state.modelPrefs.recent[0]).toEqual({ provider: "groq", model: "llama-4" })
  expect(state.dialog).toBeUndefined()
})

test("model.json: recent is capped and de-duplicated; junk entries are dropped", async () => {
  let prefs = { favorite: [], recent: [] } as { favorite: { provider: string; model: string }[]; recent: { provider: string; model: string }[] }
  for (let i = 0; i < 15; i++) prefs = withRecent(prefs, { provider: "p", model: `m${i % 12}` })
  expect(prefs.recent).toHaveLength(MAX_RECENT)
  expect(prefs.recent[0]).toEqual({ provider: "p", model: "m2" })
  expect(new Set(prefs.recent.map((r) => r.model)).size).toBe(MAX_RECENT)
  expect(toggleFavorite(toggleFavorite(prefs, { provider: "p", model: "x" }), { provider: "p", model: "x" }).favorite).toEqual([])
  await writeFile(modelPrefsFile(), JSON.stringify({ favorite: [{ provider: "g", model: "a" }, { nope: 1 }, "x"], recent: "bad" }))
  expect(await loadModelPrefs()).toEqual({ favorite: [{ provider: "g", model: "a" }], recent: [] })
})
