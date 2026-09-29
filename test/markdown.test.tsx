import { afterAll, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { setState } from "../src/tui/state"
import { Transcript } from "../src/tui/transcript"

// Regression: assistant answers were drawn as plain text, so markdown markers (**, *) showed.
const ANSWER = [
  "Với hồ sơ của bạn, tôi ghi nhận các ưu tiên sau:",
  "*   **Luôn nêu Bear Case trước Bull Case.**",
  "*   Không đưa ra lời khuyên mua/bán cá nhân hoá.",
  "",
  "| Chỉ tiêu | FPT |",
  "| --- | --- |",
  "| P/E | 18,2 |",
].join("\n")

let setup: Awaited<ReturnType<typeof testRender>> | undefined

// The TUI store is a module singleton and bun runs all test files in one process:
// leave it empty, or the next file (tui.test.tsx) starts on a transcript instead of Home.
afterAll(() => {
  setup?.renderer.destroy()
  setState("lines", [])
})

test("assistant answers render markdown instead of raw markers", async () => {
  setState("lines", [{ kind: "assistant", text: ANSWER, done: true }])
  setup = await testRender(() => <Transcript />, { width: 100, height: 20 })
  // Text blocks are highlighted by tree-sitter in a worker: wait on the clock, not render passes.
  let frame = ""
  for (let i = 0; i < 50 && !frame.includes("Luôn nêu Bear Case"); i++) {
    await new Promise((r) => setTimeout(r, 100))
    await setup.renderOnce()
    frame = setup.captureCharFrame()
  }
  if (process.env.SHOW_FRAME) console.log(frame)
  expect(frame).not.toContain("**") // emphasis markers are concealed; the text is styled bold
  expect(frame).toContain("Luôn nêu Bear Case trước Bull Case.")
  expect(frame).toContain("┌") // tables are drawn as a grid…
  expect(frame).not.toContain("| --- |") // …not as raw pipes
})
