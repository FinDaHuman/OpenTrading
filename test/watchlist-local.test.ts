import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { localWatchlistTools } from "../src/core/tools/watchlist/local"

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
  expect(tools.filter((t) => t.readOnly).map((t) => t.name)).toEqual(["watchlist_local_list"])
})
