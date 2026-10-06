import { afterAll, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { chartCompareTool } from "../src/core/tools/chart/compare"
import { chartRenderTool } from "../src/core/tools/chart/render"
import { setState } from "../src/tui/state"
import { Transcript } from "../src/tui/transcript"

const ctx = () => ({ signal: new AbortController().signal, callId: "c1" })
const closes = [57.3, 58.1, 58.0, 57.4, 57.7, 58.4, 59.0, 58.6, 59.4, 60.1]
const bars = closes.map((c, i) => ({ o: c - 0.3, h: c + 0.5, l: c - 0.6, c: c + (i % 2 ? -0.2 : 0.2) }))

let setup: Awaited<ReturnType<typeof testRender>> | undefined

// The TUI store is a module singleton shared by every test file: leave it empty.
afterAll(() => {
  setup?.renderer.destroy()
  setState("lines", [])
  setState("expandTools", false)
})

async function frameWith(text: string) {
  let frame = ""
  for (let i = 0; i < 50 && !frame.includes(text); i++) {
    await new Promise((r) => setTimeout(r, 100))
    await setup!.renderOnce()
    frame = setup!.captureCharFrame()
  }
  if (process.env.SHOW_FRAME) console.log(frame)
  return frame
}

test("charts show intact in the tool row (ctrl+o) and when the answer quotes them in a code block", async () => {
  const candles = (await chartRenderTool().execute({ kind: "candlestick", bars, symbol: "VCB" }, ctx())) as string
  const compare = (await chartCompareTool().execute(
    { series: [{ label: "VCB", values: closes }, { label: "HPG", values: closes.map((v) => 80 - v) }] },
    ctx(),
  )) as string
  const axis = candles.split("\n").find((l) => l.includes("┤"))!.trim()
  const compareRow = compare.split("\n")[1]!

  setState("expandTools", true)
  setState("lines", [
    { kind: "user", text: "vẽ nến VCB" },
    { kind: "tool", callId: "c1", name: "chart_render", label: "chart_render candlestick VCB", status: "ok", output: candles },
    {
      kind: "assistant",
      text: ["Nến VCB:", "", "```", candles, "```", "", "So với HPG:", "", "```", compare, "```", "", "Xu hướng tăng nhẹ."].join("\n"),
      done: true,
    },
  ])
  setup = await testRender(() => <Transcript />, { width: 100, height: 80 })
  const frame = await frameWith("Xu hướng tăng nhẹ.")

  expect(frame).not.toContain(String.fromCharCode(27))
  expect(frame).not.toMatch(/\[\d+(;\d+)*m/) // no stray colour codes printed as text
  // A full, column-aligned chart row twice: in the expanded tool row and in the answer's code block.
  expect(frame.split(axis).length - 1).toBe(2)
  expect(frame).toContain(compareRow)
  expect(frame).toContain("Xu hướng tăng nhẹ.")
})
