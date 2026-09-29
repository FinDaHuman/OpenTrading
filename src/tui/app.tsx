import type { InputRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { produce } from "solid-js/store"
import { runAgent } from "../core/agent"
import { connectedProviders } from "../core/auth"
import { describeError } from "../core/chat"
import { loadConfig } from "../core/config"
import { loadCatalog } from "../core/catalog"
import type { Runtime } from "../core/runtime"
import { ensureProfile } from "../core/profile"
import { loadSkills } from "../core/skills/loader"
import { Background } from "./background"
import { COMMANDS, parseCommand } from "./commands"
import { ConnectDialog } from "./dialogs/connect"
import { ContextDialog } from "./dialogs/context"
import { HelpDialog } from "./dialogs/help"
import { McpDialog } from "./dialogs/mcp"
import { MemoryDialog } from "./dialogs/memory"
import { SessionsDialog } from "./dialogs/sessions"
import { ModelDialog } from "./dialogs/model"
import { SkillsDialog, toggleSkill } from "./dialogs/skills"
import { ToolsDialog } from "./dialogs/tools"
import { Home } from "./home"
import { currentSession, recordTurn, resumeFromArgs, startSession } from "./session"
import { providerName, pushLine, setState, state, type Line } from "./state"
import { color } from "./theme"
import { Transcript } from "./transcript"

let abort: AbortController | undefined
/** Bumped by /clear so a stream that is still unwinding never touches the new transcript. */
let epoch = 0

/** /clear and /new: stop any running turn and start a fresh session. */
export async function clearTranscript(runtime: Runtime) {
  epoch++
  abort?.abort()
  await startSession(runtime, "clear")
}

function lineIndex(predicate: (line: Line) => boolean) {
  for (let i = state.lines.length - 1; i >= 0; i--) if (predicate(state.lines[i]!)) return i
  return -1
}

async function send(runtime: Runtime, text: string) {
  pushLine({ kind: "user", text })
  const mine = epoch
  const live = () => epoch === mine
  // Index of the assistant line currently receiving text; -1 after a tool call.
  let current = -1
  const edit = (index: number, fn: (line: any) => void) => {
    if (live() && index >= 0) setState(produce((s) => fn(s.lines[index])))
  }
  const closeText = () => {
    edit(current, (l) => (l.done = true))
    current = -1
  }

  const controller = new AbortController()
  abort = controller
  setState("streaming", true)
  try {
    const turn = runAgent({
      history: state.history,
      input: text,
      skills: state.skills,
      sticky: state.activeSkills,
      prevClock: state.clock,
      registry: runtime.registry,
      signal: controller.signal,
      sessionId: currentSession().id,
      hooks: runtime.hooks,
      memory: runtime.memory,
    })
    for await (const event of turn) {
      if (!live()) continue
      switch (event.type) {
        case "text-delta":
          if (current < 0) {
            pushLine({ kind: "assistant", text: "", done: false })
            current = state.lines.length - 1
          }
          edit(current, (l) => (l.text += event.text))
          break
        case "tool-start":
          closeText()
          pushLine({ kind: "tool", callId: event.callId, name: event.name, label: event.label, status: "running" })
          break
        case "tool-end":
          edit(
            lineIndex((l) => l.kind === "tool" && l.callId === event.callId),
            (l) => Object.assign(l, { status: event.ok ? "ok" : "error", output: event.output, durationMs: event.durationMs }),
          )
          break
        case "notice":
          pushLine({ kind: "info", text: event.text })
          break
        case "error":
          pushLine({ kind: "error", text: event.message })
          break
        case "done":
          if (event.messages.length > 0) {
            setState("history", (history) => [...history, ...event.messages])
            recordTurn(event.messages)
          }
          if (event.clock) setState("clock", event.clock)
          break
      }
    }
    if (live() && controller.signal.aborted) pushLine({ kind: "info", text: "Đã dừng." })
  } catch (error) {
    // Setup problems (no provider, model or key) are thrown before the turn starts.
    if (live()) pushLine({ kind: "error", text: describeError(error) })
  } finally {
    if (live()) {
      closeText()
      // Tools still marked running never got a result (aborted turn).
      setState(
        produce((s) => {
          for (const l of s.lines) if (l.kind === "tool" && l.status === "running") Object.assign(l, { status: "error", output: "Đã dừng." })
        }),
      )
    }
    setState("streaming", false)
    if (abort === controller) abort = undefined
  }
}

export function App(props: { runtime: Runtime; resume?: string }) {
  const renderer = useRenderer()
  const dims = useTerminalDimensions()
  const [draft, setDraft] = createSignal("")
  const [selected, setSelected] = createSignal(0)
  let input: InputRenderable | undefined

  let exiting = false
  /** Stop MCP servers (bounded to 2s) before leaving, so no child process is orphaned. */
  const exit = async () => {
    if (exiting) return
    exiting = true
    abort?.abort()
    await Promise.race([
      Promise.all([props.runtime.hooks.emit({ type: "session-end", sessionId: currentSession().id }), props.runtime.mcp.stop()]),
      new Promise((r) => setTimeout(r, 2000)),
    ])
    renderer.destroy()
    process.exit(0)
  }

  const offMcp = props.runtime.mcp.onChange((status) => setState("mcp", status))
  onCleanup(() => offMcp())

  onMount(async () => {
    void props.runtime.mcp.start()
    const [config, skillSet, catalog] = await Promise.all([loadConfig(), loadSkills(), loadCatalog()])
    const connected = await connectedProviders()
    // A key from an env var counts as connected even before /connect is used.
    setState({
      provider: config.provider ?? connected[0],
      model: config.model,
      skills: skillSet.skills,
      skillProblems: skillSet.problems,
      catalog,
      connected,
    })
    if (props.resume) await resumeFromArgs(props.runtime, props.resume)
    else await props.runtime.hooks.emit({ type: "session-start", sessionId: currentSession().id, source: "startup" })
    if (skillSet.problems.length > 0) {
      pushLine({ kind: "error", text: `${skillSet.problems.length} skill bị lỗi và không được nạp. Xem /skills.` })
    }
  })

  const suggestions = createMemo(() => {
    const d = draft()
    if (!d.startsWith("/") || d.includes(" ")) return []
    return COMMANDS.filter((c) => `/${c.name}`.startsWith(d.toLowerCase()))
  })

  function setInput(value: string) {
    if (input) {
      input.value = value
      input.cursorOffset = value.length
    }
    setDraft(value)
    setSelected(0)
  }

  /** Tab: fill in the highlighted command (with a trailing space if it takes arguments). */
  function complete() {
    const c = suggestions()[selected()]
    if (c) setInput(`/${c.name}${c.args ? " " : ""}`)
  }

  function run(value: string) {
    const text = value.trim()
    const highlighted = suggestions()[selected()]
    setInput("")
    if (!text) return
    const cmd = parseCommand(text)
    // Enter on a partial command ("/con") runs the highlighted suggestion.
    if (cmd && !COMMANDS.some((c) => c.name === cmd.name) && highlighted && !cmd.args) cmd.name = highlighted.name
    if (!cmd) {
      if (state.streaming) return
      void send(props.runtime, text)
      return
    }
    switch (cmd.name) {
      case "connect":
      case "model":
      case "skills":
      case "help":
      case "mcp":
      case "tools":
      case "context":
      case "sessions":
      case "memory":
        return setState("dialog", cmd.name)
      case "profile":
        return void ensureProfile().then(({ file, created }) =>
          pushLine({
            kind: "info",
            text: created
              ? `Đã tạo hồ sơ nhà đầu tư mẫu: ${file}. Mở file để sửa; OpenTrading đọc lại ở mỗi lượt hỏi.`
              : `Hồ sơ nhà đầu tư: ${file}. Sửa file này; thay đổi có hiệu lực từ lượt hỏi tiếp theo.`,
          }),
        )
      case "skill":
        return cmd.args ? toggleSkill(cmd.args) : setState("dialog", "skills")
      case "clear":
      case "new":
        return void clearTranscript(props.runtime)
      case "exit":
      case "quit":
        return void exit()
      default:
        pushLine({ kind: "error", text: `Không có lệnh /${cmd.name}. Gõ /help.` })
    }
  }

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    if (evt.ctrl && evt.name === "c") return void exit()
    if (evt.ctrl && evt.name === "o") return void setState("expandTools", (v) => !v)
    if (evt.name === "escape" && !state.dialog && state.streaming) abort?.abort()
    if (state.dialog || suggestions().length === 0) return
    const n = suggestions().length
    if (evt.name === "tab") {
      evt.preventDefault()
      complete()
    } else if (evt.name === "up" || evt.name === "down") {
      evt.preventDefault()
      setSelected((i) => (i + (evt.name === "up" ? n - 1 : 1)) % n)
    }
  })

  return (
    <box width={dims().width} height={dims().height} backgroundColor={color.bg}>
      <Background quiet={state.lines.length > 0} />
      <box position="absolute" left={0} top={0} width="100%" height="100%" zIndex={1} flexDirection="column">
        <Show when={state.lines.length > 0} fallback={<Home />}>
          <Transcript />
        </Show>

        <Show when={suggestions().length > 0}>
          <box flexDirection="column" marginLeft={3} marginRight={3} backgroundColor={color.panel} paddingLeft={1}>
            <For each={suggestions()}>
              {(c, i) => (
                <box flexDirection="row" backgroundColor={i() === selected() ? color.rule : undefined}>
                  <text fg={color.tang} width={18}>{`${i() === selected() ? "▸" : " "} /${c.name}${c.args ? ` ${c.args}` : ""}`}</text>
                  <text fg={color.tx3} flexGrow={1}>
                    {c.description}
                  </text>
                  <text fg={color.tx3}>{i() === selected() ? "tab ↹ " : ""}</text>
                </box>
              )}
            </For>
          </box>
        </Show>

        <box
          marginLeft={2}
          marginRight={2}
          border
          borderStyle="rounded"
          borderColor={state.streaming ? color.tham : state.dialog ? color.rule : color.tang}
          backgroundColor={color.panel2}
          flexDirection="row"
          height={3}
          paddingLeft={1}
        >
          <text fg={state.streaming ? color.tham : color.tang}>{"› "}</text>
          <input
            ref={(r) => (input = r)}
            flexGrow={1}
            focused={!state.dialog}
            placeholder={state.streaming ? "đang trả lời… esc để dừng" : "Hỏi về thị trường, hoặc gõ / để xem lệnh"}
            textColor={color.tx}
            focusedTextColor={color.tx}
            backgroundColor={color.panel2}
            focusedBackgroundColor={color.panel2}
            placeholderColor={color.tx3}
            onInput={(v) => {
              setDraft(v)
              setSelected(0)
            }}
            onSubmit={(v: unknown) => run(typeof v === "string" ? v : (input?.value ?? ""))}
          />
        </box>

        <StatusBar />
      </box>

      <Switch>
        <Match when={state.dialog === "connect"}>
          <ConnectDialog />
        </Match>
        <Match when={state.dialog === "model"}>
          <ModelDialog />
        </Match>
        <Match when={state.dialog === "skills"}>
          <SkillsDialog />
        </Match>
        <Match when={state.dialog === "help"}>
          <HelpDialog />
        </Match>
        <Match when={state.dialog === "mcp"}>
          <McpDialog mcp={props.runtime.mcp} />
        </Match>
        <Match when={state.dialog === "tools"}>
          <ToolsDialog registry={props.runtime.registry} />
        </Match>
        <Match when={state.dialog === "context"}>
          <ContextDialog runtime={props.runtime} />
        </Match>
        <Match when={state.dialog === "sessions"}>
          <SessionsDialog runtime={props.runtime} />
        </Match>
        <Match when={state.dialog === "memory"}>
          <MemoryDialog memory={props.runtime.memory} />
        </Match>
      </Switch>
    </box>
  )
}

function StatusBar() {
  const target = () =>
    state.provider ? `${providerName(state.provider)} · ${state.model ?? "chưa chọn model"}` : "chưa kết nối"
  const ready = () => state.mcp.filter((s) => s.state === "connected").length
  const attention = () => state.mcp.some((s) => s.state === "failed" || s.state === "untrusted")
  return (
    <box flexDirection="row" height={1} backgroundColor={color.panel2} paddingLeft={2} paddingRight={2}>
      <text fg={color.bg} bg={color.tang}>
        {" ▲ OpenTrading "}
      </text>
      <text fg={color.tx2}>{` ${target()} `}</text>
      <Show when={state.mcp.length > 0}>
        <text fg={attention() ? color.tham : color.san}>{` MCP ${ready()}/${state.mcp.length} `}</text>
      </Show>
      <Show when={state.activeSkills.length > 0}>
        <text fg={color.tran}>{` ✦ ${state.activeSkills.join(", ")}`}</text>
      </Show>
      <box flexGrow={1} />
      <text fg={state.streaming ? color.tham : color.tx3}>
        {state.streaming ? "● đang trả lời · esc dừng" : "/help · ctrl+c thoát"}
      </text>
    </box>
  )
}
