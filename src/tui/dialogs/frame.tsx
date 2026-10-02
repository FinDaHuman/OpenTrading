import { useTerminalDimensions } from "@opentui/solid"
import { Show, type JSX } from "solid-js"
import { color } from "../theme"

/**
 * Every dialog is a full-width pane docked where the prompt input sits (Claude Code style,
 * same as /mcp and the approval prompt): a rule on top, bold title, content, one dim hint
 * line. The transcript above shrinks; nothing floats over it.
 */
export function DialogFrame(props: { title: string; subtitle?: string; hint?: string; width?: number; children: JSX.Element }) {
  const dims = useTerminalDimensions()
  return (
    <box
      flexShrink={0}
      maxHeight={Math.max(8, dims().height - 4)}
      border={["top"]}
      borderColor={color.tang}
      backgroundColor={color.panel}
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
    >
      <text fg={color.tang} marginTop={1} wrapMode="none">
        <span style={{ bold: true }}>{props.title}</span>
      </text>
      <Show when={props.subtitle}>
        <text fg={color.tx3} wrapMode="none">
          {props.subtitle}
        </text>
      </Show>
      <box flexDirection="column" marginTop={1} flexShrink={1} minHeight={0} overflow="hidden">
        {props.children}
      </box>
      <text fg={color.tx3} marginTop={1} wrapMode="none">
        {props.hint ?? "↑↓ chọn · enter xác nhận · esc đóng"}
      </text>
    </box>
  )
}
