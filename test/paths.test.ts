import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// Regression: bun test runs every file in one process. Paths used to be frozen at first
// import, so a later test file's OPENTRADING_HOME was ignored and it read another file's
// (already deleted) state and catalog.
const { authFile, configFile, dataDir } = await import("../src/core/paths")
const { loadCatalog } = await import("../src/core/catalog")
const { loadConfig, saveConfig } = await import("../src/core/config")

const original = process.env.OPENTRADING_HOME
const realFetch = globalThis.fetch
const dirs: string[] = []

afterEach(async () => {
  if (original === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = original
  globalThis.fetch = realFetch
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function home() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ot-paths-"))
  dirs.push(dir)
  process.env.OPENTRADING_HOME = dir
  return dir
}

test("state paths follow OPENTRADING_HOME changes after import", async () => {
  const a = await home()
  expect(dataDir()).toBe(a)
  expect(authFile()).toBe(path.join(a, "auth.json"))
  await saveConfig({ model: "a-model" })

  const b = await home()
  expect(configFile()).toBe(path.join(b, "config.json"))
  expect(await loadConfig()).toEqual({})
})

test("each state dir gets its own catalog", async () => {
  const served: string[] = []
  const serve = (id: string) =>
    (globalThis.fetch = (async () => {
      served.push(id)
      return Response.json({ [id]: { id, name: id, env: [], models: {} } })
    }) as unknown as typeof fetch)

  await home()
  serve("first")
  expect(Object.keys(await loadCatalog())).toEqual(["first"])
  expect(Object.keys(await loadCatalog())).toEqual(["first"]) // memoised: no second fetch
  await home()
  serve("second")
  expect(Object.keys(await loadCatalog())).toEqual(["second"])
  expect(served).toEqual(["first", "second"])
})
