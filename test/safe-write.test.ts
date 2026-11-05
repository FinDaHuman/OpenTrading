import { afterAll, beforeEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// A read that fails must never turn into a write of only the change (MyToDoList "Nợ kỹ thuật"):
// config.json losing provider/model, auth.json losing every other key.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-safe-write-"))
const previous = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home
const { loadConfig, saveConfig } = await import("../src/core/config")
const { getKey, setKey } = await import("../src/core/auth")
const { authFile, configFile } = await import("../src/core/paths")
const { readJsonForUpdate } = await import("../src/core/store")
const { setSecretEnv, secretEnv, mcpAuthFile } = await import("../src/core/mcp/secrets")
const { FolderTrust } = await import("../src/core/folder-trust")
const { TrustStore } = await import("../src/core/mcp/trust")
const { modelPrefsFile, saveModelPrefs } = await import("../src/core/model-prefs")
const { configRuleStore } = await import("../src/core/permission")

afterAll(async () => {
  if (previous === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = previous
  await rm(home, { recursive: true, force: true })
})
beforeEach(async () => {
  for (const name of await readdir(home)) await rm(path.join(home, name), { recursive: true, force: true })
})

const CORRUPT = '{"provider": "google", "model": "gemini-3.1-flash-lite"'

/** `write` must reject and leave the corrupt file byte for byte, with no temp file beside it. */
async function refusesCorrupt(file: string, write: () => Promise<unknown>) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, CORRUPT, "utf8")
  await expect(write()).rejects.toThrow(/Không đọc được .*Sửa hoặc xoá file này/)
  expect(await readFile(file, "utf8")).toBe(CORRUPT)
  expect((await readdir(path.dirname(file))).filter((n) => n.endsWith(".tmp") || n.endsWith(".lock"))).toEqual([])
}

test("readJsonForUpdate: missing → fallback; BOM ok; corrupt, an array or a folder → error naming the file", async () => {
  const file = path.join(home, "x.json")
  expect(await readJsonForUpdate(file, { a: 1 })).toEqual({ a: 1 })
  await writeFile(file, '\ufeff{"b":2}', "utf8")
  expect(await readJsonForUpdate(file, {})).toEqual({ b: 2 })
  await writeFile(file, "[1]", "utf8")
  await expect(readJsonForUpdate(file, {})).rejects.toThrow("không phải object JSON")
  const dir = path.join(home, "dir.json")
  await mkdir(dir)
  await expect(readJsonForUpdate(dir, {})).rejects.toThrow(dir)
})

test("saveConfig refuses a config.json it cannot read instead of keeping only the patch", async () => {
  await refusesCorrupt(configFile(), () => saveConfig({ effort: "high" }))
  // The next save after the file is fixed works and keeps what is there.
  await writeFile(configFile(), JSON.stringify({ provider: "google", model: "m" }), "utf8")
  await saveConfig({ effort: "high" })
  expect(await loadConfig()).toEqual({ provider: "google", model: "m", effort: "high" })
})

test("setKey refuses an unreadable auth.json (other keys kept); parallel saves of two providers both land", async () => {
  await refusesCorrupt(authFile(), () => setKey("groq", "gsk_new"))
  await rm(authFile())
  await Promise.all([setKey("groq", "gsk_1"), setKey("google", "AIza_2"), setKey("openrouter", "sk-or-3")])
  expect([await getKey("groq"), await getKey("google"), await getKey("openrouter")]).toEqual(["gsk_1", "AIza_2", "sk-or-3"])
})

test("MCP secrets, MCP trust, folder trust and model prefs never overwrite a file they could not read", async () => {
  await refusesCorrupt(mcpAuthFile(home), () => setSecretEnv(home, "TOKEN", "x"))
  await rm(mcpAuthFile(home))
  await Promise.all([setSecretEnv(home, "A", "1"), setSecretEnv(home, "B", "2")])
  expect(await secretEnv(home)).toEqual({ A: "1", B: "2" })

  await refusesCorrupt(path.join(home, "mcp-trust.json"), () => new TrustStore(path.join(home, "mcp-trust.json")).trust("k"))
  await refusesCorrupt(path.join(home, "trusted-folders.json"), () => new FolderTrust(path.join(home, "trusted-folders.json")).trust(home))
  await refusesCorrupt(modelPrefsFile(), () => saveModelPrefs({ favorite: [], recent: [{ provider: "groq", model: "m" }] }))
})

test('"always allow" racing a rule removal: both changes land', async () => {
  await saveConfig({ permissions: { allow: [{ tool: "read_file", scope: "a" }, { tool: "shell", scope: "git" }] } })
  await Promise.all([
    configRuleStore.add!({ tool: "write_file", scope: "b" }),
    saveConfig((c) => ({ permissions: { ...c.permissions, allow: (c.permissions?.allow ?? []).filter((r) => r.tool !== "shell") } })),
    configRuleStore.add!({ tool: "read_file", scope: "a" }), // already there: not added twice
  ])
  expect((await loadConfig()).permissions?.allow).toEqual([
    { tool: "read_file", scope: "a" },
    { tool: "write_file", scope: "b" },
  ])
})
