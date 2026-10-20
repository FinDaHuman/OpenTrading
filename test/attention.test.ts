import { expect, test } from "bun:test"
import { Attention, drawsProgress } from "../src/tui/attention"

function fake(progress = true, enabled = true) {
  const writes: string[] = []
  const notes: string[] = []
  const statuses: string[] = []
  const attention = new Attention(
    {
      write: (s) => void writes.push(s),
      notify: (m) => (notes.push(m), true),
      status: (s) => void statuses.push(s.state === "blocked" ? `blocked:${s.kind}` : s.state),
      progress,
    },
    () => enabled,
  )
  return { attention, writes, notes, statuses }
}

test("the tab progress ring follows the turn: spinning while working, yellow while waiting, off after; only changes are written", () => {
  const { attention, writes, statuses } = fake()
  attention.setBusy("idle")
  expect(writes).toEqual([])
  attention.setBusy("working")
  attention.setBusy("working")
  attention.setBusy("permission")
  attention.setBusy("question")
  attention.setBusy("working")
  attention.setBusy("idle")
  expect(writes).toEqual(["\x1b]9;4;3;0\x07", "\x1b]9;4;4;100\x07", "\x1b]9;4;3;0\x07", "\x1b]9;4;0;0\x07"])
  expect(statuses).toEqual(["idle", "working", "working", "blocked:permission", "blocked:question", "working", "idle"])
})

test("clear() stops a spinning ring on the way out; terminals without OSC 9;4 never get it", () => {
  const { attention, writes, statuses } = fake()
  attention.setBusy("working")
  attention.clear()
  attention.clear()
  expect(writes).toEqual(["\x1b]9;4;3;0\x07", "\x1b]9;4;0;0\x07"])
  expect(statuses.at(-1)).toBe("clear")

  const other = fake(false)
  other.attention.setBusy("working")
  other.attention.clear()
  expect(other.writes).toEqual([])
})

test("notifications only while the window is known to be elsewhere, once per kind until the user is back", () => {
  const { attention, notes } = fake()
  attention.attention("done", "chưa biết focus")
  attention.focus(true)
  attention.attention("done", "đang nhìn")
  expect(notes).toEqual([])
  attention.focus(false)
  attention.attention("approval", "Cần bạn duyệt: write_file a.md")
  attention.attention("approval", "Cần bạn duyệt: shell ls")
  attention.attention("done", "FPT tăng 2%")
  expect(notes).toEqual(["Cần bạn duyệt: write_file a.md", "FPT tăng 2%"])
  attention.focus(true)
  attention.focus(false)
  attention.attention("approval", "Cần bạn duyệt: lần sau")
  expect(notes.at(-1)).toBe("Cần bạn duyệt: lần sau")
})

test("turned off in /config: no notifications and no ring", () => {
  const { attention, notes, writes } = fake(true, false)
  attention.focus(false)
  attention.attention("done", "xong")
  attention.setBusy("working")
  expect(notes).toEqual([])
  expect(writes).toEqual([])
})

test("OSC 9;4 only for terminals that draw it (iTerm2 would show it as a notification)", () => {
  expect(drawsProgress({ WT_SESSION: "abc" })).toBe(true)
  expect(drawsProgress({ ConEmuANSI: "ON" })).toBe(true)
  expect(drawsProgress({ TERM_PROGRAM: "ghostty" })).toBe(true)
  expect(drawsProgress({ TERM_PROGRAM: "iTerm.app" })).toBe(false)
  expect(drawsProgress({})).toBe(false)
})
