import { useTerminalDimensions } from "@opentui/solid"
import { For, Show } from "solid-js"
import { noticeText, type NoticeLevel } from "./notify"
import { state } from "./state"
import { color } from "./theme"

/** opencode's SplitBorder: only the left and right edges, drawn as heavy bars. */
const SPLIT_BORDER = {
  topLeft: "",
  bottomLeft: "",
  vertical: "┃",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}

export const LEVEL_COLOR: Record<NoticeLevel, string> = { info: color.san, success: color.tang, warning: color.tham, error: color.giam }

/**
 * Warning and error cards floating in the top-right corner (opencode's ui/toast.tsx), newest
 * on top. They cover the transcript, never the prompt, and take no layout space.
 */
export function Toasts() {
  const dims = useTerminalDimensions()
  const width = () => Math.max(20, Math.min(60, dims().width - 6))
  return (
    <Show when={state.toasts.length > 0}>
      <box position="absolute" top={1} right={2} zIndex={5} flexDirection="column" gap={1} maxWidth={width()}>
        <For each={state.toasts}>
          {(toast) => (
            <box
              flexShrink={0}
              flexDirection="column"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={color.panel}
              border={["left", "right"]}
              borderColor={LEVEL_COLOR[toast.level]}
              customBorderChars={SPLIT_BORDER}
            >
              <Show when={toast.title}>
                <text fg={LEVEL_COLOR[toast.level]} wrapMode="word" selectable={false}>
                  <span style={{ bold: true }}>{toast.title}</span>
                </text>
              </Show>
              <text fg={color.tx} wrapMode="word">
                {toast.title ? toast.text : noticeText(toast)}
              </text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}
