import { useTerminalDimensions } from "@opentui/solid"
import { For, Match, Switch } from "solid-js"
import { state, type Line } from "./state"
import { color } from "./theme"

function Row(props: { line: Line }) {
  return (
    <Switch>
      <Match when={props.line.kind === "user"}>
        <box flexDirection="row" marginTop={1} backgroundColor={color.panel2} paddingRight={1}>
          <text fg={color.tran}>{"▌ "}</text>
          <text fg={color.tx} flexGrow={1} flexShrink={1} wrapMode="word">
            {props.line.text}
          </text>
        </box>
      </Match>
      <Match when={props.line.kind === "assistant" && props.line}>
        {(line) => {
          const l = line() as Extract<Line, { kind: "assistant" }>
          return (
            <box flexDirection="column" marginTop={1} paddingLeft={2}>
              <text fg={color.tang}>{"◆ OpenTrading"}</text>
              <text fg={color.tx} flexShrink={1} wrapMode="word">
                {l.text + (l.done ? "" : "▍")}
              </text>
            </box>
          )
        }}
      </Match>
      <Match when={props.line.kind === "info"}>
        <text fg={color.tx3} marginTop={1} paddingLeft={2}>
          {"· " + props.line.text}
        </text>
      </Match>
      <Match when={props.line.kind === "error"}>
        <box flexDirection="row" marginTop={1} paddingLeft={2}>
          <text fg={color.giam}>{"✕ "}</text>
          <text fg={color.giam} flexShrink={1} wrapMode="word">
            {props.line.text}
          </text>
        </box>
      </Match>
    </Switch>
  )
}

/** Readable column centred over the tape; the animation stays visible in the side gutters. */
export function Transcript() {
  const dims = useTerminalDimensions()
  return (
    <box flexGrow={1} flexDirection="row" justifyContent="center">
      <scrollbox
        width={Math.min(dims().width - 4, 110)}
        stickyScroll
        stickyStart="bottom"
        backgroundColor={color.bg}
        paddingLeft={2}
        paddingRight={2}
        paddingBottom={1}
      >
        <For each={state.lines}>{(line) => <Row line={line} />}</For>
      </scrollbox>
    </box>
  )
}
