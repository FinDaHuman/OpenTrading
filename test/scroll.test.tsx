import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { Background } from "../src/tui/background"
import { DEFAULT_SCROLL_SPEED, nextScrollSetting, scrollSetting, scrollTranscript } from "../src/tui/scroll"
import { setState, type Line } from "../src/tui/state"
import { Transcript } from "../src/tui/transcript"

let setup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
})
// The store is shared with the other test files (tui.test.tsx must start on Home).
afterAll(() => {
  setState("lines", [])
  setState("scroll", { speed: DEFAULT_SCROLL_SPEED, accelerate: false })
})

describe("scroll settings", () => {
  test("default 5 rows a notch; bad values fall back; capped", () => {
    expect(scrollSetting(undefined)).toEqual({ speed: 5, accelerate: false })
    expect(scrollSetting({ scrollSpeed: 0 })).toEqual({ speed: 5, accelerate: false })
    expect(scrollSetting({ scrollSpeed: 3, scrollAcceleration: true })).toEqual({ speed: 3, accelerate: true })
    expect(scrollSetting({ scrollSpeed: 500 }).speed).toBe(50)
  })

  test("/config cycles 3 → 5 → 8 → accelerated → 3", () => {
    let s = { speed: 3, accelerate: false }
    const seen = []
    for (let i = 0; i < 4; i++) seen.push((s = nextScrollSetting(s)))
    expect(seen).toEqual([
      { speed: 5, accelerate: false },
      { speed: 8, accelerate: false },
      { speed: 8, accelerate: true },
      { speed: 3, accelerate: false },
    ])
  })
})

const LINES: Line[] = Array.from({ length: 120 }, (_, i) => ({ kind: "info", text: `dòng-${i + 1}` }))

/** The highest "dòng-N" on screen. */
const lastShown = (frame: string) => Math.max(0, ...[...frame.matchAll(/dòng-(\d+)/g)].map((m) => Number(m[1])))

/** The chip follows the scroll state a frame later (reported mid-frame, applied after it). */
async function settle(s: NonNullable<typeof setup>) {
  for (let i = 0; i < 3; i++) {
    await s.renderOnce()
    await Promise.resolve()
  }
}

async function chat(speed?: number) {
  setState("lines", LINES)
  setState("scroll", { speed: speed ?? DEFAULT_SCROLL_SPEED, accelerate: false })
  setup = await testRender(() => <Transcript />, { width: 80, height: 20 })
  await setup.renderOnce()
  await setup.renderOnce()
  return setup
}

describe("transcript scrolling", () => {
  test("a wheel notch moves 5 rows (the configured speed)", async () => {
    const s = await chat()
    const bottom = lastShown(s.captureCharFrame())
    expect(bottom).toBe(120)
    await s.mockMouse.scroll(10, 5, "up")
    await s.renderOnce()
    // Info lines are one row each, with a blank row between them (marginTop 1).
    // 5 rows = 2 whole lines up.
    expect(lastShown(s.captureCharFrame())).toBe(bottom - 2)
    await s.mockMouse.scroll(10, 5, "down")
    await s.renderOnce()
    expect(lastShown(s.captureCharFrame())).toBe(bottom)
  })

  test("the speed follows the setting", async () => {
    const s = await chat(8)
    await s.mockMouse.scroll(10, 5, "up")
    await s.renderOnce()
    // 8 rows = 4 lines.
    expect(lastShown(s.captureCharFrame())).toBe(120 - 4)
  })

  test("PageUp/PageDown move half a screen; top and bottom jump", async () => {
    const s = await chat()
    expect(scrollTranscript("page-up")).toBe(true)
    await s.renderOnce()
    const up = lastShown(s.captureCharFrame())
    expect(up).toBeLessThan(120)
    expect(up).toBeGreaterThan(110)
    scrollTranscript("top")
    await s.renderOnce()
    expect(s.captureCharFrame()).toContain("dòng-1 ")
    scrollTranscript("bottom")
    await s.renderOnce()
    expect(lastShown(s.captureCharFrame())).toBe(120)
  })

  test("scrolled up, a chip says how to get back, and that new text came meanwhile", async () => {
    const s = await chat()
    expect(s.captureCharFrame()).not.toContain("ctrl+end")
    await s.mockMouse.scroll(10, 5, "up")
    await settle(s)
    expect(s.captureCharFrame()).toContain("↓ ctrl+end xuống cuối")
    setState("lines", (lines) => [...lines, { kind: "info", text: "dòng-mới" }])
    await settle(s)
    expect(s.captureCharFrame()).toContain("↓ có nội dung mới · ctrl+end")
    // Back at the bottom the chip goes, and the view sticks to new text again.
    scrollTranscript("bottom")
    await settle(s)
    expect(s.captureCharFrame()).not.toContain("ctrl+end")
    setState("lines", (lines) => [...lines, { kind: "info", text: "dòng-cuối-cùng" }])
    await s.renderOnce()
    await s.renderOnce()
    expect(s.captureCharFrame()).toContain("dòng-cuối-cùng")
  })
})

test("the background animates on Home only: in a chat nothing keeps the renderer drawing", async () => {
  const [quiet, setQuiet] = createSignal(false)
  setup = await testRender(() => <Background quiet={quiet()} />, { width: 40, height: 10 })
  await setup.renderOnce()
  expect(setup.renderer.liveRequestCount).toBe(1)
  setQuiet(true)
  await setup.renderOnce()
  expect(setup.renderer.liveRequestCount).toBe(0)
  // The still tape keeps its last frame (the gutters are not blanked).
  expect(setup.captureCharFrame().trim()).not.toBe("")
  setQuiet(false)
  await setup.renderOnce()
  expect(setup.renderer.liveRequestCount).toBe(1)
})
