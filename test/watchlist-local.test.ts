import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { localWatchlistTools } from "../src/core/tools/watchlist/local"

const ctx = () => ({ signal: new AbortController().signal, callId: "c1" })
let home = ""
let prev = ""

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "ot-wl-"))
  prev = process.env.OPENTRADING_HOME ?? ""
  process.env.OPENTRADING_HOME = home
})

afterEach(() => {
  process.env.OPENTRADING_HOME = prev
})

function tool(name: string) {
  const t = localWatchlistTools().find((t) => t.name === name)!
  expect(t).toBeDefined()
  return t
}

test("local watchlist CRUD roundtrip", async () => {
  await tool("watchlist_local_create").execute({ name: "core" }, ctx())
  await expect(tool("watchlist_local_create").execute({ name: "core" }, ctx())).rejects.toThrow("đã có")
  await tool("watchlist_local_add").execute({ name: "core", symbols: ["vcb", "HPG", "VCB"] }, ctx())
  const list = (await tool("watchlist_local_list").execute({}, ctx())) as string
  expect(list).toContain("HPG")
  expect(list).toContain("VCB")
  await tool("watchlist_local_remove").execute({ name: "core", symbols: ["vCb"] }, ctx())
  const after = (await tool("watchlist_local_list").execute({}, ctx())) as string
  expect(after).not.toContain("VCB")
  expect(after).toContain("HPG")
  await tool("watchlist_local_delete").execute({ name: "core" }, ctx())
  expect(((await tool("watchlist_local_list").execute({}, ctx())) as string)).toContain("Chưa có")
})
