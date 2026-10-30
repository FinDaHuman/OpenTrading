import { ScrollBoxRenderable } from "@opentui/core"
import { extend, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { attachTranscript, scrollAcceleration, scrollTranscript } from "./scroll"
import { state, type Line } from "./state"
import { color, markdownStyle } from "./theme"
import { ChartBox } from "./ui/chart-box"
import { truncate } from "./ui/text"
import { STREAM_CURSOR, streamView } from "./ui/stream-view"
import { useSpinner } from "./ui/clock"
import { fmtElapsed } from "./activity"
import { LEGACY_TODO_PREFIX, TODO_PREFIX } from "../core/tools/todos"
import { LOADED_PREFIX } from "../core/tools/search"
import { AUTO_BLOCK_PREFIX, USER_DENY_PREFIX, userNoteOf } from "../core/permission/denial"
import { isSpawn, SubagentRow } from "./subagent-row"
import { DESK_RUN } from "../core/desk/tool"
import { DeskCard, deskRunIdOf, isLiveRun, runSummary } from "./desk-card"

/**
 * The conversation, in Claude Code's style:
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
function summary(line: ToolLine): { tone: "ok" | "denied" | "answers"; lines: string[]; wrap?: boolean } | undefined {
  const out = line.output ?? ""
  // The pinned panel shows the list; the transcript keeps one line (ctrl+o for the list).
  if (line.status === "ok" && (out.startsWith(TODO_PREFIX) || out.startsWith(LEGACY_TODO_PREFIX)) && !state.expandTools) return { tone: "ok", lines: [] }
  // A deferred tool called before loading: the call loaded it. One sentence; ctrl+o shows the
  // parameters the model got with it.
  if (line.status === "error" && out.startsWith(LOADED_PREFIX) && !state.expandTools) {
    return { tone: "ok", lines: [out.split("\n")[1] ?? out], wrap: true }
  }
  // The live card under the row says the rest.
  if (line.name === DESK_RUN && line.status === "ok" && deskRunIdOf(out)) return { tone: "ok", lines: [out.split("\n")[0] ?? out] }
  // Auto mode's block: its summary line; ctrl+o shows what the model was told.
  if (line.status === "error" && out.startsWith(AUTO_BLOCK_PREFIX) && !state.expandTools) {
    return { tone: "denied", lines: [`✘ ${out.split("\n")[0]} · /permissions để cho thử lại`], wrap: true }
  }
  if (line.status === "error" && out.startsWith(USER_DENY_PREFIX)) {
    const note = userNoteOf(out)
    // A hand-off the user refused keeps auto mode's reason: "(auto mode đã chặn [nhãn]: lý do)".
    const auto = /^ \(auto mode đã chặn[^\n]*\)(?=\.)/.exec(out.slice(USER_DENY_PREFIX.length))?.[0] ?? ""
    return { tone: "denied", lines: [`✘ Đã từ chối${auto}${note ? ` — "${note}"` : ""}`], wrap: Boolean(auto) }
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
  // A deferred tool the call just loaded is not a failure: grey, not red.
  const loaded = () => (props.line.output ?? "").startsWith(LOADED_PREFIX)
  const outColor = () => (props.line.status === "error" && !loaded() ? color.giam : color.tx3)

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
              {(row, i) =>
                s().wrap ? (
                  <ResultLine prefix={prefix(i() === 0)} text={row} fg={color.tx2} wrap />
                ) : (
                  <ResultLine prefix={prefix(i() === 0)} text={truncate(row, textWidth())} fg={s().tone === "denied" ? color.giam : color.tx2} />
                )
              }
            </For>
          )}
        </Match>
        <Match when={props.line.output}>
          {/* ctrl+o shows every character: long lines wrap under the ⎿ column instead of ending in "…". */}
          <For each={out().lines}>
            {(row, i) => (
              <Show
                when={state.expandTools}
                fallback={<ResultLine prefix={prefix(i() === 0)} text={truncate(row, textWidth(), true)} fg={outColor()} />}
              >
                <ResultLine prefix={prefix(i() === 0)} text={row.replace(/\t/g, "  ").trimEnd()} fg={outColor()} wrap />
              </Show>
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

/** Under a desk_run row: the live card while the run goes, one line once it ended (ctrl+o: the card). */
function DeskRunBlock(props: { line: ToolLine; width: number }) {
  const run = () => {
    const id = deskRunIdOf(props.line.output)
    return id ? state.deskRuns[id] : undefined
  }
  return (
    <Show when={run()}>
      {(r) => (
        <Show
          when={isLiveRun(r()) || state.expandTools}
          fallback={<ResultLine prefix={RESULT_CONT} text={truncate(`◆ ${runSummary(r())} · ctrl+o xem · /desk`, Math.max(10, props.width - RESULT.length))} fg={r().status === "done" ? color.tang : color.tham} />}
        >
          <DeskCard run={r()} width={props.width} />
        </Show>
      )}
    </Show>
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

/**
 * One result line under a tool call: a fixed, unselectable "  ⎿  " prefix and the text.
 * `wrap`: the text may take several rows, each hanging under the first (not under ⎿).
 */
function ResultLine(props: { prefix: string; text: string; fg: string; wrap?: boolean }) {
  return (
    <box flexDirection="row" height={props.wrap ? undefined : 1} flexShrink={0}>
      <text fg={color.tx3} width={RESULT.length} flexShrink={0} selectable={false}>
        {props.prefix}
      </text>
      <text fg={props.fg} wrapMode={props.wrap ? "word" : "none"} flexGrow={props.wrap ? 1 : 0} flexShrink={props.wrap ? 1 : 0}>
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
      <Match when={props.line.kind === "user" && props.line}>
        {(line) => {
          const l = line() as Extract<Line, { kind: "user" }>
          return (
            <box flexDirection="column" flexShrink={0}>
              <Hanging glyph="❯" glyphColor={color.tx3} text={l.text} fg={color.tx} bg={color.panel2} />
              {/* Files the message @-attached: read before the turn, like Claude Code's "⎿ Read …". */}
              <For each={l.files ?? []}>
                {(file, i) => (
                  <ResultLine prefix={i() === 0 ? RESULT : RESULT_CONT} text={truncate(file.note, Math.max(10, props.width - RESULT.length))} fg={file.ok ? color.tx3 : color.giam} />
                )}
              </For>
            </box>
          )
        }}
      </Match>
      <Match when={props.line.kind === "assistant" && ((props.line as { text: string }).text.trim() || !(props.line as { done: boolean }).done) && props.line}>
        {(line) => <AssistantRow line={line() as Extract<Line, { kind: "assistant" }>} />}
      </Match>
      <Match when={isSpawn(props.line) && props.line}>
        {(line) => <SubagentRow line={line() as ToolLine} index={props.index} width={props.width} />}
      </Match>
      <Match when={props.line.kind === "tool" && props.line}>
        {/* Consecutive tool calls sit together; a new group gets a blank line above. */}
        {(line) => (
          <>
            <ToolRow line={line() as ToolLine} first={props.prev?.kind !== "tool" || isSpawn(props.prev)} width={props.width} />
            <Show when={(line() as ToolLine).name === DESK_RUN}>
              <DeskRunBlock line={line() as ToolLine} width={props.width} />
            </Show>
          </>
        )}
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
          const head = l.unanswered ? "Dừng khi chưa có câu trả lời" : "Xong"
          return <Hanging glyph="✻" glyphColor={l.unanswered ? color.tham : color.tx3} text={`${head} sau ${fmtElapsed(l.ms)}${bg}`} fg={color.tx3} />
        }}
      </Match>
      <Match when={props.line.kind === "warning"}>
        <Hanging glyph="▲" glyphColor={color.tham} text={(props.line as Extract<Line, { kind: "warning" }>).text} fg={color.tx2} />
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

/** The chat's scrollbox; it pings after each frame so the view can check where it stands. */
class TranscriptBox extends ScrollBoxRenderable {
  onFrame?: () => void

  protected override onUpdate(deltaTime: number): void {
    super.onUpdate(deltaTime)
    this.onFrame?.()
  }

  /** Scrolled up from the bottom (by more than the row sticky scrolling tolerates). */
  get away() {
    return this.scrollTop < Math.max(0, this.scrollHeight - this.viewport.height) - 1
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    ot_transcript: typeof TranscriptBox
  }
}

extend({ ot_transcript: TranscriptBox })

/** Readable column centred over the tape; the tape shows (still) in the side gutters. */
export function Transcript() {
  const dims = useTerminalDimensions()
  const width = () => Math.min(dims().width - 4, 110)
  // Scrolled up: a chip at the bottom says how to get back, and whether more came meanwhile.
  const [away, setAway] = createSignal(false)
  const [fresh, setFresh] = createSignal(false)
  let seenHeight = 0
  let pending: ReturnType<typeof setTimeout> | undefined
  // Pinged during a frame, before its layout: look once the frame is done, so a height that
  // grew in this very frame counts (an idle renderer may draw no next frame to report it).
  const check = (box: TranscriptBox) => {
    pending ??= setTimeout(() => {
      pending = undefined
      if (box.isDestroyed) return
      const isAway = box.away
      if (isAway !== away()) {
        seenHeight = box.scrollHeight
        setFresh(false)
        setAway(isAway)
      } else if (isAway && !fresh() && box.scrollHeight > seenHeight) setFresh(true)
    }, 0)
  }
  onCleanup(() => {
    clearTimeout(pending)
    attachTranscript(undefined)
  })
  return (
    <box flexGrow={1} flexShrink={1} minHeight={0} flexDirection="row" justifyContent="center">
      <ot_transcript
        ref={(box: TranscriptBox) => {
          box.onFrame = () => check(box)
          attachTranscript(box)
        }}
        width={width()}
        stickyScroll
        stickyStart="bottom"
        scrollAcceleration={scrollAcceleration(state.scroll)}
        backgroundColor={color.bg}
        paddingLeft={2}
        paddingRight={2}
        paddingBottom={1}
      >
        <For each={state.lines}>{(line, i) => <Row line={line} prev={state.lines[i() - 1]} index={i()} width={width() - 4} />}</For>
      </ot_transcript>
      <Show when={away()}>
        <box position="absolute" bottom={0} right={4} zIndex={2}>
          <text fg={color.bg} bg={fresh() ? color.san : color.tx3} wrapMode="none" selectable={false} onMouseDown={() => scrollTranscript("bottom")}>
            {fresh() ? " ↓ có nội dung mới · ctrl+end " : " ↓ ctrl+end xuống cuối "}
          </text>
        </box>
      </Show>
    </box>
  )
}
