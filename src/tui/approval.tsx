import { useKeyboard } from "@opentui/solid"
import { createSignal, For, Show } from "solid-js"
import type { ApprovalRequest, Choice, PermissionGate } from "../core/permission"
import type { SubagentManager } from "../core/subagents/manager"
import { pushLine, setState, state } from "./state"
import { DialogFrame } from "./dialogs/frame"
import { color } from "./theme"
import { truncate } from "./ui/text"
import { useTerminalDimensions } from "@opentui/solid"
import { BADGE } from "./ui/badges"

/**
 * "Cần xác nhận" — shown in place of the prompt input while a tool with side effects
 * waits for the user. Layout after Claude Code's permission prompt (title on a top rule,
 * the call, a short description, "Do you want to proceed?"), options after Codex
 * (numbered, with a description column, digits pick directly, ≤3 argument previews).
 */

const OPTIONS: { choice: Choice; label: string; hint: string }[] = [
  { choice: "once", label: "Có", hint: "chạy lần này" },
  { choice: "session", label: "Có, cả phiên này", hint: "không hỏi lại tool này tới khi thoát" },
  { choice: "always", label: "Luôn cho phép", hint: "lưu vào cấu hình, cho đúng server này" },
  { choice: "deny", label: "Không", hint: "model nhận thông báo bị từ chối · tab để kèm lời nhắn" },
]

const MAX_ARGS = 3
const MAX_VALUE = 60

function preview(value: unknown) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : JSON.stringify(value)
  return truncate(text ?? "", MAX_VALUE)
}

export function argLines(input: unknown) {
  const entries = input && typeof input === "object" && !Array.isArray(input) ? Object.entries(input) : []
  return {
    lines: entries.slice(0, MAX_ARGS).map(([k, v]) => `${k}: ${preview(v)}`),
    more: Math.max(0, entries.length - MAX_ARGS),
  }
}

const RECORD: Record<Choice, string> = {
  once: "lần này",
  session: "cho cả phiên",
  always: "luôn luôn",
  deny: "",
}

/**
 * A subagent's prompt can pop up while the user is typing (background agents): it takes no
 * digit shortcuts at all, and Enter pressed this soon after it appears is ignored, so keys
 * meant for the input never approve it.
 */
export const ANSWER_GUARD_MS = 400

export function ApprovalPrompt(props: { gate: PermissionGate; request: ApprovalRequest; subagents?: SubagentManager }) {
  const [selected, setSelected] = createSignal(0)
  // The prompt is keyed on the request in app.tsx, so each request mounts afresh.
  const shownAt = Date.now()
  const [noting, setNoting] = createSignal(false)
  let note = ""
  const req = () => props.request
  const destructive = () => req().annotations?.destructive === true
  /** web_fetch asks per domain: a read, not a write. */
  const domain = () => (req().scope?.startsWith("domain:") ? req().scope!.slice("domain:".length) : undefined)
  const hintOf = (option: (typeof OPTIONS)[number]) =>
    sensitive() && option.choice === "session"
      ? "không hỏi lại đúng file này tới khi thoát"
      : domain() && option.choice === "session"
      ? "không hỏi lại domain này tới khi thoát"
      : domain() && option.choice === "always"
        ? "lưu vào cấu hình, cho domain này"
        : option.hint
  /** A key file or a network path: asked per exact path, never stored as "always". */
  const sensitive = () => {
    const scope = req().scope ?? ""
    if (scope.startsWith("secret:")) return { kind: "đọc file chứa khoá/mật khẩu", path: scope.slice("secret:".length) }
    if (scope.startsWith("unc:")) return { kind: "đọc đường dẫn mạng", path: scope.slice("unc:".length) }
    if (scope.startsWith("odd:")) return { kind: "đường dẫn Windows dạng lạ", path: scope.slice("odd:".length) }
    return undefined
  }
  const options = () => (sensitive() ? OPTIONS.filter((o) => o.choice !== "always") : OPTIONS)
  const denyIndex = () => options().length - 1
  const args = () => argLines(req().input)
  const description = () => req().description.split("\n").filter(Boolean).slice(0, 2)

  function choose(index: number, message?: string) {
    const option = options()[index]
    if (!option) return
    // The decision belongs under its tool call in the transcript (Claude Code); a denial
    // already shows there from the tool's error, so only "allowed" needs recording.
    const row = state.lines.findIndex((l) => l.kind === "tool" && l.callId === req().callId)
    const agent = req().agent
    if (agent && props.subagents) {
      props.subagents.recordDecision(agent.id, req().callId, option.choice === "deny" ? `✘ Đã từ chối${message ? ` — "${message}"` : ""}` : `✓ Đã cho phép ${RECORD[option.choice]}`)
    } else if (row >= 0) {
      if (option.choice !== "deny") setState("lines", row, (l) => ({ ...l, decision: `✓ Đã cho phép ${RECORD[option.choice]}` }))
    } else {
      pushLine({
        kind: "info",
        text:
          option.choice === "deny"
            ? `Đã từ chối ${req().label}${message ? ` — "${message}"` : ""}`
            : `Đã cho phép ${req().label} ${RECORD[option.choice]}`,
      })
    }
    void props.gate.respond(req().id, option.choice, message)
    setSelected(0)
    setNoting(false)
    note = ""
  }

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    // Ctrl+C answers "no" like Esc (opencode); the app only arms the double-press exit.
    if (evt.ctrl && evt.name === "c") return choose(denyIndex())
    if (noting()) {
      if (evt.name === "escape") {
        evt.preventDefault()
        note = ""
        setNoting(false)
      }
      return // the note input handles everything else; enter submits through onSubmit
    }
    evt.preventDefault()
    const early = !!req().agent && Date.now() - shownAt < ANSWER_GUARD_MS
    if (early && evt.name === "return") return
    const count = options().length
    if (evt.name === "up") setSelected((i) => (i + count - 1) % count)
    else if (evt.name === "down") setSelected((i) => (i + 1) % count)
    else if (evt.name === "return") choose(selected())
    else if (evt.name === "escape") choose(denyIndex())
    else if (evt.name === "tab") {
      note = ""
      setSelected(denyIndex())
      setNoting(true)
    } else if (/^[1-9]$/.test(evt.name ?? "") && Number(evt.name) <= count && !req().agent) choose(Number(evt.name) - 1)
  })

  const dims = useTerminalDimensions()
  const room = () => Math.max(20, dims().width - 10)

  return (
    <DialogFrame
      title={
        (sensitive() ? `Cần xác nhận · ${sensitive()!.kind}` : destructive() ? "Cần xác nhận · thay đổi không hoàn tác được" : domain() ? `Cần xác nhận · đọc trang từ domain mới: ${domain()}` : "Cần xác nhận · tool ghi") +
        (req().agent ? ` · subagent ${req().agent!.type} (${truncate(req().agent!.description, 30)})` : "")
      }
      accent={destructive() ? color.giam : color.tham}
      hint={
        noting()
          ? "enter từ chối kèm lời nhắn · esc quay lại"
          : req().agent
            ? "↑↓ chọn · enter xác nhận · tab từ chối kèm lời nhắn · esc từ chối"
            : `↑↓ chọn · enter xác nhận · 1-${options().length} chọn nhanh · tab từ chối kèm lời nhắn · esc từ chối`
      }
    >
      <box flexDirection="column" paddingLeft={2}>
        <text>
          {req().agent ? <span style={{ fg: color.tham }}>{`${req().agent!.type} › `}</span> : ""}
          <span style={{ fg: color.tx, bold: true }}>{truncate(req().label, room() - 30)}</span>
          {destructive() ? <span style={{ fg: BADGE.irreversible.fg }}>{`  ${BADGE.irreversible.text}`}</span> : ""}
          {req().annotations?.openWorld ? <span style={{ fg: BADGE.openWorld.fg }}>{`  ${BADGE.openWorld.text}`}</span> : ""}
        </text>
        <For each={args().lines}>
          {(line) => (
            <text fg={color.tx2} wrapMode="none">
              {truncate(line, room())}
            </text>
          )}
        </For>
        <Show when={args().more > 0}>
          <text fg={color.tx3}>{`+${args().more} tham số khác`}</text>
        </Show>
        <For each={description()}>
          {(line) => (
            <text fg={color.tx3} wrapMode="none">
              {truncate(line, room())}
            </text>
          )}
        </For>
      </box>
      <text fg={color.tx} marginTop={1}>
        <span style={{ bold: true }}>Cho phép chạy?</span>
      </text>
      <For each={options()}>
        {(option, i) => {
          const active = () => i() === selected()
          return (
            <box flexDirection="row" height={1} flexShrink={0}>
              <text fg={active() ? color.tang : color.tx3} width={5} flexShrink={0} selectable={false}>
                {active() ? "❯ " : "  "}
                <span style={{ fg: color.tx3 }}>{`${i() + 1}.`}</span>
              </text>
              <text fg={active() ? color.tang : color.tx} width={20} flexShrink={0}>
                {option.label}
              </text>
              <text fg={color.tx3} wrapMode="none">
                {hintOf(option)}
              </text>
            </box>
          )
        }}
      </For>
      <Show when={noting()}>
        <box flexDirection="row" marginTop={1}>
          <text fg={color.tham} flexShrink={0}>{"Lời nhắn cho model: "}</text>
          <input
            flexGrow={1}
            focused
            value=""
            placeholder="ví dụ: dùng repo khác"
            textColor={color.tx}
            focusedTextColor={color.tx}
            backgroundColor={color.panel2}
            focusedBackgroundColor={color.panel2}
            onInput={(v: string) => (note = v)}
            onSubmit={() => choose(denyIndex(), note.trim() || undefined)}
          />
        </box>
      </Show>
    </DialogFrame>
  )
}
