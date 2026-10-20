import { afterAll, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { notify, resetNotifications } from "../src/tui/notify"
import { Toasts } from "../src/tui/toast"
import { color } from "../src/tui/theme"

let setup: Awaited<ReturnType<typeof testRender>> | undefined
// The toasts live in the shared store: leave it empty for the next test file.
afterAll(() => {
  setup?.renderer.destroy()
  resetNotifications()
})

async function frameWith(text: string) {
  let frame = ""
  for (let i = 0; i < 50 && !frame.includes(text); i++) {
    await new Promise((r) => setTimeout(r, 20))
    await setup!.renderOnce()
    frame = setup!.captureCharFrame()
  }
  return frame
}

test("a toast is a card in the top-right corner with bars in its level's colour", async () => {
  setup = await testRender(() => <Toasts />, { width: 100, height: 20 })
  notify({ key: "mcp:demo", level: "error", title: "MCP demo không kết nối được", text: "ECONNREFUSED · /mcp để xem" })
  const frame = await frameWith("ECONNREFUSED")
  const rows = frame.split("\n")
  const title = rows.findIndex((r) => r.includes("MCP demo không kết nối được"))
  expect(title).toBeGreaterThanOrEqual(1)
  // Right-aligned with a 2-column margin, framed by ┃ bars.
  expect(rows[title]!.trimEnd().endsWith("┃")).toBe(true)
  expect(rows[title]!.length - rows[title]!.trimEnd().length).toBe(2)
  expect(rows[title]).toContain("┃ MCP demo")
  const spans = setup.captureSpans()
  const bar = spans.lines[title]!.spans.find((s) => s.text.includes("┃"))!
  expect(bar.fg.toInts().slice(0, 3)).toEqual(hex(color.giam))

  // Newest on top.
  notify({ key: "web", level: "warning", text: "Trang chậm, đang thử lại" })
  const framed = await frameWith("Trang chậm")
  if (process.env.SHOW_FRAME) console.log(framed)
  const both = framed.split("\n")
  expect(both.findIndex((r) => r.includes("Trang chậm"))).toBeLessThan(both.findIndex((r) => r.includes("MCP demo")))
  expect(both.find((r) => r.includes("Trang chậm"))).toContain("△ Trang chậm")
})

function hex(h: string) {
  return [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16))
}
