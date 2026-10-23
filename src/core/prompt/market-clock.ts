import { readFileSync } from "node:fs"
import path from "node:path"
import { BUNDLED_ROOT } from "../bundle"

/**
 * Trading-session clock (HarnessPlan §4.2, layer 2). The schedule is data in
 * market/calendar.json, never hard-coded: exchange rules change (KRX, CCP roadmap).
 */

export interface Slot {
  from: string
  to: string
  phase: string
  label: string
}

export interface Calendar {
  verified: boolean
  note: string
  asof: string
  timezone: string
  holidays: string[]
  exchanges: Record<string, Slot[]>
}

/** What decides whether the clock needs re-sending: the date and each exchange's phase. */
export interface ClockSnapshot {
  date: string
  phases: Record<string, string>
}

export const CALENDAR_FILE = path.join(BUNDLED_ROOT, "market", "calendar.json")

export function loadCalendar(file = CALENDAR_FILE): Calendar {
  return JSON.parse(readFileSync(file, "utf8")) as Calendar
}

const WEEKDAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"]

/** Wall-clock parts in the calendar's timezone. */
function localParts(now: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  const date = `${parts.year}-${parts.month}-${parts.day}`
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return { date, time: `${parts.hour}:${parts.minute}`, weekday }
}

export interface ClockState {
  snapshot: ClockSnapshot
  date: string
  time: string
  weekday: string
  tradingDay: boolean
  exchanges: { name: string; phase: string; label: string }[]
}

export function clockState(now: Date, calendar: Calendar = loadCalendar()): ClockState {
  const { date, time, weekday } = localParts(now, calendar.timezone)
  const tradingDay = weekday >= 1 && weekday <= 5 && !calendar.holidays.includes(date)
  const exchanges = Object.entries(calendar.exchanges).map(([name, slots]) => {
    if (!tradingDay) return { name, phase: "closed-day", label: "nghỉ giao dịch" }
    const slot = slots.find((s) => time >= s.from && time < s.to)
    if (slot) return { name, phase: slot.phase, label: `${slot.label}, tới ${slot.to}` }
    const first = slots[0]
    if (first && time < first.from) return { name, phase: "pre-open", label: `chưa mở cửa, mở lúc ${first.from}` }
    return { name, phase: "closed", label: "đã đóng cửa" }
  })
  return {
    snapshot: { date, phases: Object.fromEntries(exchanges.map((e) => [e.name, e.phase])) },
    date,
    time,
    weekday: WEEKDAYS[weekday]!,
    tradingDay,
    exchanges,
  }
}

export function sameSnapshot(a?: ClockSnapshot, b?: ClockSnapshot) {
  return Boolean(a && b) && JSON.stringify(a) === JSON.stringify(b)
}

export function renderClock(state: ClockState, calendar: Calendar = loadCalendar()) {
  const [y, m, d] = state.date.split("-")
  const lines = [
    `Cập nhật lúc ${state.time} (giờ Việt Nam), ${state.weekday} ${d}/${m}/${y}.${state.tradingDay ? "" : " Hôm nay không phải ngày giao dịch."}`,
    ...state.exchanges.map((e) => `${e.name}: ${e.label}`),
    "Khối này chỉ gửi lại khi phiên thay đổi; cần giờ chính xác thì gọi tool current_time.",
  ]
  if (!calendar.verified) lines.push(`(Lịch phiên chưa kiểm chứng, dữ liệu tới ${calendar.asof}: nhắc người dùng đối chiếu thông báo của sàn.)`)
  return lines.join("\n")
}
