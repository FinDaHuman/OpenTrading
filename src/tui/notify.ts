import { setState, state } from "./state"

/**
 * Short-lived messages, after Claude Code's notification queue (context/notifications.tsx):
 * one message shows at a time in the footer, the rest wait by priority, a `key` keeps the
 * same message from piling up, `invalidates` retires messages a newer one makes stale
 * ("MCP reconnected" removes "MCP lost"), and `fold` merges repeats ("3 agents done").
 * Warnings and errors at high priority become toasts in the top-right corner instead
 * (opencode's ui/toast.tsx), up to three at once, each with its own timer.
 *
 * The transcript keeps what the user reads or copies later (command output, paths, turn
 * errors); a notification is for confirming something that just happened.
 */

export type NoticeLevel = "info" | "success" | "warning" | "error"
export type NoticePriority = "low" | "medium" | "high" | "immediate"

export interface Notice {
  /** Identity: a second notice with the same key while one waits or shows is dropped (or folded). */
  key: string
  text: string
  level?: NoticeLevel
  /** Default "high": a confirmation of what the user just did should not wait behind tips. */
  priority?: NoticePriority
  /** How long it shows, ms; 0 keeps it until {@link dismiss}. Default 5 s (toasts 8 s). */
  timeoutMs?: number
  /** Keys this notice makes stale: removed from the queue, the toasts and the footer. */
  invalidates?: string[]
  /** Merge a repeat of the same key into the one waiting or showing. */
  fold?: (current: Notice, incoming: Notice) => Notice
  /** Show as a toast. Default: warnings and errors at high or immediate priority. */
  toast?: boolean
  /** Bold first line of a toast. */
  title?: string
}

/** What the footer and the toasts render (plain data, safe in the store). */
export interface ShownNotice {
  key: string
  text: string
  level: NoticeLevel
  title?: string
}

export const DEFAULT_TIMEOUT_MS = 5000
export const TOAST_TIMEOUT_MS = 8000
export const MAX_TOASTS = 3

const RANK: Record<NoticePriority, number> = { immediate: 0, high: 1, medium: 2, low: 3 }

/** Glyph in front of a message; never an emoji-prone one (see BANNED in test/clipboard.test.ts). */
export const LEVEL_GLYPH: Record<NoticeLevel, string> = { info: "", success: "✓ ", warning: "△ ", error: "✘ " }

/** The text with its level glyph, unless the caller already wrote one. */
export function noticeText(n: Pick<ShownNotice, "text" | "level">): string {
  const glyph = LEVEL_GLYPH[n.level]
  return glyph && !n.text.startsWith(glyph.trim()) ? glyph + n.text : n.text
}

let current: Notice | undefined
let queue: Notice[] = []
let timer: ReturnType<typeof setTimeout> | undefined
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>()

const shown = (n: Notice): ShownNotice => ({ key: n.key, text: n.text, level: n.level ?? "info", title: n.title })
const priority = (n: Notice) => n.priority ?? "high"
const isToast = (n: Notice) => n.toast ?? ((n.level === "warning" || n.level === "error") && RANK[priority(n)] <= RANK.high)

function unref(t: ReturnType<typeof setTimeout>) {
  ;(t as { unref?: () => void }).unref?.()
  return t
}

function show(n: Notice | undefined) {
  clearTimeout(timer)
  timer = undefined
  current = n
  setState("notification", n ? shown(n) : undefined)
  const ms = n?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (n && ms > 0) timer = unref(setTimeout(next, ms))
}

/** The waiting notice with the best priority, first come first served within one priority. */
function next() {
  if (queue.length === 0) return show(undefined)
  let best = 0
  for (let i = 1; i < queue.length; i++) if (RANK[priority(queue[i]!)] < RANK[priority(queue[best]!)]) best = i
  const [n] = queue.splice(best, 1)
  show(n)
}

function removeToast(key: string) {
  clearTimeout(toastTimers.get(key))
  toastTimers.delete(key)
  if (state.toasts.some((t) => t.key === key)) setState("toasts", (list) => list.filter((t) => t.key !== key))
}

function toast(n: Notice) {
  const ms = n.timeoutMs ?? TOAST_TIMEOUT_MS
  const existing = state.toasts.find((t) => t.key === n.key)
  // A repeat replaces the card in place (with a fresh timer); a new one goes on top.
  if (existing) setState("toasts", (list) => list.map((t) => (t.key === n.key ? shown(n) : t)))
  else {
    const kept = state.toasts.slice(0, MAX_TOASTS - 1)
    for (const dropped of state.toasts.slice(MAX_TOASTS - 1)) removeToast(dropped.key)
    setState("toasts", [shown(n), ...kept])
  }
  clearTimeout(toastTimers.get(n.key))
  if (ms > 0) toastTimers.set(n.key, unref(setTimeout(() => removeToast(n.key), ms)))
}

/** Show a notification (see the module comment for the rules). */
export function notify(n: Notice) {
  if (n.invalidates?.length) {
    const stale = new Set(n.invalidates)
    queue = queue.filter((q) => !stale.has(q.key))
    for (const key of stale) removeToast(key)
    if (current && stale.has(current.key)) show(undefined)
  }
  if (isToast(n)) return toast(n)

  // A repeat of the message on screen: fold it or replace it, and restart its timer.
  if (current?.key === n.key) return show(n.fold ? n.fold(current, n) : n)
  const waiting = queue.findIndex((q) => q.key === n.key)
  if (waiting >= 0) {
    if (n.fold) queue[waiting] = n.fold(queue[waiting]!, n)
    else if (priority(n) === "immediate") queue.splice(waiting, 1)
    else return
  }
  if (priority(n) === "immediate") {
    // Jumps the line; what it interrupts shows again afterwards (unless it was immediate too).
    if (current && priority(current) !== "immediate") queue.unshift(current)
    queue = queue.filter((q) => priority(q) !== "immediate")
    return show(n)
  }
  if (waiting < 0 || !n.fold) queue.push(n)
  if (!current) next()
}

/** A one-off footer message (a key hint, "copied"): jumps the queue and is gone after `ms`. */
export function flash(text: string, ms = 2000, level: NoticeLevel = "info") {
  notify({ key: "flash", text, level, priority: "immediate", timeoutMs: ms, toast: false })
}

/**
 * Feedback on a command the user just ran ("✓ Đã lưu key", "Không có lệnh /x"): in the
 * footer where they are looking, never a toast. Errors and warnings stay longer.
 */
export function say(text: string, level: NoticeLevel = "info", ms?: number) {
  const timeoutMs = ms ?? (level === "error" || level === "warning" ? 8000 : 4000)
  notify({ key: "say", text, level, priority: "immediate", timeoutMs, toast: false })
}

/** Remove a notification wherever it is (footer, queue or toast). */
export function dismiss(key: string) {
  queue = queue.filter((q) => q.key !== key)
  removeToast(key)
  if (current?.key === key) next()
}

/** Tests and /clear: nothing showing, nothing waiting, no timers left. */
export function resetNotifications() {
  clearTimeout(timer)
  timer = undefined
  current = undefined
  queue = []
  for (const t of toastTimers.values()) clearTimeout(t)
  toastTimers.clear()
  setState({ notification: undefined, toasts: [] })
}
