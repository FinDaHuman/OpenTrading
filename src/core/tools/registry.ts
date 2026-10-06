import { dynamicTool, jsonSchema, tool, type ToolSet } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { z } from "zod"
import { requestApproval } from "../approvals"
import type { ToolDef } from "./types"
import { RwLock, runTool } from "./wrap"

type Listener = () => void

/**
 * Per-turn call budget. Skills carry their own `tool_budget` (guidance the model reads);
 * this looser harness cap stops runaway loops regardless of which skill is active.
 */
export const TURN_TOOL_BUDGET = 20

/** Stable short fingerprint of tool input for the doom-loop check. */
export function inputKey(input: unknown): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable)
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]))
    return value
  }
  const text = JSON.stringify(input ?? {})
  return text === "{}" ? "" : text.length > 200 ? JSON.stringify(stable(input)).slice(0, 200) : text
}

/** Every tool the model can call: native ones plus whatever MCP servers expose. */
export class ToolRegistry {
  private tools = new Map<string, ToolDef>()
  private listeners = new Set<Listener>()
  readonly lock = new RwLock()
  private callsUsed = 0
  /** Consecutive-identical call counter per tool+input key (doom-loop detection). */
  private loops = new Map<string, number>()
  private lastLoopKey: string | undefined

  register(def: ToolDef) {
    this.tools.set(def.name, def)
    this.emit()
  }

  /** Remove every tool whose name starts with `prefix` (e.g. all tools of one MCP server). */
  unregister(prefix: string) {
    let changed = false
    for (const name of [...this.tools.keys()]) {
      if (name.startsWith(prefix)) changed = this.tools.delete(name) || changed
    }
    if (changed) this.emit()
  }

  /** Remove every tool registered with this `source` (e.g. "memory:file" when memory is switched). */
  unregisterSource(source: string) {
    let changed = false
    for (const [name, def] of [...this.tools]) {
      if (def.source === source) changed = this.tools.delete(name) || changed
    }
    if (changed) this.emit()
  }

  get(name: string) {
    return this.tools.get(name)
  }

  /** Sorted by name so the tool list — and the provider's prompt cache — stays stable. */
  list(): ToolDef[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  onChange(listener: Listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  /** Fresh counters at the start of every agent turn. */
  resetTurnBudgets() {
    this.callsUsed = 0
    this.loops.clear()
    this.lastLoopKey = undefined
  }

  get budgetLeft() {
    return Math.max(0, TURN_TOOL_BUDGET - this.callsUsed)
  }

  /** Snapshot as an AI SDK ToolSet. The list is frozen for the whole turn. */
  toToolSet(): ToolSet {
    const set: ToolSet = {}
    for (const def of this.list()) {
      const execute = async (input: unknown, options: { abortSignal?: AbortSignal; toolCallId: string }) => {
        const key = `${def.name}:${inputKey(input)}`
        const consecutive = this.lastLoopKey === key
        const count = (consecutive ? (this.loops.get(key) ?? 0) : 0) + 1
        this.loops.set(key, count)
        this.lastLoopKey = key
        if (count >= 3) {
          const decision = await requestApproval({
            kind: "doom-loop",
            key,
            title: `Model gọi "${def.name}" lần thứ 3 với cùng tham số.`,
            detail: "Từ chối để buộc model tổng kết bằng dữ liệu đã có; cho phép nếu lần gọi này thật sự cần.",
          })
          if (decision === "deny")
            return `Đã chặn vòng lặp: tool ${def.name} đã được gọi giống hệt 2 lần trước. Hãy tổng kết bằng dữ liệu đã có và nói rõ phần nào chưa kiểm tra được.`
        }
        if (this.callsUsed >= TURN_TOOL_BUDGET)
          return `Đã hết ngân sách tool của lượt này (${TURN_TOOL_BUDGET} lần gọi). Hãy tổng kết câu trả lời bằng dữ liệu đã có, nói rõ phần nào chưa kiểm tra được.`
        this.callsUsed++
        return runTool(def, input, { signal: options.abortSignal ?? new AbortController().signal, callId: options.toolCallId }, this.lock)
      }
      set[def.name] =
        def.input instanceof z.ZodType
          ? tool({ description: def.description, inputSchema: def.input, execute })
          : dynamicTool({ description: def.description, inputSchema: jsonSchema(def.input as JSONSchema7), execute })
    }
    return set
  }
}
