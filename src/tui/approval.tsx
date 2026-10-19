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
 * The gate decides which choices a request offers (`request.choices`); a write shows its diff.
 */

const LABEL: Record<Choice, string> = {
  once: "Có",
  session: "Có, cả phiên này",
  always: "Luôn cho phép",
  mode: "Có, và chuyển sang ▸ sửa có hỏi",
  deny: "Không",
}

const MAX_ARGS = 3
const MAX_VALUE = 60
/** Diff lines shown in the prompt at most (fewer on a short terminal); the rest is counted. */
const MAX_DIFF = 16

function preview(value: unknown) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : JSON.stringify(value)
  return truncate(text ?? "", MAX_VALUE)
}

/** A long path loses its start, not the file name and the "(mới, 42 dòng)" after it. */
export const keepEnd = (text: string, max: number) => (text.length <= max ? text : `…${text.slice(text.length - Math.max(1, max - 1))}`)

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
  mode: "lần này, chuyển sang ▸ sửa có hỏi",
  deny: "",
}

/**
 * A subagent's prompt can pop up while the user is typing (background agents): it takes no
 * digit shortcuts at all, and Enter pressed this soon after it appears is ignored, so keys
 * meant for the input never approve it.
 */
export const ANSWER_GUARD_MS = 400

/** What the scope says the call is about, for the title. */
function kindOf(req: ApprovalRequest): string {
  const scope = req.scope ?? ""
  if (scope.startsWith("secret:")) return req.effect ? "ghi vào file chứa khoá/mật khẩu" : "đọc file chứa khoá/mật khẩu"
  if (scope.startsWith("unc:")) return "đọc đường dẫn mạng"
  if (scope.startsWith("odd:")) return "đường dẫn Windows dạng lạ"
  if (scope.startsWith("protected:")) return req.effect === "shell" ? "lệnh đụng tới file khoá, cấu hình hoặc tự chạy khi đăng nhập" : "ghi vào vùng được bảo vệ (cấu hình, dữ liệu OpenTrading)"
  if (scope.startsWith("outside:") && req.effect === "shell") return "chạy lệnh ngoài workspace"
  if (scope.startsWith("outside:")) return "ghi ngoài workspace"
  if (scope === "lap-lai") return "model gọi lặp lại cùng một lời gọi"
  if (req.mode === "read-only" && req.effect) return "đang ở chế độ ‖ chỉ đọc"
  if (req.annotations?.destructive) return "thay đổi không hoàn tác được"
  if (scope.startsWith("domain:")) return `đọc trang từ domain mới: ${scope.slice("domain:".length)}`
  if (req.effect === "file") return "ghi file"
  if (req.effect === "shell") return "chạy lệnh"
  return "tool ghi"
}

function hintOf(choice: Choice, req: ApprovalRequest): string {
  const scope = req.scope ?? ""
  switch (choice) {
    case "once":
      return "chạy lần này"
    case "session":
      if (/^(secret|unc|odd):/.test(scope)) return "không hỏi lại đúng file này tới khi thoát"
      if (scope.startsWith("domain:")) return "không hỏi lại domain này tới khi thoát"
      if (scope.startsWith("cmd:")) return `không hỏi lại lệnh \`${truncate(scope.slice("cmd:".length), 30)} …\` tới khi thoát`
      if (scope.startsWith("cmd!")) return "không hỏi lại đúng lệnh này tới khi thoát"
      if (scope.startsWith("edit:")) return `không hỏi lại khi ghi file trong ${truncate(scope.slice("edit:".length), 40)} (cả thư mục con) tới khi thoát`
      return "không hỏi lại tool này tới khi thoát"
    case "always":
      if (scope.startsWith("cmd:")) return `lưu vào cấu hình: lệnh \`${truncate(scope.slice("cmd:".length), 30)} …\``
      return scope.startsWith("domain:") ? "lưu vào cấu hình, cho domain này" : "lưu vào cấu hình, cho đúng server này"
    case "mode":
      return "các lần ghi sau vẫn hỏi; shift+tab để đổi lại"
    case "deny":
      return "model nhận thông báo bị từ chối · tab để kèm lời nhắn"
  }
}

export function ApprovalPrompt(props: { gate: PermissionGate; request: ApprovalRequest; subagents?: SubagentManager }) {
  const [selected, setSelected] = createSignal(0)
  // The prompt is keyed on the request in app.tsx, so each request mounts afresh.
  const shownAt = Date.now()
  const [noting, setNoting] = createSignal(false)
  let note = ""
  const req = () => props.request
  const destructive = () => req().annotations?.destructive === true
  const options = () => req().choices
  const denyIndex = () => options().length - 1
  const args = () => argLines(req().input)
  const description = () => req().description.split("\n").filter(Boolean).slice(0, req().preview ? 0 : 2)
  const diff = () => req().preview?.diff ?? []
  const warn = () => destructive() || /^(secret|unc|odd|protected|outside):/.test(req().scope ?? "")

  function choose(index: number, message?: string) {
    const choice = options()[index]
    if (!choice) return
    // The decision belongs under its tool call in the transcript (Claude Code); a denial
    // already shows there from the tool's error, so only "allowed" needs recording.
    const row = state.lines.findIndex((l) => l.kind === "tool" && l.callId === req().callId)
    const agent = req().agent
    if (agent && props.subagents) {
      props.subagents.recordDecision(agent.id, req().callId, choice === "deny" ? `✘ Đã từ chối${message ? ` — "${message}"` : ""}` : `✓ Đã cho phép ${RECORD[choice]}`)
    } else if (row >= 0) {
      if (choice !== "deny") setState("lines", row, (l) => ({ ...l, decision: `✓ Đã cho phép ${RECORD[choice]}` }))
    } else {
      pushLine({
        kind: "info",
        text: choice === "deny" ? `Đã từ chối ${req().label}${message ? ` — "${message}"` : ""}` : `Đã cho phép ${req().label} ${RECORD[choice]}`,
      })
    }
    void props.gate.respond(req().id, choice, message)
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
  // Title, label, question, choices and hint take about 12 rows; the diff gets what is left.
  const diffRows = () => Math.max(3, Math.min(MAX_DIFF, dims().height - 12 - options().length))

  return (
    <DialogFrame
      title={`Cần xác nhận · ${kindOf(req())}` + (req().agent ? ` · subagent ${req().agent!.type} (${truncate(req().agent!.description, 30)})` : "")}
      accent={warn() ? color.giam : color.tham}
      hint={
        noting()
          ? "enter từ chối kèm lời nhắn · esc quay lại"
          : req().agent
            ? "↑↓ chọn · enter xác nhận · tab từ chối kèm lời nhắn · esc từ chối"
            : `↑↓ chọn · enter xác nhận · 1-${options().length} chọn nhanh · tab từ chối kèm lời nhắn · esc từ chối`
      }
    >
      <box flexDirection="column" paddingLeft={2} flexShrink={0}>
        <text flexShrink={0}>
          {req().agent ? <span style={{ fg: color.tham }}>{`${req().agent!.type} › `}</span> : ""}
          <span style={{ fg: color.tx, bold: true }}>
            {req().preview ? `${req().tool}  ${keepEnd(req().preview!.title, room() - req().tool.length - 4)}` : truncate(req().label, room() - 30)}
          </span>
          {destructive() ? <span style={{ fg: BADGE.irreversible.fg }}>{`  ${BADGE.irreversible.text}`}</span> : ""}
          {req().annotations?.openWorld ? <span style={{ fg: BADGE.openWorld.fg }}>{`  ${BADGE.openWorld.text}`}</span> : ""}
        </text>
        <Show
          when={req().preview}
          fallback={
            <>
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
            </>
          }
        >
          <For each={diff().slice(0, diffRows())}>
            {(line) => (
              <text fg={line.kind === "+" ? color.tang : line.kind === "-" ? color.giam : color.tx3} wrapMode="none" flexShrink={0}>
                {truncate(line.kind === "…" ? "  …" : `${line.kind} ${line.text}`, room())}
              </text>
            )}
          </For>
          <Show when={diff().length > diffRows()}>
            <text fg={color.tx3} flexShrink={0}>{`… còn ${diff().length - diffRows()} dòng (+${req().preview!.added ?? 0} −${req().preview!.removed ?? 0})`}</text>
          </Show>
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
        {(choice, i) => {
          const active = () => i() === selected()
          return (
            <box flexDirection="row" height={1} flexShrink={0}>
              <text fg={active() ? color.tang : color.tx3} width={5} flexShrink={0} selectable={false}>
                {active() ? "❯ " : "  "}
                <span style={{ fg: color.tx3 }}>{`${i() + 1}.`}</span>
              </text>
              <text fg={active() ? color.tang : color.tx} width={choice === "mode" ? 34 : 20} flexShrink={0}>
                {LABEL[choice]}
              </text>
              <text fg={color.tx3} wrapMode="none">
                {hintOf(choice, req())}
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
