import { loadConfig, saveConfig } from "../config"
import { isInside, isSensitiveScope } from "../fs/path-safety"
import type { AgentOrigin, ApprovalPreview, ToolDef } from "../tools/types"
import { blockedMessage, type AutoReviewer, type Review } from "./auto"
import type { PermissionMode } from "./mode"

export { cycleMode, MODE_LABEL, modeNote, type PermissionMode } from "./mode"

/**
 * Asking the user before a tool with side effects runs (writes a file, creates an issue,
 * clicks in a browser). Rules from the reference harnesses:
 * - Read-only tools never ask (Codex `mcp_tool_call.rs`: readOnlyHint → no prompt).
 * - The user can allow once, for the session, or always; "always" is stored per server
 *   identity (URL or command), so another server reusing a trusted name must ask again.
 * - No UI attached (scripts, tests) → deny, never silently allow (deepseek user-approval).
 * - A denial is a tool error the model reads and works around; the turn goes on.
 * - Requests queue: the UI shows one at a time; when it advances, calls the user just
 *   allowed for the session go through without a second prompt.
 *
 * Order of the checks (first match wins, as in Claude Code and opencode's evaluate):
 * 0. `blockFor` — never (odd Windows path, deleting a drive root).
 * 1. A user deny rule (also on reads); then calls that never ask (read-only, no per-call scope) run.
 * 2. A user-only scope (key file, network path, protected folder, outside the workspace,
 *    loop guard): asked every time (a key file may be allowed for the session); no rule or
 *    "always" covers it.
 * 3. A user ask rule forces the prompt; an allow rule ("always") lets it run.
 * 4. The permission mode: ‖ read-only asks local file/shell effects with "switch to ▸";
 *    ▸ ask prompts as before.
 */

export interface AllowRule {
  /** Model-visible tool name; `*` wildcards allowed (`mcp__github__*`). */
  tool: string
  /** `ToolDef.permissionScope` at the time of approval; must match exactly. */
  scope: string
  /** Matches `ToolDef.subject` (a path, a command); `*` wildcards. Absent = any call. */
  pattern?: string
}

/** A deny or ask rule from config: tool name (wildcards) and optional subject pattern. */
export interface ListRule {
  tool: string
  pattern?: string
}

/**
 * - `mode`: allow once and switch ‖ read-only to ▸ ask (offered in read-only only).
 */
export type Choice = "once" | "session" | "always" | "mode" | "deny"

export interface ApprovalRequest {
  id: number
  /** Tool call waiting on this answer (the transcript shows "chờ bạn xác nhận"). */
  callId?: string
  tool: string
  /** Short label, e.g. `github · create_issue`. */
  label: string
  description: string
  input: unknown
  annotations?: ToolDef["annotations"]
  /** The subagent asking (its call is not a row of the main transcript). */
  agent?: AgentOrigin
  /** What a per-call approval is about (`domain:example.com` for web_fetch). */
  scope?: string
  /** The choices to offer, in order; the last one is always "deny". */
  choices: Choice[]
  /** Mode the call was asked in. */
  mode: PermissionMode
  effect?: ToolDef["effect"]
  /** The diff of a write, the target in one line. */
  preview?: ApprovalPreview
  /** ▸▸ auto mode handed this one to the user: why (classifier unavailable, blocked 3 times…). */
  notice?: string
}

export interface Decision {
  allow: boolean
  /**
   * Why a call did not run: the user said no, the turn was cancelled, nobody could be asked,
   * a deny rule matched, or it can never run (`blocked`).
   */
  reason?: "user" | "cancelled" | "headless" | "rule" | "blocked" | "classifier"
  /** The user's note when denying, or why it is blocked. */
  message?: string
}

interface Pending {
  request: ApprovalRequest
  key: string
  def: ToolDef
  resolve: (d: Decision) => void
  cleanup: () => void
}

const NATIVE_SCOPE = "native"
/** The loop guard's scope (loop-guard.ts): the user, not a rule, says "go on". */
const LOOP_SCOPE = "lap-lai"

export function needsApproval(def: ToolDef, input?: unknown) {
  if (def.askFor) return def.askFor(input) !== undefined
  return !def.readOnly && def.approval !== "never"
}

/** The "always allow" scope: the tool's identity, plus the per-call part (`#domain:x`) when it asks per call. */
function scopeOf(def: ToolDef, input: unknown) {
  const base = def.permissionScope ?? NATIVE_SCOPE
  const part = def.askFor?.(input)
  return part ? `${base}#${part}` : base
}

function wildcard(pattern: string, value: string) {
  const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, process.platform === "win32" ? "is" : "s")
  return re.test(value)
}

/** A deny/ask rule matches this call: the tool name, and the subject when the rule has a pattern. */
function listMatches(rule: ListRule, def: ToolDef, subject: string | undefined) {
  if (!wildcard(rule.tool, def.name)) return false
  if (!rule.pattern) return true
  return subject !== undefined && wildcard(rule.pattern, subject)
}

/** Scopes only the user answers, each time: no allow rule, "always" or session applies (a key file may be allowed for the session). */
const userOnly = (scope: string | undefined) => scope === LOOP_SCOPE || isSensitiveScope(scope)
/** Of those, the ones a session approval may cover: the same loop, reading the exact same key file / network path again. */
const sessionOk = (scope: string | undefined) => scope === LOOP_SCOPE || (!!scope && /^(secret|unc|odd):/.test(scope))

/** The choices for a prompt, last one "deny". */
export function choicesFor(def: ToolDef, scope: string | undefined, mode: PermissionMode): Choice[] {
  if (scope === LOOP_SCOPE) return ["once", "session", "deny"]
  if (isSensitiveScope(scope)) return sessionOk(scope) ? ["once", "session", "deny"] : ["once", "deny"]
  if (mode === "read-only" && def.effect) return ["once", "mode", "deny"]
  // A folder for the session, never "always" for every file write.
  if (def.effect === "file") return ["once", "session", "deny"]
  // A chained command or an interpreter: this exact command for the session at most.
  if (scope?.startsWith("cmd!")) return ["once", "session", "deny"]
  return ["once", "session", "always", "deny"]
}

export interface RuleStore {
  load(): Promise<AllowRule[]>
  save(rules: AllowRule[]): Promise<void>
  /** Deny and ask rules (config `permissions.deny` / `permissions.ask`); none when absent. */
  lists?(): Promise<{ deny: ListRule[]; ask: ListRule[] }>
}

/** "Always allow" rules live in ~/.opentrading/config.json → permissions.allow (deny/ask beside it). */
export const configRuleStore: RuleStore = {
  async load() {
    return (await loadConfig()).permissions?.allow ?? []
  },
  async save(allow) {
    const config = await loadConfig()
    await saveConfig({ permissions: { ...config.permissions, allow } })
  },
  async lists() {
    const p = (await loadConfig()).permissions
    return { deny: p?.deny ?? [], ask: p?.ask ?? [] }
  },
}

export class PermissionGate {
  private session = new Set<string>()
  private queue: Pending[] = []
  private listeners = new Set<(head: ApprovalRequest | undefined) => void>()
  private modeListeners = new Set<(mode: PermissionMode) => void>()
  private nextId = 1
  private current: PermissionMode = "read-only"
  /** Deny/ask rules held in memory (refreshRules), so a deny rule also stops reads without a config read per call. */
  private lists?: { deny: ListRule[]; ask: ListRule[] }
  /** Folders allowed "for this session" per approval group: a write below one of them is covered too. */
  private sessionDirs = new Map<string, string[]>()
  /** Set by the TUI. Without it every request is denied. */
  interactive = false
  /** ▸▸ auto mode's reviewer (runtime.ts); it also keeps the log the classifier reads, in every mode. */
  auto?: AutoReviewer

  constructor(private rules: RuleStore = configRuleStore) {}

  /** Load the deny/ask rules again (startup, after /permissions edits). */
  async refreshRules() {
    this.lists = (await this.rules.lists?.()) ?? { deny: [], ask: [] }
  }

  get mode(): PermissionMode {
    return this.current
  }

  /** Switch the permission mode (Shift+Tab, the "switch to ▸" choice, config default). */
  setMode(mode: PermissionMode) {
    if (mode === this.current) return
    this.current = mode
    for (const listener of this.modeListeners) listener(mode)
  }

  onModeChange(listener: (mode: PermissionMode) => void) {
    this.modeListeners.add(listener)
    return () => this.modeListeners.delete(listener)
  }

  /** The request the UI should show now. */
  head(): ApprovalRequest | undefined {
    return this.queue[0]?.request
  }

  /** Every waiting request, oldest first (subagent rows behind the head say "chờ xác nhận" too). */
  pending(): ApprovalRequest[] {
    return this.queue.map((p) => p.request)
  }

  onChange(listener: (head: ApprovalRequest | undefined) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    const head = this.head()
    for (const listener of this.listeners) listener(head)
    this.emitPending()
  }

  private pendingListeners = new Set<(pending: ApprovalRequest[]) => void>()

  /** Every change to the queue, not only the head (subagent rows waiting behind it). */
  onPending(listener: (pending: ApprovalRequest[]) => void) {
    this.pendingListeners.add(listener)
    return () => this.pendingListeners.delete(listener)
  }

  private emitPending() {
    const pending = this.pending()
    for (const listener of this.pendingListeners) listener(pending)
  }

  /** Session approvals: per scope and tool, or per scope and group (write_file + edit_file share a folder). */
  private keyOf(def: ToolDef, input: unknown) {
    return `${scopeOf(def, input)}|${def.approvalGroup ?? def.name}`
  }

  private async allowedAlways(def: ToolDef, input: unknown) {
    const scope = scopeOf(def, input)
    const subject = def.subject?.(input)
    return (await this.rules.load()).some(
      (r) =>
        r.scope === scope &&
        wildcard(r.tool, def.name) &&
        (!r.pattern || (subject !== undefined && wildcard(r.pattern, subject))) &&
        // ▸▸ auto: a hand-written wildcard rule (`mcp__x__*`) would let whole tool families skip
        // the classifier; only rules for one tool count (Claude Code drops broad rules too).
        !(this.current === "auto" && r.tool.includes("*")),
    )
  }

  /** A session approval for this call: the same key, or (file writes) a folder approved for the session above it. */
  private sessionCovers(def: ToolDef, input: unknown, key: string) {
    if (this.session.has(key)) return true
    const part = def.askFor?.(input)
    if (!part?.startsWith("edit:")) return false
    const dir = part.slice("edit:".length)
    return (this.sessionDirs.get(def.approvalGroup ?? def.name) ?? []).some((approved) => isInside(dir, approved))
  }

  /** ‖ read-only asks every local file/shell effect, whatever was approved before (session or rule). */
  private approvalsApply(def: ToolDef) {
    return !def.effect || this.current !== "read-only"
  }

  /** An allowed call: in ▸▸ it breaks a run of blocks (Claude Code resets the streak on any allowed call). */
  private ran(): Decision {
    if (this.current === "auto") this.auto?.ranWithoutBlock()
    return { allow: true }
  }

  /** Resolve before the tool runs. Waiting here never counts against the tool's timeout. */
  async check(def: ToolDef, input: unknown, signal: AbortSignal, label = def.name, callId?: string, agent?: AgentOrigin): Promise<Decision> {
    const scope = def.askFor?.(input)
    // The classifier's view of what the agent did, kept in every mode (the loop guard's
    // second look at the same call is not a new action).
    if (scope !== LOOP_SCOPE) this.auto?.log.action(def, input, agent)
    const blocked = def.blockFor?.(input)
    if (blocked) return { allow: false, reason: "blocked", message: blocked }
    const subject = def.subject?.(input)
    // Deny rules first, from memory: they stop reads too (refreshRules loads them).
    if (this.lists?.deny.some((r) => listMatches(r, def, subject))) return { allow: false, reason: "rule" }
    // Calls that never ask run at once, as before: no await, so parallel calls keep their order.
    if (!userOnly(scope) && !needsApproval(def, input)) return this.ran()
    const lists = this.lists ?? (await this.rules.lists?.()) ?? { deny: [], ask: [] }
    if (!this.lists && lists.deny.some((r) => listMatches(r, def, subject))) return { allow: false, reason: "rule" }
    const key = this.keyOf(def, input)
    if (userOnly(scope)) {
      if (sessionOk(scope) && this.session.has(key)) return { allow: true }
    } else if (!lists.ask.some((r) => listMatches(r, def, subject))) {
      if (this.approvalsApply(def) && (this.sessionCovers(def, input, key) || (await this.allowedAlways(def, input)))) return this.ran()
    }
    let notice: string | undefined
    if (this.current === "auto" && this.auto && !userOnly(scope) && !lists.ask.some((r) => listMatches(r, def, subject))) {
      // A new file, or one this run created, in the workspace (the copy in /undo is the safety
      // net), or a shell command that only reads: no classifier request.
      if (await def.autoSafe?.(input)) return this.ran()
      const review = await this.auto.review(def, input, agent, signal).catch((error): Review => ({ decision: "ask", why: `model duyệt lỗi: ${error instanceof Error ? error.message : String(error)}` }))
      if (signal.aborted) return { allow: false, reason: "cancelled" }
      if (review?.decision === "allow") return { allow: true }
      if (review?.decision === "block") return { allow: false, reason: "classifier", message: blockedMessage(review.label, review.reason) }
      notice = review?.why ?? "model duyệt lỗi"
    }
    if (!this.interactive) return { allow: false, reason: "headless" }
    if (signal.aborted) return { allow: false, reason: "cancelled" }
    const preview = await def.preview?.(input).catch(() => undefined)

    return new Promise<Decision>((resolve) => {
      const request: ApprovalRequest = {
        id: this.nextId++,
        callId,
        tool: def.name,
        label,
        description: def.description,
        input,
        annotations: def.annotations,
        choices: choicesFor(def, scope, this.current),
        mode: this.current,
        ...(def.effect ? { effect: def.effect } : {}),
        ...(preview ? { preview } : {}),
        ...(agent ? { agent } : {}),
        ...(scope !== undefined ? { scope } : {}),
        ...(notice ? { notice } : {}),
      }
      const onAbort = () => {
        this.queue = this.queue.filter((p) => p.request.id !== request.id)
        resolve({ allow: false, reason: "cancelled" })
        this.emit()
      }
      signal.addEventListener("abort", onAbort, { once: true })
      this.queue.push({ request, key, def, resolve, cleanup: () => signal.removeEventListener("abort", onAbort) })
      if (this.queue.length === 1) this.emit()
      else this.emitPending()
    })
  }

  /** The user's answer for request `id`. */
  async respond(id: number, choice: Choice, message?: string) {
    const index = this.queue.findIndex((p) => p.request.id === id)
    if (index < 0) return
    const [pending] = this.queue.splice(index, 1)
    pending!.cleanup()
    // The request has left the queue: whatever happens below, its promise settles and the UI hears of it.
    try {
      // Only what the prompt offered counts ("always" on a key file becomes the session).
      const offered = pending!.request.choices
      if (!offered.includes(choice)) choice = choice === "always" && offered.includes("session") ? "session" : "once"
      if (pending!.request.mode === "auto") this.auto?.userAnswered()
      if (choice === "deny") {
        // The user's note is their own words: the classifier reads it too.
        if (message?.trim()) this.auto?.log.answer(`(từ chối ${pending!.def.name}) ${message.trim()}`)
        pending!.resolve({ allow: false, reason: "user", message: message?.trim() || undefined })
        return
      }
      // The rule is saved before anything is granted: a failed save grants nothing, not even the session.
      if (choice === "always") {
        try {
          const rules = await this.rules.load()
          const rule = { tool: pending!.def.name, scope: scopeOf(pending!.def, pending!.request.input) }
          if (!rules.some((r) => r.tool === rule.tool && r.scope === rule.scope && !r.pattern)) await this.rules.save([...rules, rule])
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error)
          pending!.resolve({ allow: false, reason: "blocked", message: `không lưu được quyền "luôn cho phép" (${why}); chưa cấp quyền nào, người dùng có thể duyệt lại "chỉ lần này" hoặc "cả phiên"` })
          return
        }
      }
      if (choice === "mode") this.setMode("ask")
      if (choice === "session" || choice === "always") {
        this.session.add(pending!.key)
        const scope = pending!.request.scope
        if (scope?.startsWith("edit:")) {
          const group = pending!.def.approvalGroup ?? pending!.def.name
          this.sessionDirs.set(group, [...(this.sessionDirs.get(group) ?? []), scope.slice("edit:".length)])
        }
      }
      pending!.resolve({ allow: true })
      // Calls queued behind this one may have just become allowed.
      const still: Pending[] = []
      for (const p of this.queue) {
        if (!userOnly(p.request.scope) && this.approvalsApply(p.def) && this.sessionCovers(p.def, p.request.input, p.key)) {
          p.cleanup()
          p.resolve({ allow: true })
        } else still.push(p)
      }
      this.queue = still
    } finally {
      this.emit()
    }
  }

  /** Deny everything waiting (turn aborted, app closing). */
  denyAll() {
    for (const p of this.queue) {
      p.cleanup()
      p.resolve({ allow: false, reason: "cancelled" })
    }
    this.queue = []
    this.emit()
  }
}

/** The error the model reads when the user says no. */
export function deniedMessage(decision: Decision) {
  if (decision.reason === "cancelled") return "Lời gọi tool đã bị huỷ."
  if (decision.reason === "headless") return "Lời gọi này cần người dùng xác nhận, nhưng không có giao diện để hỏi. Không chạy."
  if (decision.reason === "blocked") return `Không chạy được: ${decision.message ?? "lời gọi này bị chặn"}. Đừng thử lại cùng cách.`
  if (decision.reason === "classifier") return decision.message ?? "Auto mode chặn lời gọi này."
  if (decision.reason === "rule") return "Người dùng đã đặt quy tắc chặn lời gọi này (cấu hình permissions.deny). Đừng thử lại; làm cách khác hoặc hỏi người dùng."
  return decision.message
    ? `Người dùng từ chối chạy tool này. Lời nhắn của người dùng: ${decision.message}`
    : "Người dùng từ chối chạy tool này. Đừng thử lại cùng lời gọi; hỏi người dùng muốn làm gì khác."
}
