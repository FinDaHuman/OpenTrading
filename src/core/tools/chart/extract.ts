import { parseResult, recallResult } from "../refs"
import type { ChartBar } from "./data"

/**
 * Pull chart data out of a stored tool result (see refs.ts). Field names differ between
 * upstreams (vnstock, Vietstock, DNSE, yfinance), so each role is looked up under several
 * names. Nothing is guessed: when no array fits, the error says what was found.
 */

const ALIASES = {
  open: ["o", "open", "open_price", "openprice", "opening_price"],
  high: ["h", "high", "high_price", "highprice", "highest_price"],
  low: ["l", "low", "low_price", "lowprice", "lowest_price"],
  close: ["c", "close", "close_price", "closeprice", "closing_price", "adj_close", "price", "match_price", "last", "value"],
  volume: ["v", "volume", "vol", "volume_accumulated", "total_volume", "nmvolume", "match_volume"],
  time: ["t", "time", "date", "trading_date", "tradingdate", "d", "datetime", "timestamp", "period", "month", "year"],
  label: ["symbol", "ticker", "code", "name", "label", "organ_name", "industry", "sector", "group", "basket", "asset"],
}

type Row = Record<string, unknown>

const num = (v: unknown) => {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v)
  return undefined
}

function keyOf(row: Row, names: string[], wanted?: string) {
  const keys = Object.keys(row)
  const lower = new Map(keys.map((k) => [k.toLowerCase(), k]))
  if (wanted) return lower.get(wanted.toLowerCase())
  for (const n of names) {
    const k = lower.get(n)
    if (k !== undefined) return k
  }
  return undefined
}

interface Candidate {
  path: string
  rows: Row[] | number[]
}

/** Every array of objects (with a number) or of numbers, with its dotted path. */
function candidates(value: unknown, path = "", out: Candidate[] = [], depth = 0): Candidate[] {
  if (depth > 6 || value === null || typeof value !== "object") return out
  if (Array.isArray(value)) {
    if (value.length >= 2 && value.every((v) => typeof v === "number")) out.push({ path, rows: value as number[] })
    else {
      const rows = value.filter((v): v is Row => !!v && typeof v === "object" && !Array.isArray(v))
      if (rows.length >= 2 && rows.some((r) => Object.values(r).some((x) => num(x) !== undefined))) out.push({ path, rows })
      value.slice(0, 5).forEach((v, i) => candidates(v, `${path}[${i}]`, out, depth + 1))
    }
    return out
  }
  for (const [k, v] of Object.entries(value)) candidates(v, path ? `${path}.${k}` : k, out, depth + 1)
  return out
}

function at(value: unknown, path: string): unknown {
  let cur = value
  for (const part of path.split(".").filter(Boolean)) {
    if (cur === null || typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

const isoDay = (v: unknown) => {
  if (typeof v === "number") {
    const ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : undefined
    return ms ? new Date(ms).toISOString().slice(0, 10) : String(v)
  }
  const s = String(v ?? "").trim()
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s
}

export interface Extracted {
  ref: string
  tool: string
  path: string
  /** Symbol named in the result, if any (data.symbol, a row's symbol…). */
  symbol?: string
  bars?: ChartBar[]
  series?: number[]
  times?: string[]
  labels?: string[]
  /** Close went up versus the previous row (red/green volume columns). */
  dirs?: boolean[]
  /** Which field the series came from. */
  field?: string
}

export interface ExtractOptions {
  /** Dotted path of the array inside the result (when it holds several). */
  path?: string
  /** Numeric field for single-series charts (default: the close/price/value field). */
  field?: string
  /** Text field naming each row (bar/pie labels). */
  labelField?: string
  /** Need OHLC (candlestick). */
  ohlc?: boolean
}

function symbolOf(value: unknown, rows: Row[]) {
  const top = value as { symbol?: unknown; data?: { symbol?: unknown } } | undefined
  const direct = top?.data?.symbol ?? top?.symbol
  if (typeof direct === "string") return direct.toUpperCase()
  const k = rows[0] ? keyOf(rows[0], ["symbol", "ticker"]) : undefined
  const first = k ? rows[0]![k] : undefined
  return typeof first === "string" && rows.every((r) => r[k!] === first) ? first.toUpperCase() : undefined
}

/** Resolve `ref` and read the array the chart needs. Throws a readable error otherwise. */
export function extractFromRef(ref: string, opts: ExtractOptions = {}): Extracted {
  const stored = recallResult(ref)
  if (!stored) throw new Error(`Không còn kết quả "${ref}" (chỉ giữ ~40 kết quả gần nhất trong phiên). Gọi lại tool dữ liệu rồi dùng ref mới.`)
  const value = parseResult(stored.text)
  if (value === undefined) throw new Error(`Kết quả ${ref} (${stored.tool}) không phải JSON, không trích được số.`)
  const all = candidates(value)
  let chosen: Candidate | undefined
  if (opts.path) {
    const picked = at(value, opts.path)
    chosen = all.find((c) => c.path === opts.path) ?? (Array.isArray(picked) ? candidates(picked, opts.path)[0] : undefined)
    if (!chosen) throw new Error(`Không có mảng dữ liệu ở "${opts.path}" trong ${ref}. Có: ${all.map((c) => `${c.path || "(gốc)"} (${c.rows.length})`).join(", ") || "không có"}.`)
  } else {
    const objectArrays = all.filter((c) => typeof c.rows[0] === "object")
    const withOhlc = objectArrays.filter((c) => {
      const r = c.rows[0] as Row
      return keyOf(r, ALIASES.open) && keyOf(r, ALIASES.high) && keyOf(r, ALIASES.low) && keyOf(r, ALIASES.close)
    })
    const pool = opts.ohlc ? withOhlc : withOhlc.length > 0 ? withOhlc : all
    chosen = pool.sort((a, b) => b.rows.length - a.rows.length)[0]
  }
  if (!chosen) {
    throw new Error(
      opts.ohlc
        ? `Kết quả ${ref} (${stored.tool}) không có mảng nến mở/cao/thấp/đóng. Dùng kind khác (line) hoặc gọi tool nến.`
        : `Kết quả ${ref} (${stored.tool}) không có mảng số để vẽ.`,
    )
  }
  const base = { ref, tool: stored.tool, path: chosen.path || "(gốc)" }
  if (typeof chosen.rows[0] === "number") return { ...base, series: chosen.rows as number[] }

  let rows = chosen.rows as Row[]
  const sample = rows[0]!
  const timeKey = keyOf(sample, ALIASES.time)
  // Some sources list newest first: charts read left (old) to right (new).
  if (timeKey && rows.length > 1 && String(rows[0]![timeKey]) > String(rows[rows.length - 1]![timeKey])) rows = [...rows].reverse()
  const times = timeKey ? rows.map((r) => isoDay(r[timeKey])) : undefined
  const symbol = symbolOf(value, rows)

  if (opts.ohlc) {
    const [o, h, l, c] = [ALIASES.open, ALIASES.high, ALIASES.low, ALIASES.close].map((a) => keyOf(sample, a)!)
    const v = keyOf(sample, ALIASES.volume)
    const bars: ChartBar[] = []
    const barTimes: string[] = []
    rows.forEach((r, i) => {
      const bar = { o: num(r[o!]), h: num(r[h!]), l: num(r[l!]), c: num(r[c!]) }
      if (bar.o === undefined || bar.h === undefined || bar.l === undefined || bar.c === undefined) return
      const vol = v ? num(r[v]) : undefined
      bars.push({ o: bar.o, h: bar.h, l: bar.l, c: bar.c, ...(vol !== undefined ? { v: vol } : {}) })
      if (times) barTimes.push(times[i]!)
    })
    return { ...base, symbol, bars, ...(times ? { times: barTimes } : {}) }
  }

  const fieldKey = keyOf(sample, ALIASES.close, opts.field) ?? (opts.field ? undefined : Object.keys(sample).find((k) => k !== timeKey && num(sample[k]) !== undefined))
  if (!fieldKey) {
    const numeric = Object.keys(sample).filter((k) => num(sample[k]) !== undefined)
    throw new Error(`Không có trường "${opts.field}" trong ${ref}. Trường số có: ${numeric.join(", ") || "không có"}.`)
  }
  const labelKey = keyOf(sample, ALIASES.label, opts.labelField)
  const series: number[] = []
  const labels: string[] = []
  const kept: string[] = []
  const closeKey = keyOf(sample, ALIASES.close)
  const closes: number[] = []
  rows.forEach((r, i) => {
    const y = num(r[fieldKey])
    if (y === undefined) return
    series.push(y)
    if (labelKey) labels.push(String(r[labelKey] ?? ""))
    if (times) kept.push(times[i]!)
    if (closeKey) closes.push(num(r[closeKey]) ?? NaN)
  })
  const dirs = closes.length === series.length && closes.every(Number.isFinite) ? closes.map((c, i) => i === 0 || c >= closes[i - 1]!) : undefined
  return {
    ...base,
    symbol,
    series,
    field: fieldKey,
    ...(times ? { times: kept } : {}),
    ...(labelKey ? { labels } : {}),
    ...(dirs ? { dirs } : {}),
  }
}
