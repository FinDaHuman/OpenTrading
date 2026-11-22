import { afterEach, expect, test } from "bun:test"
import type { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { BURST_GAP_MS, BURST_MIN_KEYS, PasteBurst } from "../src/tui/prompt/burst"
import { PROMPT_KEYS, undoKeyKind } from "../src/tui/prompt/input"
import { offsetWidth, PromptParts } from "../src/tui/prompt/parts"

// #353: a pill is one thing (Ctrl+W takes all of it), copies as what it holds, and a paste typed
// out key by key does not send at its first line break.

let setup: Awaited<ReturnType<typeof testRender>> | undefined
afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
})

const PASTED = Array.from({ length: 5 }, (_, i) => `dòng ${i + 1}`).join("\n")

/** A bare prompt box wired like app.tsx: every change of the box sweeps cut pills, except an undo's. */
async function box() {
  let input: TextareaRenderable | undefined
  const parts = new PromptParts(
    () => input,
    () => undefined,
  )
  setup = await testRender(
    () => (
      <textarea
        ref={(r: TextareaRenderable) => (input = r)}
        focused
        width={80}
        height={3}
        keyBindings={PROMPT_KEYS}
        onContentChange={() => parts.sweep()}
      />
    ),
    { width: 80, height: 5 },
  )
  setup.renderer.keyInput.on("keypress", (evt) => (parts.undoing = undoKeyKind(evt) ?? false))
  await setup.renderOnce()
  return { input: () => input!, parts, setup }
}

test("Ctrl+W that reaches into a pill removes the whole pill, never leaves half its label as text", async () => {
  const { input, parts, setup } = await box()
  await setup.mockInput.typeText("Phân tích ")
  const label = parts.insert({ kind: "text", text: PASTED })!
  expect(label).toBe("[Pasted text #1 +4 lines]")
  // The space after the pill, then Ctrl+W: the word before the cursor is the end of the label.
  setup.mockInput.pressBackspace()
  setup.mockInput.pressKey("w", { ctrl: true })
  await setup.renderOnce()
  expect(input().plainText).toBe("Phân tích ")
  expect(parts.expand().text).toBe("Phân tích ")
  // A second pill after typed text: Ctrl+W with the cursor right after it, no space.
  parts.insert({ kind: "file", mention: "@src/a.ts" })
  setup.mockInput.pressBackspace()
  setup.mockInput.pressKey("w", { ctrl: true })
  await setup.renderOnce()
  expect(input().plainText).toBe("Phân tích ")
})

test("a selection that takes half a pill takes all of it; text around it stays", async () => {
  const { input, parts, setup } = await box()
  await setup.mockInput.typeText("A ")
  const label = parts.insert({ kind: "text", text: PASTED })!
  await setup.mockInput.typeText("B")
  const start = offsetWidth("A ")
  // From the middle of the label through the space after it.
  input().setSelection(start + 5, start + offsetWidth(label) + 1)
  input().deleteSelection()
  await setup.renderOnce()
  expect(input().plainText).toBe("A B")
  expect(parts.expand().text).not.toContain("Pasted")
  expect(parts.expand().text).not.toContain("dòng")
})

test("copy inside the prompt: a whole pill copies as its text or mention; an image as its label; a cut pill as what is visible", async () => {
  const { input, parts, setup } = await box()
  await setup.mockInput.typeText("Xem ")
  parts.insert({ kind: "text", text: PASTED })
  parts.insert({ kind: "file", mention: "@bao-cao.md" })
  parts.insert({ kind: "image", data: "AAAA", mediaType: "image/png" })
  await setup.mockInput.typeText("nhé")
  const text = input().plainText
  const all = parts.copyText(0, offsetWidth(text))
  expect(all).toBe(`Xem ${PASTED} @bao-cao.md [Image #3] nhé`)
  // A range that holds only half of the first pill keeps that half as it reads.
  const start = offsetWidth("Xem ")
  expect(parts.copyText(0, start + 7)).toBe("Xem [Pasted")
})

test("paste burst: 16 keys under 8 ms apart make the Enter after them a line break; a typist's or Telex's never", () => {
  let now = 0
  const burst = new PasteBurst(() => now)
  // A paste typed out by the terminal: one key per millisecond.
  for (let i = 0; i < BURST_MIN_KEYS; i++) {
    now += 1
    burst.key()
  }
  now += 1
  expect(burst.enterIsPaste()).toBe(true)
  // The next line keeps the burst going, so its Enter is part of the paste too.
  for (let i = 0; i < 5; i++) {
    now += 1
    burst.key()
  }
  now += 1
  expect(burst.enterIsPaste()).toBe(true)
  // The paste is over: the user's own Enter, a moment later, sends.
  now += 500
  expect(burst.enterIsPaste()).toBe(false)

  // A fast typist: 40 ms between keys, 30 keys, then Enter.
  for (let i = 0; i < 30; i++) {
    now += 40
    burst.key()
  }
  now += 40
  expect(burst.enterIsPaste()).toBe(false)

  // Telex "Vieejt Nam": the input method sends Backspace + the composed letter together (2 to 3
  // keys within a millisecond), the user types at 60 ms. Never BURST_MIN_KEYS in a row.
  for (const _ of "Vieejt Nam ddaauf tuw") {
    now += 60
    burst.key()
    now += 1
    burst.key()
    now += 1
    burst.key()
  }
  now += 30
  expect(burst.enterIsPaste()).toBe(false)
  // An Enter right after a short IME burst still sends.
  now += 1
  burst.key()
  now += 1
  expect(burst.enterIsPaste()).toBe(false)
  expect(BURST_GAP_MS).toBeLessThan(40)
})

test("after a line break and wide characters: copy through the box's own selection, Ctrl+W, then one Ctrl+Z brings the pill back whole", async () => {
  const { input, parts, setup } = await box()
  await setup.mockInput.typeText("Giá 漢字")
  setup.mockInput.pressKey("LINEFEED")
  await setup.mockInput.typeText("dữ liệu ")
  parts.insert({ kind: "text", text: "a\nb\nc\nd" })
  await setup.mockInput.typeText("xong")
  input().selectAll()
  const range = input().getSelection()!
  expect(parts.copyText(range.start, range.end)).toBe("Giá 漢字\ndữ liệu a\nb\nc\nd xong")
  input().clearSelection()
  input().gotoBufferEnd()
  for (let i = 0; i < 5; i++) setup.mockInput.pressBackspace() // "xong" and the space
  setup.mockInput.pressKey("w", { ctrl: true })
  await setup.renderOnce()
  expect(input().plainText).toBe("Giá 漢字\ndữ liệu ")
  // One Ctrl+Z gives back what the sweep took and what Ctrl+W took: the pill, with its text.
  setup.mockInput.pressKey("z", { ctrl: true })
  await setup.renderOnce()
  expect(input().plainText).toBe("Giá 漢字\ndữ liệu [Pasted text #1 +3 lines]")
  expect(parts.expand().text).toBe("Giá 漢字\ndữ liệu a\nb\nc\nd")
})

test("a cut pill: one Ctrl+Z brings it back whole (never half a label), Ctrl+Y removes it whole again, and so on", async () => {
  // Seen 22/11: after Ctrl+W the first Ctrl+Z showed "[Pasted text #2 +9" (not a pill: copy gave nothing).
  const { input, parts, setup } = await box()
  await setup.mockInput.typeText("Xem ")
  const label = parts.insert({ kind: "text", text: PASTED })!
  setup.mockInput.pressBackspace()
  setup.mockInput.pressKey("w", { ctrl: true })
  await setup.renderOnce()
  expect(input().plainText).toBe("Xem ")
  for (let round = 0; round < 2; round++) {
    setup.mockInput.pressKey("z", { ctrl: true })
    await setup.renderOnce()
    expect(input().plainText).toBe(`Xem ${label}`)
    expect(parts.copyText(0, offsetWidth(input().plainText))).toBe(`Xem ${PASTED}`)
    setup.mockInput.pressKey("y", { ctrl: true })
    await setup.renderOnce()
    expect(input().plainText).toBe("Xem ")
  }
  // Typing after the pill went is a new edit: Ctrl+Z then takes back only that typing.
  await setup.mockInput.typeText("x")
  setup.mockInput.pressKey("z", { ctrl: true })
  await setup.renderOnce()
  expect(input().plainText).toBe("Xem ")
})
