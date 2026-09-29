import { useTerminalDimensions } from "@opentui/solid"
import { createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { state, type Line } from "./state"
import { color, markdownStyle } from "./theme"

type ToolLine = Extract<Line, { kind: "tool" }>

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const COLLAPSED_LINES = 3

function duration(ms?: number) {
  if (ms === undefined) return ""
  return ms < 1000 ? ` ${ms}ms` : ` ${(ms / 1000).toFixed(1)}s`
}

/** First lines of a tool's output, or all of it when ctrl+o is on. */
function preview(output: string, expanded: boolean) {
  const lines = output.replace(/\r\n/g, "\n").trimEnd().split("\n")
  if (expanded || lines.length <= COLLAPSED_LINES) return { lines, hidden: 0 }
  return { lines: lines.slice(0, COLLAPSED_LINES), hidden: lines.length - COLLAPSED_LINES }
}

function ToolRow(props: { line: ToolLine }) {
  const [frame, setFrame] = createSignal(0)
  const timer = setInterval(() => {
    if (props.line.status === "running") setFrame((f) => (f + 1) % SPINNER.length)
  }, 90)
  onCleanup(() => clearInterval(timer))

  const mark = () => (props.line.status === "running" ? SPINNER[frame()]! : "•")
  const markColor = () => (props.line.status === "running" ? color.tham : props.line.status === "ok" ? color.tang : color.giam)
  const out = () => preview(props.line.output ?? "", state.expandTools)

  return (
    <box flexDirection="column" marginTop={1} paddingLeft={2}>
      <text>
        <span style={{ fg: markColor() }}>{`${mark()} `}</span>
        <span style={{ fg: color.san }}>{"⚙ "}</span>
        <span style={{ fg: color.tx2 }}>{props.line.label}</span>
        <span style={{ fg: color.tx3 }}>{duration(props.line.durationMs)}</span>
      </text>
      <Show when={props.line.output}>
        <box flexDirection="column" paddingLeft={2}>
          <For each={out().lines}>
            {(row, i) => (
              <text fg={props.line.status === "error" ? color.giam : color.tx3} wrapMode="char">
                {`${i() === 0 ? "└ " : "  "}${row}`}
              </text>
            )}
          </For>
          <Show when={out().hidden > 0}>
            <text fg={color.tx3}>{`  … ${out().hidden} dòng nữa (ctrl+o để xem hết)`}</text>
          </Show>
        </box>
      </Show>
    </box>
  )
}

function Row(props: { line: Line }) {
  return (
    <Switch>
      <Match when={props.line.kind === "user"}>
        <box flexDirection="row" marginTop={1} backgroundColor={color.panel2} paddingRight={1}>
          <text fg={color.tran}>{"▌ "}</text>
          <text fg={color.tx} flexGrow={1} flexShrink={1} wrapMode="word">
            {(props.line as Extract<Line, { kind: "user" }>).text}
          </text>
        </box>
      </Match>
      <Match when={props.line.kind === "assistant" && props.line}>
        {(line) => {
          const l = line() as Extract<Line, { kind: "assistant" }>
          return (
            <box flexDirection="column" marginTop={1} paddingLeft={2} flexShrink={0}>
              <text fg={color.tang}>{"◆ OpenTrading"}</text>
              {/* Models answer in markdown: render it (bold, lists, tables, code) instead of raw ** and *. */}
              <markdown
                content={l.text.trim() + (l.done ? "" : " ▍")}
                syntaxStyle={markdownStyle()}
                streaming={!l.done}
                conceal
                fg={color.tx}
                bg={color.bg}
                tableOptions={{ style: "grid" }}
              />
            </box>
          )
        }}
      </Match>
      <Match when={props.line.kind === "tool" && props.line}>{(line) => <ToolRow line={line() as ToolLine} />}</Match>
      <Match when={props.line.kind === "info"}>
        <text fg={color.tx3} marginTop={1} paddingLeft={2}>
          {"· " + (props.line as Extract<Line, { kind: "info" }>).text}
        </text>
      </Match>
      <Match when={props.line.kind === "error"}>
        <box flexDirection="row" marginTop={1} paddingLeft={2}>
          <text fg={color.giam}>{"✕ "}</text>
          <text fg={color.giam} flexShrink={1} wrapMode="word">
            {(props.line as Extract<Line, { kind: "error" }>).text}
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
    <box flexGrow={1} flexShrink={1} minHeight={0} flexDirection="row" justifyContent="center">
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
