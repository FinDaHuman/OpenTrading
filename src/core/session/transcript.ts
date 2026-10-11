import type { ModelMessage } from "ai"
import { isCompactMarker } from "../compact-marker"
import { toolErrorText } from "../tools/errors"
import { splitNotices, type ParsedNotice } from "../subagents/notification"

/**
 * Rebuild a UI-neutral transcript from stored model messages, so a resumed session looks the
 * same as when it was written: user text (without reminder blocks), assistant text, and one
 * item per tool call with its result.
 */
export type TranscriptItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; callId: string; name: string; input: unknown; ok: boolean; output: string }
  /** The history was compacted here; `text` is the summary that replaced what came before. */
  | { kind: "compact"; text: string }
  /** A background subagent's result was delivered here. */
  | ({ kind: "agent-notice" } & ParsedNotice)

function outputText(output: unknown): { ok: boolean; text: string } {
  const o = output as { type?: string; value?: unknown }
  const text =
    typeof o?.value === "string"
      ? o.value
      : o?.type === "content" && Array.isArray(o.value)
        ? (o.value as { type: string; text?: string }[]).map((p) => (p.type === "text" ? p.text : "[ảnh]")).join("\n")
        : JSON.stringify(o?.value ?? output, null, 2)
  const ok = !String(o?.type ?? "").startsWith("error")
  // Sessions saved before errors were cleaned carry the SDK's "AI_…Error: Error: …" prefixes.
  return { ok, text: ok ? text : toolErrorText(text) }
}

export function transcriptFromMessages(messages: ModelMessage[]): TranscriptItem[] {
  const results = new Map<string, { ok: boolean; text: string }>()
  for (const m of messages) {
    if (m.role !== "tool") continue
    for (const p of m.content) if (p.type === "tool-result") results.set(p.toolCallId, outputText(p.output))
  }

  const items: TranscriptItem[] = []
  let summaryNext = false
  for (const m of messages) {
    if (isCompactMarker(m)) {
      summaryNext = true
      continue
    }
    if (summaryNext && m.role === "assistant") {
      summaryNext = false
      const text = typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? p.text : "")).join("")
      items.push({ kind: "compact", text })
      continue
    }
    summaryNext = false
    if (m.role === "user") {
      const text =
        typeof m.content === "string"
          ? m.content
          : m.content
              .filter((p) => p.type === "text" && !p.text.trimStart().startsWith("<nhac_nho>"))
              .map((p) => (p as { text: string }).text)
              .join("\n")
      const { notices, rest } = splitNotices(text)
      for (const n of notices) items.push({ kind: "agent-notice", ...n })
      if (rest.trim()) items.push({ kind: "user", text: rest })
    } else if (m.role === "assistant") {
      if (typeof m.content === "string") {
        if (m.content.trim()) items.push({ kind: "assistant", text: m.content })
        continue
      }
      let text = ""
      for (const p of m.content) {
        if (p.type === "text") text += p.text
        else if (p.type === "tool-call") {
          if (text.trim()) items.push({ kind: "assistant", text })
          text = ""
          const result = results.get(p.toolCallId) ?? { ok: false, text: "(không có kết quả)" }
          items.push({ kind: "tool", callId: p.toolCallId, name: p.toolName, input: p.input, ok: result.ok, output: result.text })
        }
      }
      if (text.trim()) items.push({ kind: "assistant", text })
    }
  }
  return items
}
