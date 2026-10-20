import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { state, type Line } from "./state"
import { color, markdownStyle } from "./theme"
import { ChartBox } from "./ui/chart-box"
import { truncate } from "./ui/text"
import { STREAM_CURSOR, streamView } from "./ui/stream-view"
import { useSpinner } from "./ui/clock"
import { fmtElapsed } from "./activity"
import { TODO_PREFIX } from "../core/tools/todos"
import { LOADED_PREFIX } from "../core/tools/search"
import { isSpawn, SubagentRow } from "./subagent-row"

/**
 * The conversation, in Claude Code's style (components/messages/*):
 *   ❯ what you typed
 *   ● an answer, or a tool call whose dot shows its state
 *     ⎿  the tool's result, a few lines, "… +N dòng (ctrl+o để mở rộng)"
 */

type ToolLine = Extract<Line, { kind: "tool" }>

const COLLAPSED_LINES = 3
const COLLAPSED_ERROR_LINES = 10
const RESULT = "  ⎿  "
const RESULT_CONT = "     "

function duration(ms?: number) {
  if (ms === undefined) return ""
  return ms < 1000 ? ` · ${ms}ms` : ` · ${(ms / 1000).toFixed(1)}s`
}

/** First lines of a tool's output, or all of it when ctrl+o is on. */
function preview(output: string, expanded: boolean, max: number) {
  const lines = output.replace(/\r\n/g, "\n").trimEnd().split("\n")
  // Claude Code: if exactly one line would be hidden, show it instead of "+1 line".
  if (expanded || lines.length <= max + 1) return { lines, hidden: 0 }
  return { lines: lines.slice(0, max), hidden: lines.length - max }
}

/** What a tool row says under its header, besides raw output. */
function summary(line: ToolLine): { tone: "ok" | "denied" | "answers"; lines: string[] } | undefined {
  const out = line.output ?? ""
  // The pinned panel shows the list; the transcript keeps one line (ctrl+o for the list).
  if (line.status === "ok" && out.startsWith(TODO_PREFIX) && !state.expandTools) return { tone: "ok", lines: [] }
  // A deferred tool called before loading: the call loaded it. One sentence; ctrl+o shows the
  // parameters the model got with it.
  if (line.status === "error" && out.startsWith(LOADED_PREFIX) && !state.expandTools) {
    return { tone: "ok", lines: [out.split("\n")[1] ?? out] }
  }
  if (line.status === "error" && out.startsWith("Người dùng từ chối chạy tool này")) {
    const note = /Lời nhắn của người dùng: (.*)$/s.exec(out)?.[1]
    return { tone: "denied", lines: [`✘ Đã từ chối${note ? ` — "${note.trim()}"` : ""}`] }
  }
  if (line.status === "ok" && out.startsWith("Người dùng đã trả lời:")) {
    const pairs = [...out.matchAll(/("(?:[^"\\]|\\.)*")=("(?:[^"\\]|\\.)*")/g)].map((m) => `· ${JSON.parse(m[1]!)} → ${JSON.parse(m[2]!)}`)
    if (pairs.length > 0) return { tone: "answers", lines: pairs }
  }
  return undefined
}

function ToolRow(props: { line: ToolLine; first: boolean; width: number }) {
  // Only running rows subscribe to the clock; finished ones cost nothing.
  const frame = useSpinner(() => props.line.status === "running")

  const waiting = () =>
    props.line.status === "running"
      ? state.approval?.callId === props.line.callId
        ? "Đang chờ bạn xác nhận…"
        : state.question?.callId === props.line.callId
          ? "Đang chờ bạn trả lời…"
          : undefined
      : undefined
  const dot = () => (waiting() ? "△" : props.line.status === "running" ? frame() : "●")
  const dotColor = () => (waiting() ? color.tham : props.line.status === "running" ? color.tham : props.line.status === "ok" ? color.tang : color.giam)
  const special = () => summary(props.line)
  const out = () =>
    preview(props.line.output ?? "", state.expandTools, props.line.status === "error" ? COLLAPSED_ERROR_LINES : COLLAPSED_LINES)
  const textWidth = () => Math.max(10, props.width - RESULT.length)

  /** First result line gets "  ⎿  ", the rest line up under it. */
  const prefix = (first: boolean) => (first && !props.line.decision ? RESULT : RESULT_CONT)

  return (
    <box flexDirection="column" marginTop={props.first ? 1 : 0} flexShrink={0}>
      <box flexDirection="row" height={1}>
        <Gutter glyph={dot()} fg={dotColor()} />
        <text wrapMode="none">
          <span style={{ fg: color.tx, bold: true }}>{truncate(props.line.label, props.width - 14)}</span>
          <span style={{ fg: color.tx3 }}>{duration(props.line.durationMs)}</span>
        </text>
      </box>
      <Show when={props.line.decision}>
        <ResultLine prefix={RESULT} text={props.line.decision!} fg={color.tx3} />
      </Show>
      <Switch>
        <Match when={waiting()}>
          <ResultLine prefix={prefix(true)} text={waiting()!} fg={color.tham} />
        </Match>
        <Match when={special()}>
          {(s) => (
            <For each={s().lines}>
              {(row, i) => <ResultLine prefix={prefix(i() === 0)} text={truncate(row, textWidth())} fg={s().tone === "denied" ? color.giam : color.tx2} />}
            </For>
          )}
        </Match>
        <Match when={props.line.output}>
          <For each={out().lines}>
            {(row, i) => (
              <ResultLine prefix={prefix(i() === 0)} text={truncate(row, textWidth(), true)} fg={props.line.status === "error" ? color.giam : color.tx3} />
            )}
          </For>
          <Show when={out().hidden > 0}>
            <ResultLine prefix={RESULT_CONT} text={`… +${out().hidden} dòng (ctrl+o để mở rộng)`} fg={color.tx3} />
          </Show>
        </Match>
      </Switch>
    </box>
  )
}

/**
 * Decorations (❯ ● ⎿ · ✘ and indents) are not selectable: highlighting a reply with the
 * mouse copies the words only.
 */
function Gutter(props: { glyph: string; fg: string }) {
  return (
    <text fg={props.fg} width={2} flexShrink={0} selectable={false}>
      {props.glyph}
    </text>
  )
}

/** One result line under a tool call: a fixed, unselectable "  ⎿  " prefix and the text. */
function ResultLine(props: { prefix: string; text: string; fg: string }) {
  return (
    <box flexDirection="row" height={1}>
      <text fg={color.tx3} width={RESULT.length} flexShrink={0} selectable={false}>
        {props.prefix}
      </text>
      <text fg={props.fg} wrapMode="none">
        {props.text}
      </text>
    </box>
  )
}

/** A glyph column and wrapped text that hangs under itself, not under the glyph. */
function Hanging(props: { glyph: string; glyphColor: string; text: string; fg: string; marginTop?: number; bg?: string }) {
  return (
    <box flexDirection="row" marginTop={props.marginTop ?? 1} flexShrink={0} backgroundColor={props.bg} paddingRight={props.bg ? 1 : 0}>
      <Gutter glyph={props.glyph} fg={props.glyphColor} />
      <text fg={props.fg} flexGrow={1} flexShrink={1} wrapMode="word">
        {props.text}
      </text>
    </box>
  )
}

function Row(props: { line: Line; prev?: Line; index: number; width: number }) {
  return (
    <Switch>
      <Match when={props.line.kind === "user"}>
        <Hanging glyph="❯" glyphColor={color.tx3} text={(props.line as Extract<Line, { kind: "user" }>).text} fg={color.tx} bg={color.panel2} />
      </Match>
      <Match when={props.line.kind === "assistant" && ((props.line as { text: string }).text.trim() || !(props.line as { done: boolean }).done) && props.line}>
        {(line) => <AssistantRow line={line() as Extract<Line, { kind: "assistant" }>} />}
      </Match>
      <Match when={isSpawn(props.line) && props.line}>
        {(line) => <SubagentRow line={line() as ToolLine} index={props.index} width={props.width} />}
      </Match>
      <Match when={props.line.kind === "tool" && props.line}>
        {/* Consecutive tool calls sit together; a new group gets a blank line above. */}
        {(line) => <ToolRow line={line() as ToolLine} first={props.prev?.kind !== "tool" || isSpawn(props.prev)} width={props.width} />}
      </Match>
      <Match when={props.line.kind === "chart" && props.line}>
        {(line) => <ChartBox data={(line() as Extract<Line, { kind: "chart" }>).data} width={props.width} />}
      </Match>
      <Match when={props.line.kind === "info"}>
        <Hanging glyph="·" glyphColor={color.tx3} text={(props.line as Extract<Line, { kind: "info" }>).text} fg={color.tx3} />
      </Match>
      <Match when={props.line.kind === "compact" && props.line}>
        {(line) => <CompactRow line={line() as Extract<Line, { kind: "compact" }>} />}
      </Match>
      <Match when={props.line.kind === "agent-notice" && props.line}>
        {(line) => {
          const l = line() as Extract<Line, { kind: "agent-notice" }>
          const fg = l.status === "xong" || l.status === "completed" ? color.tang : l.status === "lỗi" || l.status === "failed" ? color.giam : color.tx3
          return <Hanging glyph="◆" glyphColor={fg} text={l.text} fg={color.tx2} />
        }}
      </Match>
      <Match when={props.line.kind === "done" && props.line}>
        {(line) => {
          const l = line() as Extract<Line, { kind: "done" }>
          const bg = l.background ? ` · ${l.background} subagent nền vẫn chạy` : ""
          return <Hanging glyph="✻" glyphColor={color.tx3} text={`Xong sau ${fmtElapsed(l.ms)}${bg}`} fg={color.tx3} />
        }}
      </Match>
      <Match when={props.line.kind === "error"}>
        <Hanging glyph="✘" glyphColor={color.giam} text={(props.line as Extract<Line, { kind: "error" }>).text} fg={color.giam} />
      </Match>
    </Switch>
  )
}

/**
 * An answer, rendered as markdown (bold, lists, tables, code) instead of raw ** and *. While it
 * streams, only what `streamView` settles on reaches the renderer, and the memo hands it a new
 * string only when that changes, so a token inside an unfinished heading costs nothing.
 */
function AssistantRow(props: { line: Extract<Line, { kind: "assistant" }> }) {
  const scene = useRenderer().nativeScene
  const view = createMemo(() => streamView(props.line.text, props.line.done), undefined, {
    equals: (a, b) => a.markdown === b.markdown && a.heldTableRows === b.heldTableRows,
  })
  return (
    <box flexDirection="row" marginTop={1} flexShrink={0}>
      <Gutter glyph="●" fg={color.tx} />
      <box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Show when={view().markdown}>
          {/* Props are applied in order: content last, or nested list items are built
              before the style and block mode reach them (their highlight then fails raw). */}
          <markdown
            flexGrow={1}
            flexShrink={1}
            syntaxStyle={markdownStyle(scene)}
            internalBlockMode="top-level"
            conceal
            fg={color.tx}
            bg={color.bg}
            tableOptions={{ style: "grid" }}
            streaming={!props.line.done}
            content={view().markdown}
          />
        </Show>
        {/* Outside <markdown>: there the text would be parsed. */}
        <Show when={view().heldTableRows > 0}>
          <text fg={color.tx3} marginTop={view().markdown ? 1 : 0}>
            {`đang dựng bảng… (${view().heldTableRows} hàng)`}
          </text>
        </Show>
        <Show when={!view().markdown && !view().heldTableRows}>
          <text fg={color.tx3}>{STREAM_CURSOR.trim()}</text>
        </Show>
      </box>
    </box>
  )
}

const kTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/** "● Đã nén hội thoại (42k → 6k token)"; ctrl+o shows the summary that replaced the start. */
function CompactRow(props: { line: Extract<Line, { kind: "compact" }> }) {
  const scene = useRenderer().nativeScene
  const sizes = () =>
    props.line.before !== undefined && props.line.after !== undefined ? ` (~${kTokens(props.line.before)} → ~${kTokens(props.line.after)} token)` : ""
  const title = () =>
    props.line.summary !== undefined
      ? `Đã nén hội thoại${sizes()}${state.expandTools ? "" : " · ctrl+o xem tóm tắt"}`
      : `Đã dọn ${props.line.pruned ?? 0} kết quả tool cũ${sizes()}`
  return (
    <box flexDirection="column" marginTop={1} flexShrink={0}>
      <box flexDirection="row" height={1}>
        <Gutter glyph="●" fg={color.san} />
        <text fg={color.tx2} wrapMode="none">
          {title()}
        </text>
      </box>
      <Show when={state.expandTools && props.line.summary}>
        <box flexDirection="row" flexShrink={0}>
          <text fg={color.tx3} width={RESULT.length} flexShrink={0} selectable={false}>
            {RESULT}
          </text>
          <markdown flexGrow={1} flexShrink={1} content={props.line.summary!} syntaxStyle={markdownStyle(scene)} conceal fg={color.tx3} bg={color.bg} />
        </box>
      </Show>
    </box>
  )
}

/** Readable column centred over the tape; the animation stays visible in the side gutters. */
export function Transcript() {
  const dims = useTerminalDimensions()
  const width = () => Math.min(dims().width - 4, 110)
  return (
    <box flexGrow={1} flexShrink={1} minHeight={0} flexDirection="row" justifyContent="center">
      <scrollbox width={width()} stickyScroll stickyStart="bottom" backgroundColor={color.bg} paddingLeft={2} paddingRight={2} paddingBottom={1}>
        <For each={state.lines}>{(line, i) => <Row line={line} prev={state.lines[i() - 1]} index={i()} width={width() - 4} />}</For>
      </scrollbox>
    </box>
  )
}
