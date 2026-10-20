import { afterAll, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { produce } from "solid-js/store"
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

// A streamed answer with every kind of block the models write.
const STREAMED = [
  "## Kết luận chính",
  "",
  "Doanh thu quý 3 của **FPT** tăng mạnh nhờ mảng công nghệ nước ngoài, biên lợi nhuận gộp cải thiện.",
  "",
  "- Ý một **đậm** và dài hơn một chút",
  "- Ý hai `code` cũng dài",
  "",
  "| Chỉ tiêu | FPT | MWG |",
  "| --- | --- | --- |",
  "| P/E | 18,2 | 15,1 |",
  "| P/B | 4,1 | 3,2 |",
  "",
  "```ts",
  "const x = 1",
  "```",
  "",
  "### Rủi ro",
  "",
  "Đoạn cuối với *nghiêng* nữa.",
].join("\n")

// Regression: while streaming, frames flipped between raw markers and formatted text.
test("a streaming answer never shows raw markdown markers, and never shrinks", async () => {
  setup?.renderer.destroy()
  setState("lines", [{ kind: "assistant", text: "", done: false }])
  setup = await testRender(() => <Transcript />, { width: 100, height: 40 })
  const bad: string[] = []
  let rows = 0
  // Chunks of 3–7 characters, a frame after each without waiting for tree-sitter.
  for (let i = 0, step = 3; i < STREAMED.length; i += step, step = 3 + (step % 5)) {
    setState(produce((s) => void ((s.lines[0] as { text: string }).text = STREAMED.slice(0, i + step))))
    await setup.renderOnce()
    await new Promise((r) => setTimeout(r, 10))
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const raw = frame.split("\n").filter((l) => /\*\*|^[●\s]*#|\| -{3}|^[●\s]*\|/.test(l))
    if (raw.length > 0) bad.push(`@${i + step}: ${raw.map((l) => l.trim()).join(" / ")}`)
    const now = frame.split("\n").filter((l) => l.trim()).length
    if (now < rows) bad.push(`@${i + step}: shrank from ${rows} to ${now} rows`)
    rows = now
  }
  if (process.env.SHOW_FRAME) console.log(setup.captureCharFrame())
  expect(bad).toEqual([])
})

test("assistant answers render markdown instead of raw markers", async () => {
  setup?.renderer.destroy()
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
