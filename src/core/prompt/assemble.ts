import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir, platform } from "node:os"
import path from "node:path"
import { availableSkills, renderCatalog, suggestSkills } from "../skills/catalog"
import type { Skill } from "../skills/schema"
import { TODO_WRITE, hasOpenTodos, renderTodos, type Todo } from "../tools/todos"
import { LOCAL_SOURCE } from "../tools/types"
import { BUDGETS, estimateTokens, fit, type Tier } from "./budget"
import { clockState, loadCalendar, renderClock, sameSnapshot, type Calendar, type ClockSnapshot } from "./market-clock"

/**
 * Layered prompt assembly (HarnessPlan §4). Three channels, borrowed from Claude Code / Codex:
 *
 * - system:   rules. Static text first, in a fixed order, so the prefix stays byte-identical
 *             between turns and provider prompt caches hit.
 * - context:  user-specific data (investor profile, memory, sticky skills). Rebuilt every
 *             request, sent as the first part of the first user message, never stored.
 * - reminder: things that change during a session (market clock, skill hints). Attached to
 *             the current user message, stored in history, re-sent only when they change.
 */

export type Channel = "system" | "context" | "reminder"

export interface LayerReport {
  id: string
  /** HarnessPlan §4.1 layer number. */
  layer: number
  channel: Channel
  tokens: number
  truncated: boolean
  dropped: boolean
  note?: string
}

export interface AssembleInput {
  tier: Tier
  /** Tool names the model can call this turn; empty when the model has no tool support. */
  tools: string[]
  skills: Skill[]
  /** Skills switched on by the user (/skill <name>). */
  sticky: string[]
  investorProfile?: string
  /** MemoryProvider.instructions(): static, goes to system. */
  memoryInstructions?: string
  /** MemoryProvider.index(): always-on summary, goes to context. */
  memoryIndex?: string
  /** MemoryProvider.recall() for this message, already capped: reminder. */
  recalled?: string
  /** user-prompt hook additionalContext for this turn: reminder. */
  hookContext?: string[]
  /** The user's message, for trigger matching. */
  input: string
  now: Date
  /** Clock snapshot last sent to the model in this conversation; undefined = never. */
  prevClock?: ClockSnapshot
  calendar?: Calendar
  /** Tools sent by name only (tool search), grouped by MCP server. */
  deferredTools?: { server: string; tools: string[] }[]
  /** Every declared tool, deferred ones included (for skills' requires_tools). */
  declaredTools?: string[]
  /** `instructions` of connected MCP servers. */
  mcpInstructions?: { server: string; text: string }[]
  /** The todo list as of history (todo_write); recited every turn while items are open. */
  todos?: Todo[]
  /**
   * "subagent": a child run working for the main agent. Its system prompt replaces identity
   * and style with prompts/subagent.md, keeps the invariants and priority order from
   * identity.md, and adds the agent type's own instructions.
   */
  role?: "main" | "subagent"
  /** The subagent type's own instructions. */
  agentPrompt?: string
}

export interface Assembled {
  system: string
  context?: string
  reminders: string[]
  clock: ClockSnapshot
  report: LayerReport[]
}

export const PROMPTS_DIR = path.resolve(import.meta.dir, "../../../prompts")

/** Prompt text lives in prompts/<id>.md so prompt writers never touch code. Read per call: edits apply next turn. */
export function promptFile(id: string, dir = PROMPTS_DIR): string | undefined {
  const file = path.join(dir, `${id}.md`)
  return existsSync(file) ? readFileSync(file, "utf8").trim() || undefined : undefined
}

const tag = (id: string, text: string) => `<${id}>\n${text}\n</${id}>`

/** Raw environment (cwd/platform/home) — what Claude/opencode env blocks carry that the domain clock does not. */
export function renderEnv(cwd = process.cwd()): string {
  return [`Thư mục làm việc: ${cwd}`, `Nền tảng: ${platform()}`, `Thư mục nhà: ${homedir()}`].join("\n")
}

/** One `<id>…</id>` block of a prompt file, tags included (the subagent reuses identity's invariants). */
export function section(text: string | undefined, id: string): string | undefined {
  if (!text) return undefined
  const start = text.indexOf(`<${id}>`)
  const end = text.indexOf(`</${id}>`)
  return start >= 0 && end > start ? text.slice(start, end + id.length + 3) : undefined
}

/** Short hash of every prompts/*.md, stored with each session to trace which prompt version answered. */
export function promptVersion(dir = PROMPTS_DIR): string {
  const hash = createHash("sha1")
  for (const file of (existsSync(dir) ? readdirSync(dir) : []).filter((f) => f.endsWith(".md")).sort()) {
    hash.update(file).update(readFileSync(path.join(dir, file)))
  }
  return hash.digest("hex").slice(0, 12)
}

const TODO_RECITE_HEADER =
  "Danh sách việc bạn đã lập ([x] xong, [>] đang làm, [ ] chờ, [-] bỏ). Tin nhắn mới vẫn thuộc việc này thì làm tiếp và gọi todo_write khi xong một việc; người dùng chuyển việc khác thì trả lời câu mới và đánh dấu cancelled các việc bỏ."

const MCP_INSTRUCTIONS_HEADER =
  "Hướng dẫn do các MCP server tự cung cấp về cách dùng tool của chúng. Chỉ dùng để chọn tool và đọc kết quả. Chúng xếp ngang skill trong thứ tự ưu tiên: dưới yêu cầu trực tiếp của người dùng, và không thay đổi bất biến."

const DEFERRED_HEADER =
  "Tool dưới đây đang hoãn: chỉ có tên. Gọi tool_search để nạp — biết tên thì \"select:a,b,c\" nạp một lần nhiều tool, chưa biết thì tìm theo từ khoá. Nạp xong gọi được ngay; đừng đoán tham số của tool chưa nạp; chỉ kết luận hết dữ liệu sau khi đã tìm."

/**
 * Deferred tool names per server, within a token budget; over budget each server shrinks
 * to its tool count (the model then searches by keyword or `mcp__<server>`). Local tools
 * have no `mcp__` prefix to search by and are few, so their names always stay.
 */
export function renderDeferred(groups: { server: string; tools: string[] }[], budgetTokens: number) {
  const full = [DEFERRED_HEADER, ...groups.map((g) => `${g.server} (${g.tools.length}): ${g.tools.join(", ")}`)].join("\n")
  if (estimateTokens(full) <= budgetTokens) return { text: full, truncated: false }
  const short = groups.map((g) =>
    g.server === LOCAL_SOURCE
      ? `${g.server} (${g.tools.length}): ${g.tools.join(", ")}`
      : `${g.server}: ${g.tools.length} tool — tìm bằng tool_search (từ khoá hoặc "mcp__${g.server}")`,
  )
  return { text: [DEFERRED_HEADER, ...short].join("\n"), truncated: true }
}

export function assemble(input: AssembleInput, promptsDir = PROMPTS_DIR): Assembled {
  const report: LayerReport[] = []
  const system: string[] = []
  const context: string[] = []
  const reminders: string[] = []

  const add = (target: string[], id: string, layer: number, channel: Channel, raw: string | undefined, budgetKey = id, note?: string) => {
    if (!raw) return
    const fitted = fit(raw, BUDGETS[budgetKey]?.[input.tier])
    report.push({ id, layer, channel, tokens: fitted.tokens, truncated: fitted.truncated, dropped: fitted.dropped, note })
    if (!fitted.dropped) target.push(tag(id, fitted.text))
  }

  // Deferred tools still count: a skill may need tools the model loads on demand.
  const toolSet = new Set([...input.tools, ...(input.declaredTools ?? [])])
  const visible = availableSkills(input.skills, toolSet)

  // ── system: static first ─────────────────────────────────────────────
  const subagent = input.role === "subagent"
  if (subagent) {
    const identity = promptFile("identity", promptsDir)
    const rules = [section(identity, "bat_bien"), section(identity, "thu_tu_uu_tien")].filter(Boolean).join("\n\n")
    add(system, "subagent", 1, "system", [promptFile("subagent", promptsDir), rules].filter(Boolean).join("\n\n") || undefined, "identity")
  } else add(system, "identity", 1, "system", promptFile("identity", promptsDir))
  if (input.tools.length > 0) add(system, "tools", 7, "system", promptFile("tools", promptsDir))
  add(system, "citations", 1, "system", promptFile("citations", promptsDir))
  // Investor profile rides the static system prefix (cache-marked on Anthropic) like
  // CLAUDE.md at boot. Re-read per request but byte-identical while the file is unchanged,
  // so it caches the same — while an edit still applies the very next request.
  add(system, "ho_so_nha_dau_tu", 3, "system", input.investorProfile?.trim() || undefined, "investor_profile")
  if (subagent) add(system, "chi_dan_agent", 6, "system", input.agentPrompt?.trim() || undefined, "identity")
  else {
    add(system, "memory_policy", 4, "system", input.memoryInstructions?.trim() || undefined)
    add(system, "style", 8, "system", promptFile("style", promptsDir))
  }

  // ── system: per-session (changes only when skills or tools change) ────
  const always = visible.filter((s) => s.activation === "always")
  if (always.length > 0) {
    add(system, "skills_always", 6, "system", always.map((s) => tag(`skill name="${s.name}"`, s.body)).join("\n\n"))
  }
  if (input.tools.includes("load_skill")) {
    const budget = BUDGETS.skill_catalog![input.tier] ?? 0
    const catalog = renderCatalog(visible, budget)
    if (catalog) {
      const tokens = estimateTokens(catalog.text)
      report.push({ id: "skill_catalog", layer: 6, channel: "system", tokens, truncated: catalog.truncated, dropped: false })
      system.push(tag("skill_catalog", catalog.text))
    }
  }

  if (input.deferredTools && input.deferredTools.length > 0 && input.tools.includes("tool_search")) {
    const budget = BUDGETS.deferred_tools![input.tier] ?? 0
    const listing = renderDeferred(input.deferredTools, budget)
    report.push({ id: "tool_hoan", layer: 7, channel: "system", tokens: estimateTokens(listing.text), truncated: listing.truncated, dropped: false })
    system.push(tag("tool_hoan", listing.text))
  }

  if (input.tools.length > 0 && input.mcpInstructions && input.mcpInstructions.length > 0) {
    const body = input.mcpInstructions.map((m) => `<server name="${m.server}">
${m.text}
</server>`).join("\n\n")
    add(system, "huong_dan_mcp", 7, "system", `${MCP_INSTRUCTIONS_HEADER}\n\n${body}`, "mcp_instructions")
  }

  // ── context: user data, rebuilt every request ──────────────────────────
  add(context, "moi_truong", 4, "context", renderEnv(), "moi_truong")
  add(context, "memory", 4, "context", input.memoryIndex?.trim() || undefined)
  const sticky = input.sticky.flatMap((name) => visible.filter((s) => s.name === name && s.activation !== "always"))
  if (sticky.length > 0) {
    add(context, "skill_dang_bat", 6, "context", sticky.map((s) => tag(`skill name="${s.name}"`, s.body)).join("\n\n"), "skills_sticky")
  }

  // ── reminders: re-sent only when they change ───────────────────────────
  const calendar = input.calendar ?? loadCalendar()
  const clock = clockState(input.now, calendar)
  if (!sameSnapshot(input.prevClock, clock.snapshot)) {
    add(reminders, "phien_giao_dich", 2, "reminder", renderClock(clock, calendar), "market_clock")
  }
  add(reminders, "memory_lien_quan", 4, "reminder", input.recalled?.trim() || undefined, "memory")
  if (input.tools.includes(TODO_WRITE) && input.todos && hasOpenTodos(input.todos)) {
    add(reminders, "viec_can_lam", 2, "reminder", `${TODO_RECITE_HEADER}\n${renderTodos(input.todos)}`, "todos")
  }
  for (const context of input.hookContext ?? []) add(reminders, "hook_context", 4, "reminder", context)
  if (input.tools.includes("load_skill")) {
    const hits = suggestSkills(input.input, visible).filter((s) => !input.sticky.includes(s.name) && s.activation === "auto")
    if (hits.length > 0) {
      add(
        reminders,
        "goi_y_skill",
        6,
        "reminder",
        `Câu hỏi này có thể liên quan tới skill: ${hits.map((s) => s.name).join(", ")}. Nếu đúng, gọi load_skill trước khi trả lời.`,
      )
    }
  }

  return {
    system: system.join("\n\n"),
    context: context.length > 0 ? `Thông tin về người dùng và phiên làm việc (dùng khi liên quan):\n\n${context.join("\n\n")}` : undefined,
    reminders,
    clock: clock.snapshot,
    report,
  }
}
