import { dynamicTool, jsonSchema, tool, type ModelMessage, type ToolSet } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { z } from "zod"
import type { Workspace } from "../fs/workspace"
import type { PermissionGate } from "../permission"
import { sanitizeSchema, type SchemaFlavor } from "../mcp/schema"
import type { AgentOrigin, ToolDef, ToolResult } from "./types"
import { RwLock, runTool } from "./wrap"
import { LoopGuard } from "./loop-guard"

type Listener = () => void

/**
 * OpenAI, Gemini and Anthropic all reject requests with more than 128 tool definitions
 * (OpenAI answers 400). Tool choice degrades long before that, so this is a hard ceiling,
 * not a target.
 */
export const MAX_TOOLS_PER_REQUEST = 128

/** Images bigger than this, or beyond this many per result, are replaced by a placeholder. */
const MAX_IMAGE_BASE64 = 5 * 1024 * 1024 * (4 / 3)
const MAX_IMAGES_PER_RESULT = 4

export interface ToolSetOptions {
  /** Schema dialect of the target provider. */
  flavor?: SchemaFlavor
  /** Whether the target model can see images in tool results. */
  images?: boolean
  maxTools?: number
  /**
   * Tool search: leave `deferrable` tools out of the model-visible set (unless in `loaded`)
   * but still declare them, so they run when called and can be activated per step.
   */
  defer?: boolean
  /** Deferred tools the model already loaded (tool_search, load_skill, or a direct call). */
  loaded?: ReadonlySet<string>
}

export interface BuiltToolSet {
  /** Declared tools. With `defer`, every tool; otherwise only the visible ones. */
  tools: ToolSet
  /** Model-visible names, in priority order. */
  names: string[]
  /** Deferred tools not loaded yet: declared, not shown to the model. */
  deferred: string[]
  /** Whether tool search is on for this request (`defer`). */
  deferring: boolean
  /** Tools left out because of `maxTools`, per source. */
  hidden: { source: string; count: number }[]
  /** Rough token cost of the visible definitions (name + description + schema, chars / 4). */
  tokens: number
}

const imageNote = (mediaType: string, why: string) => `[ảnh ${mediaType} — ${why}]`

/** What the model receives for a tool result: text, plus images only when it can see them. */
export function modelOutput(result: ToolResult, images: boolean) {
  const list = result.images ?? []
  const sendable = images ? list.filter((i) => i.data.length <= MAX_IMAGE_BASE64).slice(0, MAX_IMAGES_PER_RESULT) : []
  const notes = list
    .filter((i) => !sendable.includes(i))
    .map((i) => imageNote(i.mediaType, images ? "quá lớn hoặc quá nhiều ảnh, không gửi cho model" : "model này không xem được ảnh"))
  const text = [result.output, ...notes].filter(Boolean).join("\n")
  if (sendable.length === 0) return { type: "text" as const, value: text }
  return {
    type: "content" as const,
    value: [
      { type: "text" as const, text },
      ...sendable.map((i) => ({ type: "image-data" as const, data: i.data, mediaType: i.mediaType })),
    ],
  }
}

/** Every tool the model can call: native ones plus whatever MCP servers expose. */
export class ToolRegistry {
  private tools = new Map<string, ToolDef>()
  private listeners = new Set<Listener>()
  /** Sanitized schemas per tool definition and flavor; a re-registered tool is a new key. */
  private schemas = new WeakMap<ToolDef, Map<SchemaFlavor, JSONSchema7>>()
  readonly lock: RwLock
  /** The subagent this registry belongs to; its tool calls carry it (approval prompts). */
  readonly origin?: AgentOrigin
  /** Last "tools hidden by the limit" state the user was told about. */
  lastHiddenNotice = ""
  /** Asks the user before tools with side effects run; unset = run everything (tests). */
  gate?: PermissionGate
  /** Folders the file tools work in; its description reaches the model as `<quyen_tep>`. */
  workspace?: Workspace

  constructor(opts: { lock?: RwLock; origin?: AgentOrigin } = {}) {
    // A subagent shares its parent's lock, so its writes exclude the parent's and siblings'.
    this.lock = opts.lock ?? new RwLock()
    this.origin = opts.origin
  }

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

  private schemaFor(def: ToolDef, flavor: SchemaFlavor): JSONSchema7 {
    let perFlavor = this.schemas.get(def)
    if (!perFlavor) this.schemas.set(def, (perFlavor = new Map()))
    let schema = perFlavor.get(flavor)
    if (!schema) perFlavor.set(flavor, (schema = sanitizeSchema(def.input, flavor)))
    return schema
  }

  /** JSON Schema the provider receives for this tool. */
  jsonSchemaFor(def: ToolDef, flavor: SchemaFlavor = "default"): JSONSchema7 {
    // The model writes the tool's input: describe the input side (a transform's output has no JSON Schema).
    return def.input instanceof z.ZodType ? (z.toJSONSchema(def.input, { io: "input" }) as JSONSchema7) : this.schemaFor(def, flavor)
  }

  /** Rough token cost of sending these definitions (name + description + schema, chars / 4). */
  estimateTokens(defs: ToolDef[], flavor: SchemaFlavor = "default") {
    let chars = 0
    for (const def of defs) chars += def.name.length + def.description.length + JSON.stringify(this.jsonSchemaFor(def, flavor)).length
    return Math.ceil(chars / 4)
  }

  /**
   * The tools for one request: schemas sanitized for the provider, the visible set capped at
   * `maxTools` (native first, then MCP servers in config order), with results converted to
   * text or text + images for the model. With `defer`, deferred tools are declared too but
   * kept out of `names`; the agent loop exposes them per step via `activeTools`.
   */
  toToolSet(opts: ToolSetOptions = {}): BuiltToolSet {
    const flavor = opts.flavor ?? "default"
    const max = opts.maxTools ?? MAX_TOOLS_PER_REQUEST
    const ordered = this.list()
      .filter((d) => !d.onDemand || opts.loaded?.has(d.name))
      .sort((a, b) => (a.priority ?? -1) - (b.priority ?? -1) || a.name.localeCompare(b.name))
    const isDeferred = (def: ToolDef) => !!opts.defer && !!def.deferrable && !opts.loaded?.has(def.name)
    const visible = ordered.filter((d) => !isDeferred(d))
    const kept = visible.slice(0, max)
    const hiddenBySource = new Map<string, number>()
    for (const def of visible.slice(max)) hiddenBySource.set(def.source ?? "?", (hiddenBySource.get(def.source ?? "?") ?? 0) + 1)
    const deferred = ordered.filter(isDeferred)

    const set: ToolSet = {}
    // Keep the request's tool order stable (by name) for prompt caching.
    const declared = opts.defer ? ordered : kept
    // One guard per tool set: a turn (or a subagent run) counts its own repeats.
    const loop = new LoopGuard()
    for (const def of [...declared].sort((a, b) => a.name.localeCompare(b.name))) {
      const execute = (input: unknown, options: { abortSignal?: AbortSignal; toolCallId: string }) =>
        runTool(
          def,
          input,
          { signal: options.abortSignal ?? new AbortController().signal, callId: options.toolCallId, agent: this.origin, loop },
          this.lock,
          this.gate,
        )
      const toModelOutput = ({ output }: { output: unknown }) => modelOutput(output as ToolResult, opts.images ?? false)
      set[def.name] =
        def.input instanceof z.ZodType
          ? tool({ description: def.description, inputSchema: def.input, execute, toModelOutput })
          : dynamicTool({ description: def.description, inputSchema: jsonSchema(this.schemaFor(def, flavor)), execute, toModelOutput })
    }
    return {
      tools: set,
      names: kept.map((d) => d.name),
      deferred: deferred.map((d) => d.name),
      deferring: !!opts.defer,
      hidden: [...hiddenBySource].map(([source, count]) => ({ source, count })),
      tokens: this.estimateTokens(kept, flavor),
    }
  }
}

type ToolMessage = Extract<ModelMessage, { role: "tool" }>

type UserMessage = Extract<ModelMessage, { role: "user" }>

/**
 * History for a model that cannot see images (or for the session file): tool results and
 * user messages that carried images become plain text with a placeholder. Needed per
 * request, because the user may switch from a vision model to one that would choke on base64.
 */
export function stripImages<M extends ModelMessage>(messages: M[], which: { tool?: boolean; user?: boolean } = {}): M[] {
  const { tool = true, user = true } = which
  return messages.map((m) => {
    if (m.role === "user" && user && typeof m.content !== "string") {
      const parts = (m as UserMessage).content
      if (typeof parts === "string" || !parts.some((p) => p.type === "image" || p.type === "file")) return m
      const content = parts.map((p) =>
        p.type === "image" || p.type === "file"
          ? { type: "text" as const, text: imageNote(p.mediaType ?? "image", "model này không xem được ảnh, hoặc ảnh không còn trong lịch sử") }
          : p,
      )
      return { ...m, content } as M
    }
    if (m.role !== "tool" || !tool) return m
    let changed = false
    const content = (m as ToolMessage).content.map((part) => {
      if (part.type !== "tool-result" || part.output.type !== "content") return part
      changed = true
      const text = part.output.value
        .map((item) => (item.type === "text" ? item.text : imageNote("mediaType" in item ? String(item.mediaType) : item.type, "không còn trong lịch sử")))
        .join("\n")
      return { ...part, output: { type: "text" as const, value: text } }
    })
    return changed ? ({ ...m, content } as M) : m
  })
}
