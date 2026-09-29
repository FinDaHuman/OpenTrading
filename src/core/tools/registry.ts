import { dynamicTool, jsonSchema, tool, type ToolSet } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { z } from "zod"
import type { ToolDef } from "./types"
import { RwLock, runTool } from "./wrap"

type Listener = () => void

/** Every tool the model can call: native ones plus whatever MCP servers expose. */
export class ToolRegistry {
  private tools = new Map<string, ToolDef>()
  private listeners = new Set<Listener>()
  readonly lock = new RwLock()

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

  /** Snapshot as an AI SDK ToolSet. The list is frozen for the whole turn. */
  toToolSet(): ToolSet {
    const set: ToolSet = {}
    for (const def of this.list()) {
      const execute = (input: unknown, options: { abortSignal?: AbortSignal; toolCallId: string }) =>
        runTool(def, input, { signal: options.abortSignal ?? new AbortController().signal, callId: options.toolCallId }, this.lock)
      set[def.name] =
        def.input instanceof z.ZodType
          ? tool({ description: def.description, inputSchema: def.input, execute })
          : dynamicTool({ description: def.description, inputSchema: jsonSchema(def.input as JSONSchema7), execute })
    }
    return set
  }
}
