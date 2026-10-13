import { mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { mcpToolFields } from "../../src/core/mcp/manager"
import { toolName } from "../../src/core/mcp/naming"
import { assemble } from "../../src/core/prompt/assemble"
import { initRuntime } from "../../src/core/runtime"
import { loadSkills, skillRoots } from "../../src/core/skills/loader"
import type { ToolRegistry } from "../../src/core/tools/registry"
import { LOADED_PREFIX } from "../../src/core/tools/search"
import { RwLock, runTool } from "../../src/core/tools/wrap"

/**
 * Offline routing eval (test/routing-eval.test.ts; `bun scripts/dev/routing-eval.ts` prints
 * the per-case report). No model and no network: it measures the two deterministic layers
 * that decide whether the model even sees the right tool or skill.
 *
 * - tools: the question, as a keyword query, through the real tool_search over the captured
 *   MCP catalog (test/fixtures/mcp-catalog) plus the local deferrable tools.
 * - skills: the `goi_y_skill` reminder that prompt assembly attaches to the user message.
 *
 * Models write their own tool_search queries, so tool numbers are a proxy; they still move
 * with hints, descriptions and synonyms the same way live searches do.
 */

export interface RoutingCase {
  id: number
  split: "dev" | "heldout"
  q: string
  /** Any of these skills counts as a hit; [] = no skill should be suggested; absent = not scored. */
  skills?: string[]
  /** Bare MCP tool names; any one loaded counts as a hit. */
  tools?: string[]
  note?: string
}

export interface CaseResult {
  case: RoutingCase
  loaded: string[]
  toolHit?: boolean
  suggested: string[]
  skillHit?: boolean
  /** Suggested skills that are not among the expected ones (scored cases only). */
  wrongSkills: string[]
}

export interface Summary {
  toolCases: number
  toolHits: number
  skillPositives: number
  skillHits: number
  /** Cases labelled "no skill" that still got a suggestion. */
  skillNegatives: number
  negativesSuggested: number
  /** Suggestions on scored cases, and how many of them were right. */
  suggestions: number
  rightSuggestions: number
}

const SERVER = "opentrading"
const bare = (name: string) => name.replace(/^mcp__.+?__/, "")

export async function loadCases(root: string): Promise<RoutingCase[]> {
  return (JSON.parse(await readFile(path.join(root, "test/fixtures/eval-routing.json"), "utf8")) as { cases: RoutingCase[] }).cases
}

/** Local tools as initRuntime registers them, plus the captured MCP catalog registered the way McpManager does. */
export async function catalogRegistry(root: string): Promise<ToolRegistry> {
  const catalog = JSON.parse(await readFile(path.join(root, "test/fixtures/mcp-catalog/opentrading.json"), "utf8")) as {
    tools: { name: string; description?: string; inputSchema?: JSONSchema7; _meta?: Record<string, unknown> }[]
  }
  const home = await mkdtemp(path.join(os.tmpdir(), "ot-routing-"))
  const { registry } = initRuntime({ home, cwd: home, skills: () => [] })
  const taken = new Set(registry.list().map((t) => t.name))
  for (const tool of catalog.tools) {
    const name = toolName(SERVER, tool.name, taken)
    taken.add(name)
    registry.register({
      name,
      source: `mcp:${SERVER}`,
      ...mcpToolFields(SERVER, tool),
      input: tool.inputSchema ?? { type: "object", properties: {} },
      readOnly: true,
      execute: async () => "",
    })
  }
  return registry
}

/** Tools a keyword tool_search for `query` would load (the first line of its result). */
export async function searchLoads(registry: ToolRegistry, query: string): Promise<string[]> {
  const ctx = { signal: new AbortController().signal, callId: "eval" }
  const out = (await runTool(registry.get("tool_search")!, { query }, ctx, new RwLock())).output
  const first = out.split("\n", 1)[0] ?? ""
  return first.startsWith(LOADED_PREFIX) ? first.slice(LOADED_PREFIX.length).split(", ") : []
}

/** Skills named in the goi_y_skill reminder for `input`. */
export function suggestedSkills(input: string, skills: Awaited<ReturnType<typeof loadSkills>>["skills"], declared: string[]): string[] {
  const assembled = assemble({
    tier: "A",
    tools: ["load_skill", "tool_search"],
    declaredTools: declared,
    skills,
    sticky: [],
    input,
    now: new Date("2026-10-13T03:00:00Z"),
  })
  const hint = assembled.reminders.find((r) => r.startsWith("<goi_y_skill>"))
  const match = hint?.match(/skill: ([^.]+)\./)
  return match ? match[1]!.split(", ").map((s) => s.trim()) : []
}

export async function evalRouting(root: string) {
  const cases = await loadCases(root)
  const registry = await catalogRegistry(root)
  const { skills } = await loadSkills(skillRoots(root).filter((r) => r.source === "bundled"))
  const declared = registry.list().map((t) => t.name)
  const results: CaseResult[] = []
  for (const c of cases) {
    const loaded = (await searchLoads(registry, c.q)).map(bare)
    const suggested = suggestedSkills(c.q, skills, declared)
    const scored = c.skills !== undefined
    results.push({
      case: c,
      loaded,
      toolHit: c.tools ? c.tools.some((t) => loaded.includes(t)) : undefined,
      suggested,
      skillHit: c.skills && c.skills.length > 0 ? c.skills.some((s) => suggested.includes(s)) : undefined,
      wrongSkills: scored ? suggested.filter((s) => !c.skills!.includes(s)) : [],
    })
  }
  return { results, summary: { dev: summarize(results, "dev"), heldout: summarize(results, "heldout"), all: summarize(results) } }
}

export function summarize(results: CaseResult[], split?: RoutingCase["split"]): Summary {
  const rs = results.filter((r) => !split || r.case.split === split)
  const scored = rs.filter((r) => r.case.skills !== undefined)
  return {
    toolCases: rs.filter((r) => r.toolHit !== undefined).length,
    toolHits: rs.filter((r) => r.toolHit).length,
    skillPositives: rs.filter((r) => r.skillHit !== undefined).length,
    skillHits: rs.filter((r) => r.skillHit).length,
    skillNegatives: scored.filter((r) => r.case.skills!.length === 0).length,
    negativesSuggested: scored.filter((r) => r.case.skills!.length === 0 && r.suggested.length > 0).length,
    suggestions: scored.reduce((n, r) => n + r.suggested.length, 0),
    rightSuggestions: scored.reduce((n, r) => n + r.suggested.length - r.wrongSkills.length, 0),
  }
}
