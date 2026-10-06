import { z } from "zod"
import { readJson, writeJson } from "../../store"
import { LOCAL_SOURCE, type ToolDef } from "../types"

/**
 * Personal watchlists in `<home>/watchlists.json`: this user's own tracking, available
 * offline, as opposed to the MCP server's team-shared `watchlist_*` tools.
 */

export interface LocalWatchlist {
  name: string
  symbols: string[]
  updatedAt: string
}

type Store = Record<string, LocalWatchlist>

const norm = (s: string) => s.trim().toUpperCase()

export function localWatchlistTools(home: string): ToolDef[] {
  const file = `${home}/watchlists.json`
  const load = async () => (await readJson<Store>(file, {})) ?? {}
  const save = (store: Store) => writeJson(file, store)
  const create: ToolDef<{ name: string }> = {
    name: "watchlist_local_create",
    description:
      "Tạo watchlist CÁ NHÂN trên máy này. Dùng khi user muốn theo dõi nhóm mã riêng (không share team — share team thì dùng watchlist_create của MCP server).",
    input: z.object({ name: z.string().min(1).describe("Tên watchlist") }),
    readOnly: false,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input) => `watchlist_local_create(${(input as { name: string }).name})`,
    async execute(input) {
      const name = norm(input.name)
      if (!name) throw new Error("Cần tên watchlist.")
      const store = await load()
      if (store[name]) throw new Error(`Watchlist "${name}" đã có.`)
      store[name] = { name, symbols: [], updatedAt: new Date().toISOString() }
      await save(store)
      return `Đã tạo watchlist "${name}".`
    },
  }
  const list: ToolDef<Record<string, never>> = {
    name: "watchlist_local_list",
    description: "Liệt kê watchlist cá nhân trên máy này kèm các mã đang theo dõi.",
    input: z.object({}),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: () => "watchlist_local_list()",
    async execute() {
      const store = await load()
      const names = Object.keys(store)
      if (names.length === 0) return "Chưa có watchlist cá nhân nào."
      return names.map((n) => `- ${n}: ${(store[n]!.symbols).join(", ") || "(trống)"}`).join("\n")
    },
  }
  const add: ToolDef<{ name: string; symbols: string[] }> = {
    name: "watchlist_local_add",
    description: "Thêm mã vào watchlist cá nhân (tự uppercase, dedupe).",
    input: z.object({
      name: z.string().min(1),
      symbols: z.array(z.string()).min(1).describe("Các mã cần theo dõi"),
    }),
    readOnly: false,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input) => {
      const i = input as { name: string; symbols: string[] }
      return `watchlist_local_add ${i.name} +${i.symbols.length}`
    },
    async execute(input) {
      const name = norm(input.name)
      const store = await load()
      const list = store[name]
      if (!list) throw new Error(`Không có watchlist "${name}".`)
      const set = new Set(list.symbols)
      for (const s of input.symbols) if (norm(s)) set.add(norm(s))
      list.symbols = [...set].sort()
      list.updatedAt = new Date().toISOString()
      await save(store)
      return `"${name}": ${list.symbols.join(", ")}`
    },
  }
  const remove: ToolDef<{ name: string; symbols: string[] }> = {
    name: "watchlist_local_remove",
    description: "Bớt mã khỏi watchlist cá nhân.",
    input: z.object({ name: z.string().min(1), symbols: z.array(z.string()).min(1) }),
    readOnly: false,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input) => {
      const i = input as { name: string; symbols: string[] }
      return `watchlist_local_remove ${i.name} -${i.symbols.length}`
    },
    async execute(input) {
      const name = norm(input.name)
      const store = await load()
      const list = store[name]
      if (!list) throw new Error(`Không có watchlist "${name}".`)
      const drop = new Set(input.symbols.map(norm))
      list.symbols = list.symbols.filter((s) => !drop.has(s))
      list.updatedAt = new Date().toISOString()
      await save(store)
      return `"${name}": ${list.symbols.join(", ") || "(trống)"}`
    },
  }
  const del: ToolDef<{ name: string }> = {
    name: "watchlist_local_delete",
    description: "Xóa watchlist cá nhân.",
    input: z.object({ name: z.string().min(1) }),
    readOnly: false,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input) => `watchlist_local_delete(${(input as { name: string }).name})`,
    async execute(input) {
      const name = norm(input.name)
      const store = await load()
      if (!store[name]) throw new Error(`Không có watchlist "${name}".`)
      delete store[name]
      await save(store)
      return `Đã xóa watchlist "${name}".`
    },
  }
  return [create, list, add, remove, del]
}
