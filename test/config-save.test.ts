import { afterAll, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const home = await mkdtemp(path.join(os.tmpdir(), "ot-config-"))
process.env.OPENTRADING_HOME = home
const { loadConfig, saveConfig } = await import("../src/core/config")
const { configFile } = await import("../src/core/paths")
afterAll(() => rm(home, { recursive: true, force: true }))

test("concurrent saves of different keys all land (BUG-OT-20261025-003)", async () => {
  for (let round = 0; round < 5; round++) {
    await saveConfig({ effort: undefined, maxSteps: undefined, toolSearch: undefined, update: undefined })
    const results = await Promise.all([saveConfig({ effort: "high" }), saveConfig({ maxSteps: 42 }), saveConfig({ toolSearch: "off" }), saveConfig({ update: { check: false } })])
    expect(results).toHaveLength(4)
    const config = await loadConfig()
    expect(config).toMatchObject({ effort: "high", maxSteps: 42, toolSearch: "off", update: { check: false } })
  }
  expect(existsSync(`${configFile()}.lock`)).toBe(false)
})

test("a function patch sees the config as it is inside the lock: nested changes never overwrite each other", async () => {
  await saveConfig({ desk: undefined })
  await Promise.all([
    saveConfig((c) => ({ desk: { ...c.desk, approved: [...(c.desk?.approved ?? []), "sang-loc"] } })),
    saveConfig((c) => ({ desk: { ...c.desk, effort: "high" } })),
    saveConfig((c) => ({ desk: { ...c.desk, approved: [...(c.desk?.approved ?? []), "nganh"] } })),
  ])
  expect((await loadConfig()).desk).toEqual({ approved: ["sang-loc", "nganh"], effort: "high" })
})

test("a failed save does not block the next one", async () => {
  await expect(
    saveConfig(() => {
      throw new Error("hỏng")
    }),
  ).rejects.toThrow("hỏng")
  await saveConfig({ maxSteps: 7 })
  expect((await loadConfig()).maxSteps).toBe(7)
})
