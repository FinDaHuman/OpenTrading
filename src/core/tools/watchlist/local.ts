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
    withFileLock(file, async () => {
      const store = await readWatchlists(home)
      const result = change(store)
      await writeJson(file, store)
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

export function localWatchlistTools(home: string): ToolDef[] {
  const base = { deferrable: true, source: LOCAL_SOURCE } as const
  const nameField = z.string().min(1).describe("Tên watchlist")
  const symbolsField = z.array(z.string()).min(1).describe('Các mã, ví dụ ["VCB", "HPG"]; chuỗi "VCB, HPG" cũng được tách')

  const create: ToolDef<{ name: string }> = {
    ...base,
    name: "watchlist_local_create",
    description:
      "Tạo watchlist CÁ NHÂN trên máy này. Dùng khi user muốn theo dõi nhóm mã riêng (không share team — share team thì dùng watchlist_create của MCP server).",
    input: z.object({ name: nameField }),
    readOnly: false,
    summarize: (input) => `watchlist_local_create(${(input as { name: string }).name})`,
    execute: (input) => watchlistOps.create(home, input.name),
  }
  const list: ToolDef<Record<string, never>> = {
    ...base,
    name: "watchlist_local_list",
    description: "Liệt kê watchlist cá nhân trên máy này kèm các mã đang theo dõi.",
    input: z.object({}),
    readOnly: true,
    summarize: () => "watchlist_local_list()",
    async execute() {
      const store = await readWatchlists(home)
      const names = Object.keys(store)
      if (names.length === 0) return "Chưa có watchlist cá nhân nào."
      return names.map((n) => `- ${n}: ${store[n]!.symbols.join(", ") || "(trống)"}`).join("\n")
    },
  }
  const get: ToolDef<{ name: string }> = {
    ...base,
    name: "watchlist_local_get",
    description: "Lấy các mã của một watchlist cá nhân (để gọi tiếp tool giá, ví dụ vn_equity_quote_batch).",
    input: z.object({ name: nameField }),
    readOnly: true,
    summarize: (input) => `watchlist_local_get(${(input as { name: string }).name})`,
    async execute(input) {
      const w = need(await readWatchlists(home), normName(input.name))
      return `"${w.name}" (${w.symbols.length} mã, cập nhật ${w.updatedAt}): ${w.symbols.join(", ") || "(trống)"}`
    },
  }
  const add: ToolDef<{ name: string; symbols: string[] }> = {
    ...base,
    name: "watchlist_local_add",
    description: "Thêm mã vào watchlist cá nhân (tự viết hoa, tách chuỗi có dấu phẩy, bỏ trùng).",
    input: z.object({ name: nameField, symbols: symbolsField }),
    readOnly: false,
    summarize: (input) => {
      const i = input as { name: string; symbols: string[] }
      return `watchlist_local_add ${i.name} +${i.symbols.join(",")}`
    },
    execute: (input) => watchlistOps.add(home, input.name, input.symbols),
  }
  const remove: ToolDef<{ name: string; symbols: string[] }> = {
    ...base,
    name: "watchlist_local_remove",
    description: "Bớt mã khỏi watchlist cá nhân.",
    input: z.object({ name: nameField, symbols: symbolsField }),
    readOnly: false,
    summarize: (input) => {
      const i = input as { name: string; symbols: string[] }
      return `watchlist_local_remove ${i.name} -${i.symbols.join(",")}`
    },
    execute: (input) => watchlistOps.remove(home, input.name, input.symbols),
  }
  const rename: ToolDef<{ name: string; to: string }> = {
    ...base,
    name: "watchlist_local_rename",
    description: "Đổi tên watchlist cá nhân.",
    input: z.object({ name: nameField, to: z.string().min(1).describe("Tên mới") }),
    readOnly: false,
    summarize: (input) => {
      const i = input as { name: string; to: string }
      return `watchlist_local_rename ${i.name} → ${i.to}`
    },
    execute: (input) => watchlistOps.rename(home, input.name, input.to),
  }
  const del: ToolDef<{ name: string }> = {
    ...base,
    name: "watchlist_local_delete",
    description: "Xóa watchlist cá nhân.",
    input: z.object({ name: nameField }),
    readOnly: false,
    annotations: { destructive: true },
    summarize: (input) => `watchlist_local_delete(${(input as { name: string }).name})`,
    execute: (input) => watchlistOps.delete(home, input.name),
  }
  return [create, list, get, add, remove, rename, del]
}
