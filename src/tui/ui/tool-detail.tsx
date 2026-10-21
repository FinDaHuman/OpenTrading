import type { JSX } from "solid-js"
import { For, Show } from "solid-js"
import { z } from "zod"
import type { ToolDef } from "../../core/tools/types"
import { color } from "../theme"
import { BADGE, toolBadge } from "./badges"
import { truncate } from "./text"

/**
 * A titled field row: bold label, value (status coloured). One line, clipped; `wrap` lets a
 * long value (a list of prompts) continue on the next lines under the value column. Never
 * shrinks: a squeezed row would be drawn over its neighbours.
 */
export function Field(props: { label: string; wrap?: boolean; children: JSX.Element }) {
  return (
    <box flexDirection="row" height={props.wrap ? undefined : 1} flexShrink={0}>
      <text fg={color.tx} width={14} flexShrink={0}>
        <span style={{ bold: true }}>{props.label}</span>
      </text>
      <text fg={color.tx2} wrapMode={props.wrap ? "word" : "none"} flexGrow={props.wrap ? 1 : 0} flexShrink={1} overflow="hidden">
        {props.children}
      </text>
    </box>
  )
}

/** Claude Code's tool detail: badges, names, description, parameters. */
export function ToolDetail(props: { tool: ToolDef; server: string }) {
  const t = () => props.tool
  // Native tools declare zod; MCP tools plain JSON Schema. Show both the same way.
  const schema = (): Record<string, any> => {
    const input = t().input
    if (input instanceof z.ZodType) {
      try {
        return z.toJSONSchema(input, { io: "input" }) as Record<string, any>
      } catch {
        return {}
      }
    }
    return input && typeof input === "object" ? (input as Record<string, any>) : {}
  }
  const params = () => {
    const s = schema()
    const required = new Set<string>(Array.isArray(s.required) ? s.required : [])
    return Object.entries((s.properties ?? {}) as Record<string, any>).map(([key, p]) => ({
      key,
      required: required.has(key),
      type: p?.type ? (Array.isArray(p.type) ? p.type.join("|") : String(p.type)) : p?.anyOf ? "nhiều kiểu" : p?.enum ? "enum" : "bất kỳ",
      description: typeof p?.description === "string" ? p.description.replace(/\s+/g, " ") : "",
    }))
  }
  const short = () => (t().displayName ?? t().name).split(" · ").pop()!
  return (
    // Only the description may shrink (and clip) when the pane is short; every other row keeps its line.
    <box flexDirection="column" marginTop={1}>
      <text flexShrink={0}>
        <span style={{ fg: color.tang, bold: true }}>{short()}</span>
        <span style={{ fg: toolBadge(t()).fg }}>{` ${toolBadge(t()).text}`}</span>
        {t().annotations?.openWorld ? <span style={{ fg: BADGE.openWorld.fg }}>{` ${BADGE.openWorld.text}`}</span> : ""}
      </text>
      <text fg={color.tx3} flexShrink={0}>{props.server}</text>
      <Field label="Tên tool">{short()}</Field>
      <Field label="Tên đầy đủ">{t().name}</Field>
      <text fg={color.tx} marginTop={1} flexShrink={0}>
        <span style={{ bold: true }}>Mô tả</span>
      </text>
      <text fg={color.tx2} wrapMode="word" overflow="hidden">
        {t().description.split("\n").slice(0, 8).join("\n")}
      </text>
      <text fg={color.tx} marginTop={1} flexShrink={0}>
        <span style={{ bold: true }}>{`Tham số${params().length === 0 ? ": không có" : ""}`}</span>
      </text>
      <For each={params().slice(0, 12)}>
        {(p) => (
          <text wrapMode="none" flexShrink={0}>
            <span style={{ fg: color.tx }}>{`  • ${p.key}`}</span>
            <span style={{ fg: color.tx3 }}>{truncate(`${p.required ? " (bắt buộc)" : ""}: ${p.type}${p.description ? ` - ${p.description}` : ""}`, 90)}</span>
          </text>
        )}
      </For>
      <Show when={params().length > 12}>
        <text fg={color.tx3} flexShrink={0}>{`  … và ${params().length - 12} tham số khác`}</text>
      </Show>
    </box>
  )
}
