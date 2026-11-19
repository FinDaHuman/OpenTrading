import { mkdtemp } from "node:fs/promises"
import { removeTempDir } from "./helpers/temp"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import { localWatchlistTools, parseSymbols } from "../src/core/tools/watchlist/local"

const ctx = () => ({ signal: new AbortController().signal, callId: "c1" })
let home = ""

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "ot-wl-"))
})

afterEach(async () => {
  await removeTempDir(home)
})

const ACTION: Record<string, string> = {
  watchlist_local_create: "create",
  watchlist_local_list: "list",
  watchlist_local_get: "get",
  watchlist_local_add: "add",
  watchlist_local_remove: "remove",
  watchlist_local_rename: "rename",
  watchlist_local_delete: "delete",
}

/** The old per-action tool names, now `action` values of the one `watchlist_local` tool. */
function tool(name: string) {
  const [t] = localWatchlistTools(home)
  expect(t!.name).toBe("watchlist_local")
  return { execute: (input: Record<string, unknown>, c: ReturnType<typeof ctx>) => t!.execute({ action: ACTION[name], ...input }, c) }
}

test("local watchlist CRUD roundtrip, stored under the runtime's home", async () => {
  await tool("watchlist_local_create").execute({ name: "core" }, ctx())
  await expect(tool("watchlist_local_create").execute({ name: "core" }, ctx())).rejects.toThrow("already exists")
  await tool("watchlist_local_add").execute({ name: "core", symbols: ["vcb", "HPG", "VCB"] }, ctx())
  const list = (await tool("watchlist_local_list").execute({}, ctx())) as string
  expect(list).toContain("HPG")
  expect(list).toContain("VCB")
  expect(await Bun.file(path.join(home, "watchlists.json")).exists()).toBe(true)
  await tool("watchlist_local_remove").execute({ name: "core", symbols: ["vCb"] }, ctx())
  const after = (await tool("watchlist_local_list").execute({}, ctx())) as string
  expect(after).not.toContain("VCB")
  expect(after).toContain("HPG")
  await tool("watchlist_local_delete").execute({ name: "core" }, ctx())
  expect((await tool("watchlist_local_list").execute({}, ctx())) as string).toContain("No personal watchlists")
})

test("one deferrable watchlist tool: list/get never ask, writes ask, delete on its own scope", async () => {
  const tools = localWatchlistTools(home)
  expect(tools.map((t) => t.name)).toEqual(["watchlist_local"])
  const [t] = tools
  expect(t!.deferrable && t!.source === "local").toBe(true)
  expect(t!.readOnly).toBe(false)
  expect(t!.askFor!({ action: "list" })).toBeUndefined()
  expect(t!.askFor!({ action: "get", name: "core" })).toBeUndefined()
  expect(t!.askFor!({ action: "add", name: "core", symbols: ["FPT"] })).toBe("ghi")
  expect(t!.askFor!({ action: "delete", name: "core" })).toBe("xoa")
  // Read-only agents get the same name with only list/get.
  const ro = t!.readOnlyVariant!
  expect(ro.name).toBe("watchlist_local")
  expect(ro.readOnly).toBe(true)
  expect(JSON.stringify(ro.input)).not.toContain("delete")
  await expect(t!.execute({ action: "add", name: "core" }, ctx())).rejects.toThrow("needs the symbols field")
})

test("a corrupted watchlists.json is refused, never overwritten with an empty store", async () => {
  const file = path.join(home, "watchlists.json")
  await writeFile(file, '{"CORE": {"name": "CORE", "symbols": ["VCB"]', "utf8")
  await expect(tool("watchlist_local_create").execute({ name: "new" }, ctx())).rejects.toThrow("is damaged")
  await expect(tool("watchlist_local_list").execute({}, ctx())).rejects.toThrow("is damaged")
  // The user's data is still there to repair.
  expect(await Bun.file(file).text()).toContain('"VCB"')
  await writeFile(file, '["not", "a", "store"]', "utf8")
  await expect(tool("watchlist_local_add").execute({ name: "core", symbols: ["FPT"] }, ctx())).rejects.toThrow("wrong structure")
})

test("symbols given as one comma string are split, uppercased and checked", async () => {
  expect(parseSymbols(["VCB, hpg;fpt", "VN30F1M", "GC=F", "^GSPC"]).symbols).toEqual(["VCB", "HPG", "FPT", "VN30F1M", "GC=F", "^GSPC"])
  expect(parseSymbols(["VCB", "giá vàng"]).invalid).toEqual(["giá", "vàng"])
  await tool("watchlist_local_create").execute({ name: "core" }, ctx())
  const out = (await tool("watchlist_local_add").execute({ name: "core", symbols: ["VCB, HPG", "x!"] }, ctx())) as string
  expect(out).toContain('"CORE": HPG, VCB')
  expect(out).toContain("skipped invalid tickers: x!")
  await expect(tool("watchlist_local_add").execute({ name: "core", symbols: ["!!"] }, ctx())).rejects.toThrow("No valid tickers")
})

test("rename and get; an unknown list names the existing ones", async () => {
  await tool("watchlist_local_create").execute({ name: "core" }, ctx())
  await tool("watchlist_local_add").execute({ name: "core", symbols: ["FPT"] }, ctx())
  await tool("watchlist_local_rename").execute({ name: "core", to: "dai han" }, ctx())
  expect((await tool("watchlist_local_get").execute({ name: "Dai Han" }, ctx())) as string).toContain("FPT")
  await expect(tool("watchlist_local_get").execute({ name: "core" }, ctx())).rejects.toThrow("Existing: DAI HAN")
})

test("parallel adds in one step keep every symbol", async () => {
  await tool("watchlist_local_create").execute({ name: "core" }, ctx())
  const add = tool("watchlist_local_add")
  await Promise.all(["VCB", "HPG", "FPT", "MWG", "SSI"].map((s) => add.execute({ name: "core", symbols: [s] }, ctx())))
  expect((await tool("watchlist_local_get").execute({ name: "core" }, ctx())) as string).toContain("FPT, HPG, MWG, SSI, VCB")
})

test("three processes adding at once lose no symbol (the lock spans processes)", async () => {
  await tool("watchlist_local_create").execute({ name: "qa" }, ctx())
  const script = path.join(import.meta.dir, "fixtures", "scripts", "watchlist-writer.ts")
  const procs = ["X", "Y", "Z"].map((prefix) => Bun.spawn([process.execPath, script, home, prefix], { stdout: "pipe", stderr: "pipe" }))
  const codes = await Promise.all(procs.map((p) => p.exited))
  const errors = await Promise.all(procs.map((p) => new Response(p.stderr).text()))
  expect(errors.join("")).toBe("")
  expect(codes).toEqual([0, 0, 0])
  const store = JSON.parse(await Bun.file(path.join(home, "watchlists.json")).text())
  expect(store.QA.symbols).toHaveLength(60)
  expect(await Bun.file(path.join(home, "watchlists.json.lock")).exists()).toBe(false)
}, 60_000)

test("a lock left by a dead process is taken over; a live one makes the writer wait, then fail clearly", async () => {
  const { withFileLock } = await import("../src/core/file-lock")
  const file = path.join(home, "x.json")
  // pid 2^22+1 is not running anywhere we test.
  await writeFile(`${file}.lock`, JSON.stringify({ pid: 4194305, at: Date.now() }))
  expect(await withFileLock(file, async () => "ok")).toBe("ok")
  await writeFile(`${file}.lock`, JSON.stringify({ pid: process.ppid, at: Date.now() }))
  await expect(withFileLock(file, async () => "ok", { timeoutMs: 200 })).rejects.toThrow("đang giữ khoá")
})
