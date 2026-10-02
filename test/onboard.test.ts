import { afterEach, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { COMPANY_MCP_TEMPLATE, TOKEN_SECRET_KEY, acceptCompanyServer, envSecrets, needsOnboarding, saveMcpToken } from "../src/core/mcp/onboard"

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

const home = async () => {
  const h = await mkdtemp(path.join(os.tmpdir(), "ot-ob-"))
  dirs.push(h)
  return h
}

test("needs onboarding when no config file has any server", async () => {
  const empty = await home()
  const cwd = await mkdtemp(path.join(os.tmpdir(), "ot-obc-"))
  dirs.push(cwd)
  expect(await needsOnboarding(empty, cwd)).toBe(true)
  await writeFile(path.join(empty, "mcp.json"), JSON.stringify({ mcpServers: {} }))
  expect(await needsOnboarding(empty, cwd)).toBe(true) // file without servers still counts
  await writeFile(path.join(empty, "mcp.json"), JSON.stringify({ mcpServers: { x: { command: "x" } } }))
  expect(await needsOnboarding(empty, cwd)).toBe(false)
})

test("accept writes the template; token is stored as an _env_ secret with 600 perms", async () => {
  const h = await home()
  await acceptCompanyServer(h)
  const config = JSON.parse(await readFile(path.join(h, "mcp.json"), "utf8"))
  expect(config).toEqual(COMPANY_MCP_TEMPLATE)
  await saveMcpToken("  tok-abc-123  ", h)
  const auth = JSON.parse(await readFile(path.join(h, "auth.json"), "utf8"))
  expect(auth[TOKEN_SECRET_KEY]).toEqual({ type: "api", key: "tok-abc-123" })
  const stat = await (await import("node:fs/promises")).stat(path.join(h, "auth.json"))
  expect(stat.mode & 0o777).toBe(0o600)
})

test("env secrets feed ${NAME} expansion", async () => {
  const h = await home()
  await saveMcpToken("secret-token", h)
  const secrets = await envSecrets(h)
  expect(secrets).toEqual({ OPENTRADING_MCP_TOKEN: "secret-token" })
  const { expandEnv } = await import("../src/core/mcp/config")
  const expanded = expandEnv("Bearer ${OPENTRADING_MCP_TOKEN}", { ...process.env, ...secrets })
  expect(expanded.value).toBe("Bearer secret-token")
  expect(expanded.missing).toEqual([])
})

test("rotation: saving a new token replaces the old one", async () => {
  const h = await home()
  await saveMcpToken("old", h)
  await saveMcpToken("new", h)
  expect(await envSecrets(h)).toEqual({ OPENTRADING_MCP_TOKEN: "new" })
})

test("token saved under OPENTRADING_HOME lives outside the repo", async () => {
  const h = await home()
  const saved = path.join(h, "auth.json")
  await saveMcpToken("t", h)
  expect((await readFile(saved, "utf8")).length).toBeGreaterThan(0)
})
