import { useTerminalDimensions } from "@opentui/solid"
import type { JSX } from "solid-js"
import { color } from "../theme"

export function DialogFrame(props: { title: string; hint?: string; width?: number; children: JSX.Element }) {
  const dims = useTerminalDimensions()
  const width = () => Math.min(props.width ?? 64, dims().width - 4)
  return (
    <box
      position="absolute"
      zIndex={20}
      left={Math.max(0, Math.floor((dims().width - width()) / 2))}
      top={Math.max(1, Math.floor(dims().height / 6))}
      width={width()}
      flexDirection="column"
      backgroundColor={color.panel}
      border
      borderStyle="rounded"
      borderColor={color.tang}
      title={` ${props.title} `}
      titleAlignment="left"
      paddingLeft={1}
      paddingRight={1}
    >
      {props.children}
      <text fg={color.tx3} marginTop={1}>
        {props.hint ?? "↑↓ chọn · enter xác nhận · esc đóng"}
      </text>
    </box>
  )
}
