import { afterAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { agentRoots, loadAgents } from "../src/core/agents/loader"
import { toolFilter, toolSummary } from "../src/core/agents/resolve"
import { parseAgent } from "../src/core/agents/schema"
import { childRegistry, SubagentManager } from "../src/core/subagents/manager"
import { ToolRegistry } from "../src/core/tools/registry"
import { spawnSubagentTool } from "../src/core/tools/subagent/spawn"
import type { ToolDef } from "../src/core/tools/types"

const tmp = await mkdtemp(path.join(os.tmpdir(), "ot-agents-"))
afterAll(() => rm(tmp, { recursive: true, force: true }))

const tool = (name: string, readOnly: boolean): ToolDef => ({ name, description: name, input: z.object({}), readOnly, execute: async () => name })
const agentFile = (name: string, extra = "", body = "Chỉ dẫn.") => `---\nname: ${name}\ndescription: Mô tả ${name}\n${extra}---\n${body}\n`

test("agent files: frontmatter is validated with readable errors", () => {
  const { meta, body } = parseAgent(agentFile("tra-cuu", 'tools: ["@chi-doc"]\nmaxSteps: 6\n'))
  expect(meta).toEqual({ name: "tra-cuu", description: "Mô tả tra-cuu", tools: ["@chi-doc"], maxSteps: 6 })
  expect(body).toBe("Chỉ dẫn.")
  expect(() => parseAgent("không có frontmatter")).toThrow("thiếu frontmatter")
  expect(() => parseAgent(agentFile("Tên Hoa"))).toThrow('trường "name"')
  expect(() => parseAgent("---\nname: x\n---\n")).toThrow('trường "description"')
  expect(() => parseAgent(agentFile("x", "maxSteps: 0\n"))).toThrow('trường "maxSteps"')
  expect(() => parseAgent(agentFile("x", "provider: groq\n"))).toThrow("có provider thì phải ghi cả model")
})

test("agent roots: project beats user beats bundled; broken files are reported, not thrown", async () => {
  const project = path.join(tmp, "p")
  const user = path.join(tmp, "u")
  const bundled = path.join(tmp, "b")
  for (const dir of [project, user, bundled]) await mkdir(dir, { recursive: true })
  await writeFile(path.join(bundled, "nghien-cuu.md"), agentFile("nghien-cuu", "", "BẢN-CÓ-SẴN"))
  await writeFile(path.join(bundled, "tra-cuu.md"), agentFile("tra-cuu"))
  await writeFile(path.join(project, "nghien-cuu.md"), agentFile("nghien-cuu", "", "BẢN-DỰ-ÁN"))
  await writeFile(path.join(user, "rieng.md"), agentFile("rieng"))
  await writeFile(path.join(user, "sai-ten.md"), agentFile("ten-khac"))
  await writeFile(path.join(user, "ghi-chu.txt"), "không phải agent")
  const { agents, problems } = await loadAgents([
    { dir: project, source: "project" },
    { dir: user, source: "user" },
    { dir: bundled, source: "bundled" },
    { dir: path.join(tmp, "khong-co"), source: "user" },
  ])
  expect(agents.map((a) => [a.name, a.source, a.overrides])).toEqual([
    ["nghien-cuu", "project", "bundled"],
    ["rieng", "user", undefined],
    ["tra-cuu", "bundled", undefined],
  ])
  expect(agents[0]!.body).toBe("BẢN-DỰ-ÁN")
  expect(problems).toHaveLength(1)
  expect(problems[0]!.error).toContain('phải trùng tên file "sai-ten.md"')
})

test("the bundled agent types load cleanly", async () => {
  const roots = agentRoots(tmp).filter((r) => r.source === "bundled")
  const { agents, problems } = await loadAgents(roots)
  expect(problems).toEqual([])
  expect(agents.map((a) => a.name)).toEqual(["nghien-cuu", "phan-bien", "tin-tuc", "tra-cuu"])
})

test("tool filter: @chi-doc keeps read-only tools, patterns narrow, disallowedTools subtracts; excluded tools never come back", () => {
  const parent = new ToolRegistry()
  for (const def of [
    tool("spawn_subagent", true),
    tool("ask_user", true),
    tool("current_time", true),
    tool("web_search", true),
    tool("watchlist_local_add", false),
    tool("mcp__opentrading__news_symbol", true),
    tool("mcp__opentrading__place_order", false),
  ])
    parent.register(def)
  const origin = { id: "ag-1", type: "x", description: "x" }
  const names = (def: { tools?: string[]; disallowedTools?: string[] }) =>
    childRegistry(parent, origin, toolFilter(def))
      .list()
      .map((t) => t.name)
  expect(names({})).toEqual(["current_time", "mcp__opentrading__news_symbol", "mcp__opentrading__place_order", "watchlist_local_add", "web_search"])
  expect(names({ tools: ["@chi-doc"] })).toEqual(["current_time", "mcp__opentrading__news_symbol", "web_search"])
  expect(names({ tools: ["*news*", "web_search"] })).toEqual(["mcp__opentrading__news_symbol", "web_search"])
  expect(names({ tools: ["opentrading/*", "@chi-doc"] })).toEqual(["mcp__opentrading__news_symbol"])
  expect(names({ disallowedTools: ["opentrading/*", "watchlist_*"] })).toEqual(["current_time", "web_search"])
  expect(() => names({ tools: ["spawn_subagent", "ask_user"] })).toThrow("không có tool nào")

  expect(toolSummary({})).toBe("tất cả")
  expect(toolSummary({ tools: ["@chi-doc"] })).toBe("chỉ đọc")
  expect(toolSummary({ tools: ["*news*", "@chi-doc"], disallowedTools: ["x"] })).toBe("*news* (chỉ đọc), trừ x")
})

test("spawn_subagent lists the types in its description and rejects an unknown type before any model call", async () => {
  const parent = new ToolRegistry()
  parent.register(tool("current_time", true))
  const { agents } = await loadAgents(agentRoots(tmp).filter((r) => r.source === "bundled"))
  const spawn = spawnSubagentTool(new SubagentManager({ parent }), agents)
  expect(spawn.description).toContain("Các loại subagent (tham số subagent_type, mặc định nghien-cuu):")
  expect(spawn.description).toMatch(/- tra-cuu: Tra cứu nhanh .* \(Tool: chỉ đọc\)/)
  expect(spawn.description).toMatch(/- tin-tuc: .*\(Tool: web_search, web_fetch, \*news\*, \*sentiment\*, current_time\)/)
  expect(spawn.summarize!({ description: "Giá FPT", prompt: "x", subagent_type: "tra-cuu" })).toBe("tra-cuu(Giá FPT)")
  await expect(
    spawn.execute({ description: "x", prompt: "x", subagent_type: "khong-co" }, { signal: new AbortController().signal, callId: "c" }),
  ).rejects.toThrow('Không có loại subagent "khong-co". Các loại hiện có: nghien-cuu, phan-bien, tin-tuc, tra-cuu.')
})
