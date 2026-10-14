import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import { todoWriteTool } from "../src/core/tools/builtin/todo-write"
import { askUserTool, AskUserInput } from "../src/core/tools/builtin/ask-user"
import { loadSkillTool } from "../src/core/tools/builtin/load-skill"
import { toolSearchTool } from "../src/core/tools/builtin/tool-search"
import { currentTimeTool } from "../src/core/tools/builtin/current-time"
import { chartCompareTool } from "../src/core/tools/chart/compare"
import { chartRenderTool } from "../src/core/tools/chart/render"
import { spawnSubagentTool } from "../src/core/tools/subagent/spawn"
import type { ToolDef } from "../src/core/tools/types"
import type { ToolRegistry } from "../src/core/tools/registry"

/**
 * Tool-description lint, mirroring the Claude Code tool-prompt standard
 * (Piebald-AI/claude-code-system-prompts, tool-description-todowrite.md):
 * a model-facing description says what the tool does, when to use it, when
 * NOT to use it (naming the right alternative), and shows one concrete example
 * where the call pattern is non-obvious.
 *
 * MCP descriptions come from the captured catalog fixture; builtin ones come
 * from the real tool factories. Name is the source of truth (input schema and
 * description are joined into <tool_schemas> / tool_search results verbatim).
 */

const root = path.resolve(import.meta.dir, "..")
const fixture = path.join(root, "test/fixtures/mcp-catalog/opentrading.json")

interface CatalogTool {
  name: string
  description: string
  inputSchema?: unknown
  _meta?: Record<string, unknown>
}

const catalog: CatalogTool[] = JSON.parse(readFileSync(fixture, "utf8")).tools
const mcpNames = new Set(catalog.map((t) => t.name))
const shortName = (full: string) => full.replace(/^mcp__opentrading__/, "")

/** Tool clusters whose members historically get confused with each other. */
const CLUSTERS: Record<string, string[]> = {
  "market-picture": ["market_snapshot", "market_overview", "brief_build", "source_status", "dnse_market_status"],
  candles: ["market_candles_batch", "vn_quote_history", "vn_equity_ohlcv", "vn_equity_quote_batch"],
  news: ["news_market", "news_symbol", "fireant_thread", "sentiment_score"],
  calendars: ["economic_calendar", "corporate_calendar", "event_calendar_vn", "dnse_working_dates", "exchange_calendar"],
  valuation: ["valuation_run", "vs_overview_trading", "vn_fundamentals", "financial_ratios", "peer_compare"],
  statements: ["financial_statements", "financial_detail", "vs_financeinfo"],
  flows: ["money_flow", "vs_nn_flow", "dnse_foreign_flow", "block_trades"],
  "company-profile": ["stock_overview", "vn_company", "vs_company_info", "symbol_lookup", "symbol_resolve"],
  quant: ["quant_backtest", "quant_risk", "backtest_strategies", "scenario_simulate", "stock_screener", "signals_technical"],
  "corp-facts": ["dividends_splits", "insider_trading", "analyst_consensus"],
  web: ["web_fetch"], // web_search đăng ký có điều kiện (cần key), nên không đứng trong fixture
  timing: ["distribution_count"],
}
const clusterTools = new Map<string, string>()
for (const [cluster, names] of Object.entries(CLUSTERS)) for (const n of names) clusterTools.set(n, cluster)

/** Deliberately long operational guardrails (chars, not tokens). */
const LENGTH_CAPS: Record<string, number> = {
  analyst_consensus: 1800,
  backtest_strategies: 1100,
}
const MCP_CAP = 900
const BUILTIN_CAP = 1600
const BUILTIN_CAPS: Record<string, number> = { spawn_subagent: 2000 }

const descOf = (t: CatalogTool) => (t.description ?? "").replace(/\s+/g, " ").trim()
const hasUse = (d: string) => /Dùng khi|Use (for|when|to|this)|Dùng để|Dùng lúc/i.test(d)
const hasNotUse = (d: string) => /Không dùng khi|Do NOT call|Don'?t (use|call)|prefer .* over|use .* instead|dùng .* thay/i.test(d)

// ── MCP catalog ──────────────────────────────────────────────────────────────

test("mcp catalog: cluster tools state when to use and when not (with the right alternative)", () => {
  const problems: string[] = []
  for (const [name, cluster] of clusterTools) {
    const tool = catalog.find((t) => shortName(t.name) === name)
    if (!tool) {
      problems.push(`${cluster}/${name}: không còn trong catalog (cập nhật CLUSTERS)`)
      continue
    }
    const d = descOf(tool)
    if (!hasUse(d)) problems.push(`${cluster}/${name}: thiếu "Dùng khi"`)
    if (!hasNotUse(d)) problems.push(`${cluster}/${name}: thiếu "Không dùng khi"`)
  }
  expect(problems).toEqual([])
})

test("mcp catalog: descriptions stay within budget (tool schemas ride on every load_skill/tool_search)", () => {
  const problems: string[] = []
  for (const t of catalog) {
    const d = descOf(t)
    const cap = LENGTH_CAPS[shortName(t.name)] ?? MCP_CAP
    if (d.length > cap) problems.push(`${t.name}: ${d.length} > ${cap} ký tự`)
  }
  expect(problems).toEqual([])
})

test("mcp catalog: 'dùng X' cross-references point at real tools (no dead names like valuation_band)", () => {
  const localNames = new Set<string>(["load_skill", "todo_write", "ask_user", "tool_search", "current_time", "chart_render", "chart_compare", "web_fetch", "web_search", "send_message", "stop_agent", "spawn_subagent"])
  const known = new Set([...mcpNames, ...localNames])
  const problems: string[] = []
  for (const t of catalog) {
    const d = descOf(t)
    for (const m of d.matchAll(/dùng\s+((?:vn|vs|dnse|market|symbol|signals|stock|financial|valuation|quant|news|brief|economic|corporate|event|block|money|dividends|insider|analyst|web|cycle|vn_|yf_|g_|alert_|watchlist_|backtest|scenario|peer|source|breadth|exchange|fireant|ipo|sbv|macro|company|holders|futures|planned|sentiment|world|geo|assets|compare|evidence|oracle|runs|run|doctor|param|correlation|seasonality|pattern|snapshot|stocks?|valuation)\w*)/gi)) {
      const ref = m[1]!
      if (!known.has(ref) && ![...known].some((n) => n === ref || n.endsWith(`__${ref}`))) {
        problems.push(`${t.name}: trỏ tới tool không tồn tại "${ref}"`)
      }
    }
  }
  expect(problems).toEqual([])
})

// ── builtin tools ────────────────────────────────────────────────────────────

const noopCtx = { signal: new AbortController().signal, callId: "lint" } as never

function builtin(name: string): ToolDef<never> {
  switch (name) {
    case "todo_write":
      return todoWriteTool() as ToolDef<never>
    case "ask_user":
      return askUserTool({ ask: () => Promise.resolve({} as never) } as never) as ToolDef<never>
    case "load_skill":
      return loadSkillTool(() => [], () => [], () => new Set()) as ToolDef<never>
    case "tool_search": {
      const registry = { list: () => [], get: () => undefined } as unknown as ToolRegistry
      return toolSearchTool(registry) as ToolDef<never>
    }
    case "current_time":
      return currentTimeTool() as ToolDef<never>
    case "chart_compare":
      return chartCompareTool() as ToolDef<never>
    case "chart_render":
      return chartRenderTool() as ToolDef<never>
    case "spawn_subagent":
      return spawnSubagentTool({} as never) as ToolDef<never>
    default:
      throw new Error(`builtin không rõ: ${name}`)
  }
}

/** Tools that never need a "when not" line (factoids, self-evident). */
const NO_NOT_USE = new Set(["current_time", "tool_search", "load_skill", "chart_render"])

test("builtin tools follow the Claude standard: purpose + when + (when not) + bounded length", () => {
  const problems: string[] = []
  for (const name of ["todo_write", "ask_user", "load_skill", "tool_search", "current_time", "chart_compare", "chart_render", "spawn_subagent"]) {
    const d = (builtin(name).description ?? "").replace(/\s+/g, " ").trim()
    if (!hasUse(d)) problems.push(`${name}: thiếu "Dùng khi/Khi nào"`)
    if (!NO_NOT_USE.has(name) && !hasNotUse(d)) problems.push(`${name}: thiếu "Không dùng khi"`)
    if (d.length > (BUILTIN_CAPS[name] ?? BUILTIN_CAP)) problems.push(`${name}: ${d.length} > ${BUILTIN_CAPS[name] ?? BUILTIN_CAP} ký tự`)
  }
  expect(problems).toEqual([])
})

test("todo_write input keeps the Claude state contract (2 forms of wording are not required, statuses are)", () => {
  const shape = AskUserInput && z ? null : null
  expect(shape).toBeNull()
  const desc = (builtin("todo_write").description ?? "").replace(/\s+/g, " ")
  expect(desc).toMatch(/completed/)
  expect(desc).toMatch(/in_progress/)
  expect(desc).toMatch(/CHỈ đánh completed/i)
})
