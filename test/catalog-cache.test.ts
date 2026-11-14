import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { until } from "./helpers/tui"

const { loadCatalog } = await import("../src/core/catalog")

const original = process.env.OPENTRADING_HOME
const realFetch = globalThis.fetch
const dirs: string[] = []

afterEach(async () => {
  if (original === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = original
  globalThis.fetch = realFetch
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

const provider = (id: string) => ({ [id]: { id, name: id, env: [], models: {} } })

async function homeWithCache(ageMs: number) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ot-catalog-"))
  dirs.push(dir)
  process.env.OPENTRADING_HOME = dir
  const file = path.join(dir, "cache", "models.json")
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(provider("cached")))
  const at = new Date(Date.now() - ageMs)
  await utimes(file, at, at)
  return file
}

test("a stale cache is used at once, without waiting for the download; later calls get the fresh catalog", async () => {
  const file = await homeWithCache(2 * 60 * 60 * 1000)
  let answer: (r: Response) => void = () => {}
  let fetches = 0
  globalThis.fetch = (async () => {
    fetches++
    return new Promise<Response>((r) => (answer = r))
  }) as unknown as typeof fetch

  // The network has not answered yet: the old catalog comes back anyway.
  expect(Object.keys(await loadCatalog())).toEqual(["cached"])
  expect(fetches).toBe(1)

  answer(Response.json(provider("fresh")))
  await until(async () => Object.keys(await loadCatalog())[0] === "fresh")
  expect(JSON.parse(await Bun.file(file).text())).toEqual(provider("fresh"))
  expect(fetches).toBe(1)
})

test("a fresh cache is not downloaded again; a stale one that cannot be refreshed stays in use", async () => {
  await homeWithCache(60 * 1000)
  let fetches = 0
  globalThis.fetch = (async () => {
    fetches++
    throw new Error("offline")
  }) as unknown as typeof fetch
  expect(Object.keys(await loadCatalog())).toEqual(["cached"])
  expect(fetches).toBe(0)

  await homeWithCache(2 * 60 * 60 * 1000)
  expect(Object.keys(await loadCatalog())).toEqual(["cached"])
  await until(async () => fetches === 1)
  await new Promise((r) => setTimeout(r, 20))
  expect(Object.keys(await loadCatalog())).toEqual(["cached"])
})
