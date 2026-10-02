import type { JSX } from "solid-js"
import { For, Show } from "solid-js"
import type { ToolDef } from "../../core/tools/types"
import { color } from "../theme"

/** A titled field row: bold label, value (status coloured). */
export function Field(props: { label: string; children: JSX.Element }) {
  return (
    <box flexDirection="row" height={1}>
      <text fg={color.tx} width={14} flexShrink={0}>
        <span style={{ bold: true }}>{props.label}</span>
      </text>
      <text fg={color.tx2} wrapMode="none">
        {props.children}
      </text>
    </box>
  )
}

/** Claude Code's tool detail: badges, names, description, parameters. */
export function ToolDetail(props: { tool: ToolDef; server: string }) {
  const t = () => props.tool
  const schema = () => (t().input && typeof t().input === "object" && !("_def" in (t().input as object)) ? (t().input as Record<string, any>) : {})
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
    <box flexDirection="column" marginTop={1}>
      <text>
        <span style={{ fg: color.tang, bold: true }}>{short()}</span>
        {t().readOnly ? <span style={{ fg: color.tang }}>{" [chỉ đọc]"}</span> : ""}
        {t().annotations?.destructive ? <span style={{ fg: color.giam }}>{" [phá huỷ]"}</span> : ""}
        {t().annotations?.openWorld ? <span style={{ fg: color.tx3 }}>{" [ra ngoài]"}</span> : ""}
        {!t().readOnly ? <span style={{ fg: color.tham }}>{" [hỏi trước khi chạy]"}</span> : ""}
      </text>
      <text fg={color.tx3}>{props.server}</text>
      <Field label="Tên tool">{short()}</Field>
      <Field label="Tên đầy đủ">{t().name}</Field>
      <text fg={color.tx} marginTop={1}>
        <span style={{ bold: true }}>Mô tả</span>
      </text>
      <text fg={color.tx2} wrapMode="word">
        {t().description.split("\n").slice(0, 8).join("\n")}
      </text>
      <text fg={color.tx} marginTop={1}>
        <span style={{ bold: true }}>{`Tham số${params().length === 0 ? ": không có" : ""}`}</span>
      </text>
      <For each={params().slice(0, 12)}>
        {(p) => (
          <text wrapMode="none">
            <span style={{ fg: color.tx }}>{`  • ${p.key}`}</span>
            <span style={{ fg: color.tx3 }}>{`${p.required ? " (bắt buộc)" : ""}: ${p.type}${p.description ? ` - ${p.description}` : ""}`}</span>
          </text>
        )}
      </For>
      <Show when={params().length > 12}>
        <text fg={color.tx3}>{`  … và ${params().length - 12} tham số khác`}</text>
      </Show>
    </box>
  )
}
