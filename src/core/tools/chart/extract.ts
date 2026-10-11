import { parseResult, recallResult, storedResults } from "../refs"
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
  /** Symbol of the object holding the array or of an ancestor (`series[i].symbol`, `data.symbol`). */
  symbol?: string
}

/** Objects that can name the arrays under them; checked in this order. */
const OWNER_KEYS = ["symbol", "ticker", "code"]
/** Nodes visited per result: deep, wide results stop here instead of exploding. */
const VISIT_BUDGET = 5000
/** Elements of one array walked into (a batch of up to this many symbols is fully seen). */
const WALK_ELEMENTS = 50

/** Ticker-shaped (FPT, VN30, BTC-USD), so a numeric ICB `code` or a status string never names data. */
const TICKER = /^(?=.*[A-Z])[A-Z0-9._-]{2,15}$/i

function ownerSymbol(value: Row, inherited: string | undefined) {
  const k = keyOf(value, OWNER_KEYS)
  const v = k ? value[k] : undefined
  return typeof v === "string" && TICKER.test(v.trim()) ? v.trim().toUpperCase() : inherited
}

/** Every array of objects (with a number) or of numbers, with its path and owning symbol. */
function candidates(value: unknown, path = "", out: Candidate[] = [], depth = 0, symbol?: string, budget = { left: VISIT_BUDGET }): Candidate[] {
  if (depth > 6 || value === null || typeof value !== "object" || budget.left <= 0) return out
  budget.left--
  if (Array.isArray(value)) {
    if (value.length >= 2 && value.every((v) => typeof v === "number")) out.push({ path, rows: value as number[], symbol })
    else {
      const rows = value.filter((v): v is Row => !!v && typeof v === "object" && !Array.isArray(v))
      if (rows.length >= 2 && rows.some((r) => Object.values(r).some((x) => num(x) !== undefined))) out.push({ path, rows, symbol })
      value.slice(0, WALK_ELEMENTS).forEach((v, i) => candidates(v, `${path}[${i}]`, out, depth + 1, symbol, budget))
    }
    return out
  }
  const own = ownerSymbol(value as Row, symbol)
  for (const [k, v] of Object.entries(value)) candidates(v, path ? `${path}.${k}` : k, out, depth + 1, own, budget)
  return out
}

/** `a.b[1].c` style paths. */
function at(value: unknown, path: string): unknown {
  let cur = value
  for (const part of path.match(/[^.[\]]+/g) ?? []) {
    if (cur === null || typeof cur !== "object") return undefined
    cur = Array.isArray(cur) && /^\d+$/.test(part) ? cur[Number(part)] : (cur as Record<string, unknown>)[part]
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
  /** Symbol to read from a result holding several (a batch); checked against the data. */
  symbol?: string
  /**
   * Display name the model gave the chart ("SHB — 90 ngày"). A leading ticker picks that
   * symbol from a batch, and must not name another symbol than the data's.
   */
  hint?: string
}

function symbolOf(value: unknown, rows: Row[]) {
  const top = value as { symbol?: unknown; data?: { symbol?: unknown } } | undefined
  const direct = top?.data?.symbol ?? top?.symbol
  if (typeof direct === "string") return direct.toUpperCase()
  const k = rows[0] ? keyOf(rows[0], ["symbol", "ticker"]) : undefined
  const first = k ? rows[0]![k] : undefined
  return typeof first === "string" && rows.every((r) => r[k!] === first) ? first.toUpperCase() : undefined
}

/** A ticker-shaped first word of a display name ("SHB — 90 ngày" → SHB). */
export function leadingTicker(hint: string | undefined) {
  const m = /^\s*((?=[A-Z0-9]*[A-Z])[A-Z0-9]{3,10})(?![\p{L}\p{N}])/u.exec(hint ?? "")
  return m?.[1]
}

interface Located {
  stored: { tool: string; text: string }
  value: unknown
  all: Candidate[]
  /** Arrays fit for the chart, longest first. */
  pool: Candidate[]
}

function locate(ref: string, ohlc: boolean | undefined): Located {
  const stored = recallResult(ref)
  if (!stored) throw new Error(`Không còn kết quả "${ref}" (chỉ giữ ~40 kết quả gần nhất trong phiên). Gọi lại tool dữ liệu rồi dùng ref mới.`)
  const value = parseResult(stored.text)
  if (value === undefined) throw new Error(`Kết quả ${ref} (${stored.tool}) không phải JSON, không trích được số.`)
  const all = candidates(value)
  const objectArrays = all.filter((c) => typeof c.rows[0] === "object")
  const withOhlc = objectArrays.filter((c) => {
    const r = c.rows[0] as Row
    return keyOf(r, ALIASES.open) && keyOf(r, ALIASES.high) && keyOf(r, ALIASES.low) && keyOf(r, ALIASES.close)
  })
  const pool = (ohlc ? withOhlc : withOhlc.length > 0 ? withOhlc : all).slice().sort((a, b) => b.rows.length - a.rows.length)
  return { stored, value, all, pool }
}

/** Distinct symbols owning the candidate arrays, in result order. */
function symbolsIn(pool: Candidate[]) {
  return [...new Set(pool.map((c) => c.symbol).filter((s): s is string => !!s))]
}

/** Symbols a stored result holds data for (several = a batch). */
export function refSymbols(ref: string, opts: { ohlc?: boolean } = {}): string[] {
  const { pool } = locate(ref, opts.ohlc)
  return symbolsIn(pool.slice().sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true })))
}

/** Resolve `ref` and read the array the chart needs. Throws a readable error otherwise. */
export function extractFromRef(ref: string, opts: ExtractOptions = {}): Extracted {
  const { stored, value, all, pool } = locate(ref, opts.ohlc)
  let chosen: Candidate | undefined
  if (opts.path) {
    const picked = at(value, opts.path)
    chosen = all.find((c) => c.path === opts.path) ?? (Array.isArray(picked) ? candidates(picked, opts.path)[0] : undefined)
    if (!chosen) throw new Error(`Không có mảng dữ liệu ở "${opts.path}" trong ${ref}. Có: ${all.map((c) => `${c.path || "(gốc)"} (${c.rows.length})`).join(", ") || "không có"}.`)
  } else {
    const known = symbolsIn(pool)
    // In a batch, a display name starting with one of its symbols picks it ("SHB — 90 ngày").
    const lead = leadingTicker(opts.hint)
    const wanted = opts.symbol?.trim().toUpperCase() || (known.length > 1 && lead && known.includes(lead) ? lead : undefined)
    if (wanted && known.length > 0) {
      chosen = pool.find((c) => c.symbol === wanted)
      if (!chosen) {
        throw new Error(`Kết quả ${ref} không có dữ liệu mã ${wanted}. Mã có trong kết quả: ${known.join(", ")} — chọn bằng from_symbol.`)
      }
    } else if (known.length > 1) {
      // A batch: taking the longest array would silently draw the first symbol.
      throw new Error(`Kết quả ${ref} có dữ liệu nhiều mã: ${known.join(", ")}. Chọn một mã bằng from_symbol (ví dụ from_symbol: "${known[0]}").`)
    } else chosen = pool[0]
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
  const symbol = chosen.symbol ?? symbolOf(value, rows)
  checkSymbol(ref, symbol, opts)

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

/**
 * The data's symbol must be the one the model named: `from_symbol`, or a ticker leading the
 * display name. A mismatch means the chart would show one symbol's numbers under another's name.
 */
function checkSymbol(ref: string, symbol: string | undefined, opts: ExtractOptions) {
  if (!symbol) return
  const named = opts.symbol?.trim().toUpperCase()
  if (named) {
    if (named !== symbol) throw new Error(`Kết quả ${ref} là dữ liệu mã ${symbol}, không phải ${named}. Dùng ref của lần gọi lấy dữ liệu ${named}.`)
    return
  }
  // Only a token that is another stored result's symbol counts: chart titles often start
  // with KLGD, LNST, ROE, EPS…, which are not tickers.
  const lead = leadingTicker(opts.hint)
  if (lead && lead !== symbol && otherRefHolds(lead, ref)) {
    throw new Error(
      `Tên biểu đồ bắt đầu bằng "${lead}" nhưng ${ref} là dữ liệu mã ${symbol}. Dùng ref của mã ${lead}, hoặc nếu "${lead}" không phải mã thì truyền from_symbol: "${symbol}".`,
    )
  }
}

/**
 * Every series a result holds, one per symbol (a batch gives several), for comparisons.
 * `symbols` keeps only those; a result without symbols gives its one series.
 */
export function extractAllFromRef(ref: string, opts: { field?: string; symbols?: string[] } = {}): Extracted[] {
  const known = refSymbols(ref)
  const wanted = opts.symbols?.map((s) => s.trim().toUpperCase()).filter(Boolean)
  if (known.length <= 1) {
    const one = extractFromRef(ref, { field: opts.field })
    if (wanted?.length && one.symbol && !wanted.includes(one.symbol)) {
      throw new Error(`Kết quả ${ref} là dữ liệu mã ${one.symbol}, không có ${wanted.join(", ")}.`)
    }
    return [one]
  }
  const picked = wanted?.length ? known.filter((s) => wanted.includes(s)) : known
  const missing = wanted?.filter((s) => !known.includes(s)) ?? []
  if (missing.length > 0) throw new Error(`Kết quả ${ref} không có mã ${missing.join(", ")}. Mã có: ${known.join(", ")}.`)
  return picked.map((symbol) => extractFromRef(ref, { field: opts.field, symbol }))
}

/** Symbols of each stored result, parsed once per result. */
const symbolCache = new Map<string, string[]>()

/** Whether a stored result other than `ref` holds data for `symbol`. */
function otherRefHolds(symbol: string, ref: string) {
  for (const stored of storedResults()) {
    if (stored.ref === ref) continue
    const key = `${stored.ref}@${stored.at}:${stored.text.length}`
    let symbols = symbolCache.get(key)
    if (!symbols) {
      const value = parseResult(stored.text)
      symbols = value === undefined ? [] : symbolsIn(candidates(value))
      if (symbolCache.size > 200) symbolCache.clear()
      symbolCache.set(key, symbols)
    }
    if (symbols.includes(symbol)) return true
  }
  return false
}
