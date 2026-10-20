import { afterEach, expect, test } from "bun:test"
import { dismiss, flash, MAX_TOASTS, noticeText, notify, resetNotifications, say } from "../src/tui/notify"
import { announceMcp } from "../src/tui/mcp/notices"
import { state } from "../src/tui/state"

const shown = () => state.notification?.text
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

afterEach(() => resetNotifications())

test("one notice shows at a time; the next waits and shows when the first times out", async () => {
  notify({ key: "a", text: "một", timeoutMs: 20 })
  notify({ key: "b", text: "hai", timeoutMs: 20 })
  expect(shown()).toBe("một")
  await sleep(40)
  expect(shown()).toBe("hai")
  await sleep(40)
  expect(state.notification).toBeUndefined()
})

test("waiting notices come out by priority, first come first served within one", () => {
  notify({ key: "now", text: "đang hiện", timeoutMs: 0 })
  notify({ key: "low", text: "thấp", priority: "low" })
  notify({ key: "med", text: "vừa", priority: "medium" })
  notify({ key: "high1", text: "cao 1" })
  notify({ key: "high2", text: "cao 2" })
  const order: (string | undefined)[] = []
  for (const key of ["now", "high1", "high2", "med", "low"]) {
    order.push(shown())
    dismiss(key)
  }
  expect(order).toEqual(["đang hiện", "cao 1", "cao 2", "vừa", "thấp"])
})

test("immediate jumps the line and what it interrupted shows again afterwards", () => {
  notify({ key: "a", text: "đang hiện", timeoutMs: 0 })
  flash("Esc lần nữa để xoá ô nhập", 0)
  expect(shown()).toBe("Esc lần nữa để xoá ô nhập")
  dismiss("flash")
  expect(shown()).toBe("đang hiện")
})

test("a repeated key is dropped, or folded into the one on screen", () => {
  const fold = (cur: { text: string }) => ({ key: "done", text: `${Number.parseInt(cur.text) + 1} agent xong`, timeoutMs: 0, fold })
  notify({ key: "done", text: "1 agent xong", timeoutMs: 0, fold })
  notify({ key: "done", text: "1 agent xong", timeoutMs: 0, fold })
  notify({ key: "done", text: "1 agent xong", timeoutMs: 0, fold })
  expect(shown()).toBe("3 agent xong")

  notify({ key: "x", text: "chờ", timeoutMs: 0 })
  notify({ key: "x", text: "chờ lần 2", timeoutMs: 0 })
  dismiss("done")
  expect(shown()).toBe("chờ")
  dismiss("x")
  expect(state.notification).toBeUndefined()
})

test("invalidates removes stale notices from the footer, the queue and the toasts", () => {
  notify({ key: "mcp:demo", text: "mất kết nối", level: "error" })
  expect(state.toasts.map((t) => t.key)).toEqual(["mcp:demo"])
  notify({ key: "cooldown", text: "đang chờ", timeoutMs: 0 })
  notify({ key: "ok", text: "đã kết nối lại", level: "success", invalidates: ["mcp:demo", "cooldown"] })
  expect(state.toasts).toEqual([])
  expect(shown()).toBe("đã kết nối lại")
})

test("warnings and errors at high priority are toasts (newest first, at most three); say() never is", async () => {
  for (let i = 1; i <= MAX_TOASTS + 1; i++) notify({ key: `t${i}`, text: `lỗi ${i}`, level: "error" })
  expect(state.toasts.map((t) => t.key)).toEqual(["t4", "t3", "t2"])
  expect(state.notification).toBeUndefined()
  // The same key again replaces its card in place.
  notify({ key: "t3", text: "lỗi 3 (lại)", level: "error" })
  expect(state.toasts.map((t) => t.text)).toEqual(["lỗi 4", "lỗi 3 (lại)", "lỗi 2"])

  notify({ key: "warn-low", text: "nhẹ", level: "warning", priority: "low" })
  say("Không có lệnh /xyz. Gõ /help để xem các lệnh.", "error")
  expect(state.toasts).toHaveLength(3)
  expect(state.notification).toMatchObject({ level: "error", text: "Không có lệnh /xyz. Gõ /help để xem các lệnh." })

  notify({ key: "short", text: "ngắn", level: "warning", timeoutMs: 20 })
  expect(state.toasts[0]!.key).toBe("short")
  await sleep(40)
  expect(state.toasts.some((t) => t.key === "short")).toBe(false)
})

test("the level glyph is added once", () => {
  expect(noticeText({ text: "Đã copy 3 ký tự", level: "success" })).toBe("✓ Đã copy 3 ký tự")
  expect(noticeText({ text: "✓ Đã copy", level: "success" })).toBe("✓ Đã copy")
  expect(noticeText({ text: "Hỏng", level: "error" })).toBe("✘ Hỏng")
  expect(noticeText({ text: "Gần đầy", level: "warning" })).toBe("△ Gần đầy")
  expect(noticeText({ text: "Ghi chú", level: "info" })).toBe("Ghi chú")
})

test("MCP: a server that fails is an error toast; coming back retires it; no change says nothing", () => {
  announceMcp([], [{ name: "demo", state: "connecting" }])
  expect(state.toasts).toEqual([])
  announceMcp([{ name: "demo", state: "connecting" }], [{ name: "demo", state: "failed", error: "spawn ENOENT\nstack…" }])
  expect(state.toasts).toEqual([{ key: "mcp:demo", level: "error", title: "MCP demo không kết nối được", text: "spawn ENOENT · /mcp để xem" }])
  // Still failed on the next update: no second toast.
  announceMcp([{ name: "demo", state: "failed" }], [{ name: "demo", state: "failed", error: "spawn ENOENT" }])
  expect(state.toasts).toHaveLength(1)
  announceMcp([{ name: "demo", state: "failed" }], [{ name: "demo", state: "connected" }])
  expect(state.toasts).toEqual([])
  expect(state.notification).toMatchObject({ level: "success", text: "MCP demo đã kết nối lại" })
})
