import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { withFileLock } from "../../file-lock"
import { writeJson } from "../../store"
import { LOCAL_SOURCE, type ToolDef } from "../types"

/**
 * Personal watchlists in `<home>/watchlists.json`: this user's own tracking, available
 * offline, as opposed to the MCP server's team-shared `watchlist_*` tools. The `/watchlist`
 * panel uses the same functions (the user's own edits there need no approval: they never
 * go through the model).
 */

export interface LocalWatchlist {
  name: string
  symbols: string[]
  updatedAt: string
}

export type WatchlistStore = Record<string, LocalWatchlist>

export const watchlistFile = (home: string) => path.join(home, "watchlists.json")

const normName = (s: string) => s.trim().toUpperCase()

/** VN tickers (FPT), indices (VNINDEX), futures (VN30F1M), crypto pairs (BTCUSDT), Yahoo codes (GC=F, ^GSPC). */
const SYMBOL = /^[A-Z0-9^][A-Z0-9.=^-]{0,19}$/

/**
 * "VCB, hpg;FPT" → ["VCB", "HPG", "FPT"]. Models often pass one comma-separated string;
 * stored as is it became a single bogus symbol.
 */
export function parseSymbols(items: string[]) {
  const symbols: string[] = []
  const invalid: string[] = []
  for (const item of items) {
    for (const raw of item.split(/[\s,;]+/)) {
      const s = raw.trim().toUpperCase()
      if (!s) continue
      if (SYMBOL.test(s)) symbols.push(s)
      else invalid.push(raw.trim())
    }
  }
  return { symbols: [...new Set(symbols)], invalid }
}

function isStore(value: unknown): value is WatchlistStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.values(value).every(
    (w) =>
      w &&
      typeof w === "object" &&
      typeof (w as LocalWatchlist).name === "string" &&
      Array.isArray((w as LocalWatchlist).symbols) &&
      (w as LocalWatchlist).symbols.every((s) => typeof s === "string"),
  )
}

/**
 * Read the store. A missing file is an empty store; an unreadable or malformed one is an
 * error — never treated as empty, or the next save would wipe every list (LESSONS: refuse
 * a broken JSON file instead of overwriting it).
 */
export async function readWatchlists(home: string): Promise<WatchlistStore> {
  const file = watchlistFile(home)
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return {}
    throw new Error(`Không đọc được ${file}: ${(error as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`File watchlist bị hỏng (JSON không hợp lệ): ${file}. Sửa hoặc đổi tên file này rồi thử lại; dữ liệu cũ chưa bị ghi đè.`)
  }
  if (!isStore(parsed)) {
    throw new Error(`File watchlist sai cấu trúc: ${file}. Sửa hoặc đổi tên file này rồi thử lại; dữ liệu cũ chưa bị ghi đè.`)
  }
  return parsed
}

// Writes are serialized per file: two tool calls in one step must not each read the old
// store and overwrite the other's change. The queue orders this process's writes; the file
// lock orders them against other processes (two TUIs, a headless run) on the same home.
const queues = new Map<string, Promise<unknown>>()

/** Read-modify-write under the per-file queue and lock; `change` returns the message for the caller. */
export function updateWatchlists<T>(home: string, change: (store: WatchlistStore) => T): Promise<T> {
  const file = watchlistFile(home)
  const run = (queues.get(file) ?? Promise.resolve()).catch(() => {}).then(() =>
    withFileLock(file, async (lock) => {
      const store = await readWatchlists(home)
      const result = change(store)
      // A lock taken over meanwhile means another process wrote: fail rather than overwrite it.
      await writeJson(file, store, false, { beforeCommit: lock.assertHeld })
      return result
    }),
  )
  queues.set(file, run)
  return run
}

const stamp = () => new Date().toISOString()

function need(store: WatchlistStore, name: string) {
  const list = store[name]
  if (!list) {
    const names = Object.keys(store)
    throw new Error(`Không có watchlist "${name}".${names.length ? ` Đang có: ${names.join(", ")}.` : ""}`)
  }
  return list
}

export const watchlistOps = {
  async create(home: string, rawName: string) {
    const name = normName(rawName)
    if (!name) throw new Error("Cần tên watchlist.")
    return updateWatchlists(home, (store) => {
      if (store[name]) throw new Error(`Watchlist "${name}" đã có.`)
      store[name] = { name, symbols: [], updatedAt: stamp() }
      return `Đã tạo watchlist "${name}".`
    })
  },
  async add(home: string, rawName: string, items: string[]) {
    const name = normName(rawName)
    const { symbols, invalid } = parseSymbols(items)
    if (symbols.length === 0) throw new Error(`Không có mã hợp lệ${invalid.length ? ` (bỏ qua: ${invalid.join(", ")})` : ""}.`)
    return updateWatchlists(home, (store) => {
      const list = need(store, name)
      list.symbols = [...new Set([...list.symbols, ...symbols])].sort()
      list.updatedAt = stamp()
      return `"${name}": ${list.symbols.join(", ")}${invalid.length ? ` (bỏ qua mã không hợp lệ: ${invalid.join(", ")})` : ""}`
    })
  },
  async remove(home: string, rawName: string, items: string[]) {
    const name = normName(rawName)
    const drop = new Set(parseSymbols(items).symbols)
    return updateWatchlists(home, (store) => {
      const list = need(store, name)
      const missing = [...drop].filter((s) => !list.symbols.includes(s))
      list.symbols = list.symbols.filter((s) => !drop.has(s))
      list.updatedAt = stamp()
      return `"${name}": ${list.symbols.join(", ") || "(trống)"}${missing.length ? ` (không có sẵn: ${missing.join(", ")})` : ""}`
    })
  },
  async rename(home: string, rawName: string, rawTo: string) {
    const name = normName(rawName)
    const to = normName(rawTo)
    if (!to) throw new Error("Cần tên mới.")
    return updateWatchlists(home, (store) => {
      const list = need(store, name)
      if (to !== name && store[to]) throw new Error(`Watchlist "${to}" đã có.`)
      delete store[name]
      store[to] = { ...list, name: to, updatedAt: stamp() }
      return `Đã đổi "${name}" thành "${to}".`
    })
  },
  async delete(home: string, rawName: string) {
    const name = normName(rawName)
    return updateWatchlists(home, (store) => {
      need(store, name)
      delete store[name]
      return `Đã xóa watchlist "${name}".`
    })
  },
}

const ACTIONS = ["list", "get", "create", "add", "remove", "rename", "delete"] as const
type Action = (typeof ACTIONS)[number]
const READ_ACTIONS: readonly Action[] = ["list", "get"]

interface WatchlistInput {
  action: Action
  name?: string
  symbols?: string[]
  to?: string
}

function required<T>(value: T | undefined, action: Action, field: string): T {
  if (value === undefined || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0)) {
    throw new Error(`action "${action}" cần trường ${field}.`)
  }
  return value
}

async function listAll(home: string) {
  const store = await readWatchlists(home)
  const names = Object.keys(store)
  if (names.length === 0) return "Chưa có watchlist cá nhân nào."
  return names.map((n) => `- ${n}: ${store[n]!.symbols.join(", ") || "(trống)"}`).join("\n")
}

async function getOne(home: string, name: string) {
  const w = need(await readWatchlists(home), normName(name))
  return `"${w.name}" (${w.symbols.length} mã, cập nhật ${w.updatedAt}): ${w.symbols.join(", ") || "(trống)"}`
}

async function runAction(home: string, input: WatchlistInput): Promise<string> {
  const { action } = input
  const name = () => required(input.name, action, "name")
  const symbols = () => required(input.symbols, action, "symbols")
  switch (action) {
    case "list":
      return listAll(home)
    case "get":
      return getOne(home, name())
    case "create":
      return watchlistOps.create(home, name())
    case "add":
      return watchlistOps.add(home, name(), symbols())
    case "remove":
      return watchlistOps.remove(home, name(), symbols())
    case "rename":
      return watchlistOps.rename(home, name(), required(input.to, action, "to"))
    case "delete":
      return watchlistOps.delete(home, name())
  }
}

function summarize(input: WatchlistInput) {
  const parts = [input.name, input.symbols?.join(","), input.to && `→ ${input.to}`].filter(Boolean)
  return `watchlist_local ${input.action}${parts.length ? ` ${parts.join(" ")}` : ""}`
}

/**
 * One tool for the personal watchlists, the operation in `action` (as chart_render takes `kind`).
 * Seven tools cost about 3 KB of schema per request for a feature most turns never touch.
 * list/get run without approval; the others ask, `delete` on its own scope.
 */
export function localWatchlistTools(home: string): ToolDef[] {
  const fields = {
    name: z.string().min(1).optional().describe("Tên watchlist (mọi action trừ list)"),
    symbols: z.array(z.string()).min(1).optional().describe('add/remove: các mã, ví dụ ["VCB", "HPG"]'),
    to: z.string().min(1).optional().describe("rename: tên mới"),
  }
  const base = {
    name: "watchlist_local",
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input: unknown) => summarize(input as WatchlistInput),
    execute: (input: WatchlistInput) => runAction(home, input),
  } as const
  const readOnlyVariant: ToolDef<WatchlistInput> = {
    ...base,
    description: "Xem watchlist CÁ NHÂN trên máy này: list (mọi danh sách) hoặc get (các mã của một danh sách).",
    input: z.object({ action: z.enum(["list", "get"]), name: fields.name }),
    readOnly: true,
  }
  const tool: ToolDef<WatchlistInput> = {
    ...base,
    description:
      "Watchlist CÁ NHÂN trên máy này (không share team; share team dùng watchlist_* của MCP server). " +
      "action: list, get, create, add, remove (mã tự viết hoa, bỏ trùng), rename, delete.",
    input: z.object({ action: z.enum(ACTIONS), ...fields }),
    readOnly: false,
    readOnlyVariant,
    askFor: (input) => {
      const action = (input as Partial<WatchlistInput> | undefined)?.action
      if (action && READ_ACTIONS.includes(action)) return undefined
      return action === "delete" ? "xoa" : "ghi"
    },
  }
  return [tool]
}
