import { mkdtemp, rm } from "node:fs/promises"
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
  await rm(home, { recursive: true, force: true })
})

function tool(name: string) {
  const t = localWatchlistTools(home).find((t) => t.name === name)!
  expect(t).toBeDefined()
  return t
}

test("local watchlist CRUD roundtrip, stored under the runtime's home", async () => {
  await tool("watchlist_local_create").execute({ name: "core" }, ctx())
  await expect(tool("watchlist_local_create").execute({ name: "core" }, ctx())).rejects.toThrow("đã có")
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
  expect((await tool("watchlist_local_list").execute({}, ctx())) as string).toContain("Chưa có")
})

test("watchlist tools are deferred until loaded and only the list is read-only", () => {
  const tools = localWatchlistTools(home)
  expect(tools.every((t) => t.deferrable && t.source === "local")).toBe(true)
  expect(tools.filter((t) => t.readOnly).map((t) => t.name)).toEqual(["watchlist_local_list", "watchlist_local_get"])
})

test("a corrupted watchlists.json is refused, never overwritten with an empty store", async () => {
  const file = path.join(home, "watchlists.json")
  await writeFile(file, '{"CORE": {"name": "CORE", "symbols": ["VCB"]', "utf8")
  await expect(tool("watchlist_local_create").execute({ name: "new" }, ctx())).rejects.toThrow("bị hỏng")
  await expect(tool("watchlist_local_list").execute({}, ctx())).rejects.toThrow("bị hỏng")
  // The user's data is still there to repair.
  expect(await Bun.file(file).text()).toContain('"VCB"')
  await writeFile(file, '["not", "a", "store"]', "utf8")
  await expect(tool("watchlist_local_add").execute({ name: "core", symbols: ["FPT"] }, ctx())).rejects.toThrow("sai cấu trúc")
})

test("symbols given as one comma string are split, uppercased and checked", async () => {
  expect(parseSymbols(["VCB, hpg;fpt", "VN30F1M", "GC=F", "^GSPC"]).symbols).toEqual(["VCB", "HPG", "FPT", "VN30F1M", "GC=F", "^GSPC"])
  expect(parseSymbols(["VCB", "giá vàng"]).invalid).toEqual(["giá", "vàng"])
  await tool("watchlist_local_create").execute({ name: "core" }, ctx())
  const out = (await tool("watchlist_local_add").execute({ name: "core", symbols: ["VCB, HPG", "x!"] }, ctx())) as string
  expect(out).toContain('"CORE": HPG, VCB')
  expect(out).toContain("bỏ qua mã không hợp lệ: x!")
  await expect(tool("watchlist_local_add").execute({ name: "core", symbols: ["!!"] }, ctx())).rejects.toThrow("Không có mã hợp lệ")
})

test("rename and get; an unknown list names the existing ones", async () => {
  await tool("watchlist_local_create").execute({ name: "core" }, ctx())
  await tool("watchlist_local_add").execute({ name: "core", symbols: ["FPT"] }, ctx())
  await tool("watchlist_local_rename").execute({ name: "core", to: "dai han" }, ctx())
  expect((await tool("watchlist_local_get").execute({ name: "Dai Han" }, ctx())) as string).toContain("FPT")
  await expect(tool("watchlist_local_get").execute({ name: "core" }, ctx())).rejects.toThrow("Đang có: DAI HAN")
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
