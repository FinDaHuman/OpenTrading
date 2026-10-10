import { loadConfig, saveConfig } from "./config"
import type { AgentOrigin, ToolDef } from "./tools/types"

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
 */

export interface AllowRule {
  /** Model-visible tool name; `*` wildcards allowed (`mcp__github__*`). */
  tool: string
  /** `ToolDef.permissionScope` at the time of approval; must match exactly. */
  scope: string
}

export type Choice = "once" | "session" | "always" | "deny"

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
}

export interface Decision {
  allow: boolean
  /** Why a call did not run: the user said no, the turn was cancelled, or nobody could be asked. */
  reason?: "user" | "cancelled" | "headless"
  /** The user's note when denying ("tell the model what to do instead"). */
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
  const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
  return re.test(value)
}

export interface RuleStore {
  load(): Promise<AllowRule[]>
  save(rules: AllowRule[]): Promise<void>
}

/** "Always allow" rules live in ~/.opentrading/config.json → permissions.allow. */
export const configRuleStore: RuleStore = {
  async load() {
    return (await loadConfig()).permissions?.allow ?? []
  },
  async save(allow) {
    const config = await loadConfig()
    await saveConfig({ permissions: { ...config.permissions, allow } })
  },
}

export class PermissionGate {
  private session = new Set<string>()
  private queue: Pending[] = []
  private listeners = new Set<(head: ApprovalRequest | undefined) => void>()
  private nextId = 1
  /** Set by the TUI. Without it every request is denied. */
  interactive = false

  constructor(private rules: RuleStore = configRuleStore) {}

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

  private keyOf(def: ToolDef, input: unknown) {
    return `${scopeOf(def, input)}|${def.name}`
  }

  private async allowedAlways(def: ToolDef, input: unknown) {
    const scope = scopeOf(def, input)
    return (await this.rules.load()).some((r) => r.scope === scope && wildcard(r.tool, def.name))
  }

  /** Resolve before the tool runs. Waiting here never counts against the tool's timeout. */
  async check(def: ToolDef, input: unknown, signal: AbortSignal, label = def.name, callId?: string, agent?: AgentOrigin): Promise<Decision> {
    if (!needsApproval(def, input)) return { allow: true }
    const key = this.keyOf(def, input)
    if (this.session.has(key) || (await this.allowedAlways(def, input))) return { allow: true }
    if (!this.interactive) return { allow: false, reason: "headless" }
    if (signal.aborted) return { allow: false, reason: "cancelled" }

    return new Promise<Decision>((resolve) => {
      const request: ApprovalRequest = {
        id: this.nextId++,
        callId,
        tool: def.name,
        label,
        description: def.description,
        input,
        annotations: def.annotations,
        ...(agent ? { agent } : {}),
        ...(def.askFor ? { scope: def.askFor(input) } : {}),
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
    if (choice === "deny") {
      pending!.resolve({ allow: false, reason: "user", message: message?.trim() || undefined })
    } else {
      if (choice === "session" || choice === "always") this.session.add(pending!.key)
      if (choice === "always") {
        const rules = await this.rules.load()
        const rule = { tool: pending!.def.name, scope: scopeOf(pending!.def, pending!.request.input) }
        if (!rules.some((r) => r.tool === rule.tool && r.scope === rule.scope)) await this.rules.save([...rules, rule])
      }
      pending!.resolve({ allow: true })
    }
    // Calls queued behind this one may have just become allowed.
    const still: Pending[] = []
    for (const p of this.queue) {
      if (this.session.has(p.key)) {
        p.cleanup()
        p.resolve({ allow: true })
      } else still.push(p)
    }
    this.queue = still
    this.emit()
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
  if (decision.reason === "headless") return "Lời gọi này cần người dùng xác nhận (tool ghi, hoặc đọc domain chưa được cho phép), nhưng không có giao diện để hỏi. Không chạy."
  return decision.message
    ? `Người dùng từ chối chạy tool này. Lời nhắn của người dùng: ${decision.message}`
    : "Người dùng từ chối chạy tool này. Đừng thử lại cùng lời gọi; hỏi người dùng muốn làm gì khác."
}
