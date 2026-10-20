import { afterAll, afterEach, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ActivityRow, activeMs, fmtElapsed, startActivity, STALL_AFTER_MS, STALL_RAMP_MS, TIP_AFTER_MS } from "../src/tui/activity"
import { setState, state } from "../src/tui/state"
import { color } from "../src/tui/theme"
import { Transcript } from "../src/tui/transcript"
import { setClockForTests } from "../src/tui/ui/clock"

let t = 1_000_000
const at = (ms: number) => {
  t = ms
  setClockForTests(() => t)
}

let setup: Awaited<ReturnType<typeof testRender>> | undefined
afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
  setState({ activity: undefined, liveTodos: undefined, lines: [] })
})
// The store is shared with the next test file.
afterAll(() => setClockForTests(undefined))

async function frame(): Promise<string> {
  await setup!.renderOnce()
  return setup!.captureCharFrame()
}

/** The glyph cell's colour on the row whose text includes `text`. */
function glyphColor(text: string): number[] {
  const spans = setup!.captureSpans()
  const line = spans.lines.find((l) => l.spans.map((s) => s.text).join("").includes(text))!
  const glyph = line.spans.find((s) => s.text.trim().length > 0)!
  return glyph.fg.toInts().slice(0, 3)
}
const hex = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16))

test("the retry countdown runs down to the deadline, then says it is retrying", async () => {
  at(1_000_000)
  setState("activity", { ...startActivity({ random: () => 0 }), retry: { attempt: 3, max: 4, until: 1_007_000, label: "provider lỗi tạm thời (503)" } })
  setup = await testRender(() => <ActivityRow tips={false} />, { width: 100, height: 4 })
  let f = await frame()
  expect(f).toContain("△ Provider lỗi tạm thời (503) · thử lại sau 7s (lần 3/4) · esc dừng")
  at(1_001_000)
  expect(await frame()).toContain("thử lại sau 6s")
  at(1_002_400)
  expect(await frame()).toContain("thử lại sau 5s")
  at(1_007_000)
  f = await frame()
  expect(f).toContain("đang thử lại… (lần 3/4)")
  // Anything that arrives ends the wait: the row is back to the verb.
  setState("activity", "retry", undefined)
  expect(await frame()).toContain("Đang phân tích…")
})

test("the row shows the verb, the time worked and output tokens; no output for a while turns the glyph red", async () => {
  at(2_000_000)
  setState("activity", { ...startActivity({ random: () => 0 }), billedOut: 3000, streamedOut: 1200 })
  setup = await testRender(() => <ActivityRow tips={false} />, { width: 100, height: 4 })
  at(2_000_000 + 83_000)
  setState("activity", "lastProgressAt", t)
  let f = await frame()
  expect(f).toContain("Đang phân tích… (1m 23s · ↓ 4,2k token)")
  expect(glyphColor("Đang phân tích")).toEqual(hex(color.tham))

  // Half way through the ramp: between yellow and red. Fully stalled: red.
  at(t + STALL_AFTER_MS + STALL_RAMP_MS / 2)
  await frame()
  const half = glyphColor("Đang phân tích")
  expect(half).not.toEqual(hex(color.tham))
  expect(half).not.toEqual(hex(color.giam))
  at(t + STALL_RAMP_MS)
  await frame()
  expect(glyphColor("Đang phân tích")).toEqual(hex(color.giam))
  // A tool running is not a stall.
  setState("activity", "toolsRunning", 1)
  await frame()
  expect(glyphColor("Đang phân tích")).toEqual(hex(color.tham))
})

test("the todo in progress is the verb and the next one is under it; otherwise a tip after a while", async () => {
  at(3_000_000)
  setState("activity", startActivity({ random: () => 0 }))
  setState("liveTodos", [
    { content: "Lấy BCTC 4 quý của FPT", status: "completed" },
    { content: "Tính P/E và P/B", status: "in_progress" },
    { content: "So sánh P/E với ngành", status: "pending" },
  ])
  setup = await testRender(() => <ActivityRow tips={true} />, { width: 100, height: 4 })
  let f = await frame()
  expect(f).toContain("Tính P/E và P/B… (0s)")
  expect(f).toContain("⎿ Tiếp: So sánh P/E với ngành")

  setState("liveTodos", undefined)
  f = await frame()
  expect(f).not.toContain("Mẹo:")
  at(t + TIP_AFTER_MS)
  f = await frame()
  expect(f).toContain("⎿ Mẹo: ")
})

test("time waiting for the user does not count", () => {
  const a = { startedAt: 0, pausedMs: 0, pausedAt: undefined as number | undefined }
  expect(activeMs(a, 10_000)).toBe(10_000)
  a.pausedAt = 10_000
  expect(activeMs(a, 25_000)).toBe(10_000)
  a.pausedMs = 15_000
  a.pausedAt = undefined
  expect(activeMs(a, 30_000)).toBe(15_000)
})

test("elapsed is compact: 12s, 1m 05s, 1h 02m", () => {
  expect(fmtElapsed(12_400)).toBe("12s")
  expect(fmtElapsed(-400)).toBe("0s") // a start time newer than the shared ticker
  expect(fmtElapsed(65_000)).toBe("1m 05s")
  expect(fmtElapsed(3_720_000)).toBe("1h 02m")
})

test("a long turn ends with ✻ Xong sau … in the transcript", async () => {
  setState("lines", [{ kind: "done", ms: 83_000, background: 2 }])
  setup = await testRender(() => <Transcript />, { width: 100, height: 6 })
  expect(await frame()).toContain("✻ Xong sau 1m 23s · 2 subagent nền vẫn chạy")
  expect(state.lines).toHaveLength(1)
})
