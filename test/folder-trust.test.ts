import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { agentRoots } from "../src/core/agents/loader"
import { FolderTrust, projectExtras } from "../src/core/folder-trust"
import { skillRoots } from "../src/core/skills/loader"

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})
async function temp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ot-trust-"))
  dirs.push(dir)
  return dir
}

test("projectExtras counts the folder's skills and agents, and nothing else", async () => {
  const folder = await temp()
  const data = await temp()
  expect(await projectExtras(folder, data)).toBeUndefined() // no .opentrading
  await mkdir(path.join(folder, ".opentrading", "skills", "no-skill-md"), { recursive: true })
  await writeFile(path.join(folder, ".opentrading", "notes.txt"), "x")
  expect(await projectExtras(folder, data)).toBeUndefined() // nothing that would load

  await mkdir(path.join(folder, ".opentrading", "skills", "rieng"), { recursive: true })
  await writeFile(path.join(folder, ".opentrading", "skills", "rieng", "SKILL.md"), "---\nname: rieng\ndescription: x\n---\n")
  await mkdir(path.join(folder, ".opentrading", "agents"), { recursive: true })
  await writeFile(path.join(folder, ".opentrading", "agents", "a.md"), "x")
  await writeFile(path.join(folder, ".opentrading", "agents", "b.txt"), "x")
  expect(await projectExtras(folder, data)).toEqual({ dir: path.join(folder, ".opentrading"), skills: 1, agents: 1 })

  // Opened in the home folder: its .opentrading is OpenTrading's own data folder, never asked about.
  expect(await projectExtras(folder, path.join(folder, ".opentrading"))).toBeUndefined()
})

test("trust is saved per folder, except for folders trusted for this run only", async () => {
  const data = await temp()
  const file = path.join(data, "folder-trust.json")
  const folder = await temp()
  const broad = await temp()

  const trust = new FolderTrust(file)
  expect(await trust.isTrusted(folder)).toBe(false)
  await trust.trust(folder)
  expect(await new FolderTrust(file).isTrusted(folder)).toBe(true)
  if (process.platform === "win32") expect(await new FolderTrust(file).isTrusted(folder.toUpperCase())).toBe(true)

  await trust.trust(broad, false)
  expect(await trust.isTrusted(broad)).toBe(true)
  expect(await new FolderTrust(file).isTrusted(broad)).toBe(false)
  expect(Object.keys(JSON.parse(await readFile(file, "utf8")))).toHaveLength(1)
})

test("loaders leave the folder's own roots out when it is not trusted", () => {
  expect(skillRoots("/w").map((r) => r.source)).toEqual(["project", "user", "bundled"])
  expect(skillRoots("/w", { project: false }).map((r) => r.source)).toEqual(["user", "bundled"])
  expect(agentRoots("/w", { project: false }).map((r) => r.source)).toEqual(["user", "bundled"])
})
