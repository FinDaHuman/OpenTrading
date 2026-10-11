import type { ModelMessage } from "ai"
import { compactCarry, isCompactMarker } from "../compact-marker"
import { toolErrorText } from "./errors"
import { LOADED_PREFIX } from "./search"

/** Tools whose results may announce loaded tools on their first line. */
const LOADERS = new Set(["tool_search", "load_skill"])

function firstText(output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined
  const o = output as { type?: string; value?: unknown }
  if (o.type === "text" && typeof o.value === "string") return o.value
  if (o.type === "content" && Array.isArray(o.value)) {
    const part = o.value.find((p: { type?: string }) => p?.type === "text") as { text?: string } | undefined
    return part?.text
  }
  return undefined
}

function errorText(output: unknown): string | undefined {
  const o = output as { type?: string; value?: unknown } | undefined
  return o?.type === "error-text" && typeof o.value === "string" ? toolErrorText(o.value) : undefined
}

/**
 * Deferred tools the conversation has made callable, in order of first appearance: tools
 * named in a `Đã nạp tool:` line of a tool_search / load_skill result, plus every tool the
 * model called. Derived from history alone, so resumed sessions recover it and the set only
 * grows — a tool that appears in history is always declared again.
 */
export function loadedTools(messages: readonly ModelMessage[]): string[] {
  const seen = new Set<string>()
  for (const message of messages) {
    // A compacted history starts with a marker listing what the summarized head had loaded.
    if (isCompactMarker(message)) for (const name of compactCarry(message).tools) seen.add(name)
    if (typeof message.content === "string") continue
    for (const part of message.content as { type: string; toolName?: string; output?: unknown }[]) {
      if (part.type === "tool-call" && part.toolName) seen.add(part.toolName)
      // A loader's result, or the error for a deferred tool called before it was loaded
      // (agent.ts repairCall), which loads it — read through the SDK's prefixes, which
      // sessions saved before errors were cleaned still carry.
      const loads = part.type === "tool-result" && part.toolName && (LOADERS.has(part.toolName) || errorText(part.output) !== undefined)
      if (loads) {
        const text = firstText(part.output) ?? errorText(part.output)
        const line = text?.split("\n", 1)[0]
        if (line?.startsWith(LOADED_PREFIX)) {
          for (const name of line.slice(LOADED_PREFIX.length).split(",")) if (name.trim()) seen.add(name.trim())
        }
      }
    }
  }
  return [...seen]
}
