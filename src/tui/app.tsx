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
import { ApprovalPrompt } from "./approval"
import { AskPrompt } from "./ask"
import { McpPanel } from "./mcp/panel"
import { rank } from "./ui/text"
import { COMMANDS, parseCommand, parsePromptArgs, promptUsage, type CommandInfo } from "./commands"
import { ConfigDialog } from "./dialogs/config"
import { ConnectDialog } from "./dialogs/connect"
import { ContextDialog } from "./dialogs/context"
import { HelpDialog } from "./dialogs/help"
import { MemoryDialog } from "./dialogs/memory"
import { SessionsDialog } from "./dialogs/sessions"
import { ModelDialog } from "./dialogs/model"
import { SkillsDialog, toggleSkill } from "./dialogs/skills"
import { ToolsDialog } from "./dialogs/tools"
import { Home } from "./home"
import { currentSession, recordTurn, resumeFromArgs, startSession } from "./session"
import { armExit, closeDialog, flash, onExitRequest, providerName, pushLine, setState, state, type Line } from "./state"
import { color } from "./theme"
import { cleanSelection, writeClipboard } from "./clipboard"
import { ArgumentHint, Suggestions } from "./suggestions"
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

/** The turn being answered, so exit can wait for it to be saved. */
let inflight: Promise<void> | undefined

function send(runtime: Runtime, text: string) {
  const turn = sendTurn(runtime, text)
  inflight = turn
  return turn.finally(() => {
    if (inflight === turn) inflight = undefined
  })
}

async function sendTurn(runtime: Runtime, text: string) {
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

export function App(props: {
  runtime: Runtime
  resume?: string
  /** Tests replace the final step (destroy the renderer, end the process). */
  onExit?: () => void
}) {
  const renderer = useRenderer()
  const dims = useTerminalDimensions()
  const [draft, setDraft] = createSignal("")
  const [selected, setSelected] = createSignal(0)
  /**
   * Who owns the keyboard instead of the prompt: an approval or a question from the model.
   * Every rule that hides the prompt, closes dialogs or reroutes Esc goes through this.
   */
  const owner = () => state.approval ?? state.question
  /** Draft at which Esc closed the "/" list; it reopens as soon as the draft changes. */
  const [dismissedFor, setDismissedFor] = createSignal<string>()
  let input: InputRenderable | undefined

  /**
   * Leave: stop the running answer and wait — under one 2 s deadline — for it to be saved,
   * the session-end hook and MCP servers to stop (no orphaned child process), then restore
   * the terminal.
   */
  const exit = async () => {
    if (state.exiting) return
    if (props.onExit) return props.onExit()
    setState("exiting", true)
    abort?.abort()
    await Promise.race([
      Promise.all([
        inflight ?? Promise.resolve(),
        props.runtime.hooks.emit({ type: "session-end", sessionId: currentSession().id }),
        props.runtime.mcp.stop(),
      ]),
      new Promise((r) => setTimeout(r, 2000)),
    ])
    renderer.destroy()
    process.exit(0)
  }
  onExitRequest(() => void exit())
  onCleanup(() => onExitRequest(undefined))

  /** Copy what the mouse highlighted (opencode's copy-on-select); true when something was copied. */
  function copySelection() {
    const text = cleanSelection(renderer.getSelection()?.getSelectedText() ?? "")
    renderer.clearSelection()
    if (!text) return false
    writeClipboard(text, (t) => renderer.copyToClipboardOSC52(t))
    flash(`✓ Đã copy ${[...text].length} ký tự`)
    return true
  }
  // A finished drag copies at once — no keystroke needed, like Claude Code in a terminal.
  const onSelection = () => {
    copySelection()
    // A click/drag moves focus to what was clicked; typing must still go to the prompt.
    if (!state.dialog && !owner()) input?.focus()
  }
  renderer.on("selection", onSelection)
  onCleanup(() => renderer.off("selection", onSelection))

  const offMcp = props.runtime.mcp.onChange((status) => setState("mcp", status))
  onCleanup(() => offMcp())

  // Tools with side effects ask first. A pending question takes over the keyboard: any open
  // dialog closes so its keys cannot also act on the prompt.
  props.runtime.permissions.interactive = true
  // Questions from the model (ask_user) take over the same way; approval goes first.
  props.runtime.questions.interactive = true
  const offQuestion = props.runtime.questions.onChange((head) => {
    if (head && state.dialog) setState("dialog", undefined)
    setState("question", head)
  })
  const offApproval = props.runtime.permissions.onChange((head) => {
    if (head && state.dialog) setState("dialog", undefined)
    setState("approval", head)
  })
  onCleanup(() => {
    offApproval()
    offQuestion()
    props.runtime.questions.interactive = false
    props.runtime.questions.cancelAll()
    props.runtime.permissions.interactive = false
    props.runtime.permissions.denyAll()
  })

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

  /** MCP prompts as `/server:prompt` commands, from every connected server. */
  const promptCommands = createMemo<(CommandInfo & { server: string; prompt: string })[]>(() =>
    state.mcp.flatMap((s) =>
      s.state === "connected"
        ? s.prompts.map((p) => ({
            name: `${s.name}:${p.name}`,
            args: promptUsage(p.arguments) || undefined,
            argsRequired: p.arguments.some((a) => a.required),
            description: p.description?.split("\n")[0] ?? `Prompt của MCP server ${s.name}`,
            server: s.name,
            prompt: p.name,
          }))
        : [],
    ),
  )

  const allCommands = createMemo<CommandInfo[]>(() => [...COMMANDS, ...promptCommands()])

  /**
   * The "/" list, Claude Code style: open while the draft is "/" + a command name (no
   * space yet), ranked (exact, prefix, substring, description), and closed by Esc until
   * the draft changes.
   */
  const suggestions = createMemo(() => {
    const d = draft()
    if (!d.startsWith("/") || /\s/.test(d) || d === dismissedFor()) return []
    return rank(allCommands(), d.slice(1), (c) => c.name, (c) => c.description)
  })

  /** After "/name " (with the space): the arguments the command takes, shown under the list's place. */
  const argHint = createMemo(() => {
    const m = /^\/(\S+) $/.exec(draft())
    if (!m) return undefined
    const c = allCommands().find((x) => x.name.toLowerCase() === m[1]!.toLowerCase())
    return c?.args ? c : undefined
  })

  /** `/mcp enable|disable|reconnect <name>` without opening the panel (as in Claude Code). */
  async function mcpCommand(args: string) {
    const [action, name] = args.split(/\s+/)
    const known = state.mcp.some((s) => s.name === name)
    if (!name || !known || !["enable", "disable", "reconnect"].includes(action ?? "")) {
      return pushLine({ kind: "error", text: "Dùng: /mcp enable|disable|reconnect <tên server> (hoặc /mcp để mở bảng quản lý)." })
    }
    try {
      if (action === "reconnect") await props.runtime.mcp.restart(name)
      else await props.runtime.mcp.setEnabled(name, action === "enable")
      const s = state.mcp.find((x) => x.name === name)
      pushLine({ kind: "info", text: `MCP "${name}": ${s ? s.state : "?"}${s?.error ? ` — ${s.error}` : ""}` })
    } catch (error) {
      pushLine({ kind: "error", text: `/mcp ${action} ${name}: ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  /** Fetch an MCP prompt with the typed arguments and send it as the user's message. */
  async function runPrompt(command: { server: string; prompt: string; name: string }, rawArgs: string) {
    const info = state.mcp.find((s) => s.name === command.server)?.prompts.find((p) => p.name === command.prompt)
    if (!info) return pushLine({ kind: "error", text: `Không còn prompt /${command.name}.` })
    const parsed = parsePromptArgs(info.arguments, rawArgs)
    if ("error" in parsed) return pushLine({ kind: "error", text: `/${command.name}: ${parsed.error}` })
    try {
      const text = await props.runtime.mcp.getPrompt(command.server, command.prompt, parsed.values)
      if (!text.trim()) return pushLine({ kind: "error", text: `Prompt /${command.name} không có nội dung.` })
      // What is sent in the user's name is shown in full as their message.
      pushLine({ kind: "info", text: `Prompt /${command.name} của server ${command.server}:` })
      void send(props.runtime, text)
    } catch (error) {
      pushLine({ kind: "error", text: `/${command.name}: ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  function setInput(value: string) {
    if (input) {
      input.value = value
      input.cursorOffset = value.length
    }
    setDraft(value)
    setSelected(0)
    if (value !== dismissedFor()) setDismissedFor(undefined)
  }

  /**
   * Ctrl+C / Ctrl+D like Claude Code: the first press does the nearest useful thing and
   * says "press again to exit"; a second press within 800 ms exits. Ctrl+C with text
   * highlighted copies it instead. Ctrl+D only counts on an empty prompt.
   */
  function onQuitKey(name: "c" | "d") {
    if (name === "c" && renderer.hasSelection && copySelection()) return
    const key = name === "c" ? "Ctrl+C" : "Ctrl+D"
    if (name === "d" && (draft() || owner() || state.dialog)) return
    if (state.exitArmed === key) return void exit()
    if (name === "c") {
      // An approval or question answers Ctrl+C itself (like Esc: deny / skip).
      if (owner()) {
        // handled by the prompt's own keyboard hook
      } else if (state.dialog) closeDialog()
      else if (draft()) setInput("")
      else if (state.streaming) abort?.abort()
    }
    armExit(key)
  }

  /** Tab: put the highlighted command in the input ("/name ") without running it; the list closes. */
  function complete() {
    const c = suggestions()[selected()]
    if (c) setInput(`/${c.name} `)
  }

  /**
   * Enter. With the "/" list open it runs the highlighted command — or, when the command
   * cannot run without arguments, fills "/name " and waits (Claude Code). Otherwise a
   * "/…" line is a command (unknown ones are reported, never sent to the model) and
   * anything else is a message.
   */
  function run(value: string) {
    const text = value.trim()
    const list = suggestions()
    const highlighted = list[selected()]
    if (highlighted && list.length > 0) {
      if (highlighted.argsRequired) return setInput(`/${highlighted.name} `)
      setInput("")
      return runCommand(highlighted.name.toLowerCase(), "")
    }
    if (!text) return setInput("")
    const cmd = parseCommand(text)
    if (!cmd) {
      if (text.startsWith("/")) return setInput("") // "/" alone or "/ text": nothing to run, nothing to send
      setInput("")
      if (state.streaming) return
      void send(props.runtime, text)
      return
    }
    const known = allCommands().some((c) => c.name.toLowerCase() === cmd.name) || cmd.name === "quit"
    if (!known) {
      // Keep what was typed so it can be fixed.
      return pushLine({ kind: "error", text: `Không có lệnh /${cmd.name}. Gõ /help để xem các lệnh.` })
    }
    setInput("")
    runCommand(cmd.name, cmd.args)
  }

  function runCommand(name: string, args: string) {
    const cmd = { name, args }
    const promptCmd = promptCommands().find((c) => c.name.toLowerCase() === cmd.name)
    if (promptCmd) {
      if (state.streaming) return pushLine({ kind: "error", text: "Đang trả lời; chờ xong rồi chạy prompt." })
      return void runPrompt(promptCmd, cmd.args)
    }
    switch (cmd.name) {
      case "connect":
      case "model":
      case "skills":
      case "help":
      case "tools":
      case "context":
      case "sessions":
      case "memory":
      case "config":
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
      case "mcp":
        return cmd.args ? void mcpCommand(cmd.args) : setState("dialog", "mcp")
      case "clear":
      case "new":
        return void clearTranscript(props.runtime)
      case "exit":
      case "quit":
        return void exit()
      default:
        pushLine({ kind: "error", text: `Không có lệnh /${cmd.name}. Gõ /help để xem các lệnh.` })
    }
  }

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    if (evt.ctrl && (evt.name === "c" || evt.name === "d")) return onQuitKey(evt.name)
    if (evt.ctrl && evt.name === "o") return void setState("expandTools", (v) => !v)
    if (evt.name === "escape" && renderer.hasSelection) return renderer.clearSelection()
    if (owner() || state.dialog) return
    const n = suggestions().length
    // Esc closes the "/" list first (it stays closed until the draft changes) and never
    // also stops the running answer.
    if (evt.name === "escape" && n > 0) {
      evt.preventDefault()
      setDismissedFor(draft())
      return
    }
    if (evt.name === "escape" && state.streaming) return void abort?.abort()
    // With the list closed, Tab and the arrows do nothing special (no autofill).
    if (n === 0) return
    if (evt.name === "tab") {
      evt.preventDefault()
      complete()
    } else if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      setSelected((i) => (i + n - 1) % n)
    } else if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      setSelected((i) => (i + 1) % n)
    }
  })

  return (
    <box width={dims().width} height={dims().height} backgroundColor={color.bg}>
      <Background quiet={state.lines.length > 0} />
      <box position="absolute" left={0} top={0} width="100%" height="100%" zIndex={1} flexDirection="column">
        {/* Tall panels below (/mcp, approval) shrink this area; clip it instead of letting
            flexbox squeeze rows on top of each other. */}
        <box flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden" flexDirection="column">
          <Show when={state.lines.length > 0} fallback={<Show when={!state.dialog}>{<Home />}</Show>}>
            <Transcript />
          </Show>
        </box>

        <Show when={suggestions().length > 0 && !owner() && !state.dialog}>
          <Suggestions items={suggestions()} all={allCommands()} selected={selected()} />
        </Show>
        <Show when={!owner() && !state.dialog && suggestions().length === 0 && argHint()}>
          {(c) => <ArgumentHint command={c()} />}
        </Show>

        {/* The approval prompt and /mcp take the input's place; the input is hidden, not
            unmounted, so a half-typed message survives. */}
        <Show when={state.approval}>{(request) => <ApprovalPrompt gate={props.runtime.permissions} request={request()} />}</Show>
        <Show when={!state.approval && state.question} keyed>
          {(request) => <AskPrompt broker={props.runtime.questions} request={request} />}
        </Show>
        {/* Every dialog is a pane docked here, in place of the prompt (Claude Code style). */}
        <Show when={!owner()}>
          <Switch>
            <Match when={state.dialog === "mcp"}>
              <McpPanel mcp={props.runtime.mcp} cwd={props.runtime.mcp.cwd} />
            </Match>
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
              <HelpDialog onRun={(command) => run(command)} />
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
            <Match when={state.dialog === "config"}>
              <ConfigDialog runtime={props.runtime} />
            </Match>
            <Match when={state.dialog === "memory"}>
              <MemoryDialog memory={props.runtime.memory} />
            </Match>
          </Switch>
        </Show>

        <box
          visible={!owner() && !state.dialog}
          marginLeft={2}
          marginRight={2}
          border={["top", "bottom"]}
          borderColor={state.streaming ? color.tham : state.dialog ? color.rule : color.tang}
          backgroundColor={color.panel2}
          flexDirection="row"
          height={3}
          flexShrink={0}
          paddingLeft={1}
        >
          <text fg={state.streaming ? color.tham : color.tang}>{"› "}</text>
          <input
            ref={(r) => (input = r)}
            flexGrow={1}
            focused={!state.dialog && !owner()}
            placeholder={state.streaming ? "đang trả lời… esc để dừng" : "Hỏi về thị trường, hoặc gõ / để xem lệnh"}
            textColor={color.tx}
            focusedTextColor={color.tx}
            backgroundColor={color.panel2}
            focusedBackgroundColor={color.panel2}
            placeholderColor={color.tx3}
            onInput={(v) => {
              setDraft(v)
              setSelected(0)
              // A dismissed list stays closed only until the draft changes.
              if (v !== dismissedFor()) setDismissedFor(undefined)
            }}
            onSubmit={(v: unknown) => run(typeof v === "string" ? v : (input?.value ?? ""))}
          />
        </box>

        <StatusBar />
      </box>

    </box>
  )
}

function StatusBar() {
  const target = () =>
    state.provider ? `${providerName(state.provider)} · ${state.model ?? "chưa chọn model"}` : "chưa kết nối"
  const ready = () => state.mcp.filter((s) => s.state === "connected").length
  const attention = () => state.mcp.some((s) => s.state === "failed" || s.state === "untrusted")
  return (
    <box flexDirection="row" height={1} flexShrink={0} backgroundColor={color.panel2} paddingLeft={2} paddingRight={2}>
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
      <text fg={state.flash ? color.tang : state.streaming ? color.tham : color.tx3} flexShrink={0} selectable={false}>
        {state.exiting
          ? "Đang thoát…"
          : state.exitArmed
            ? `Nhấn ${state.exitArmed} lần nữa để thoát`
            : state.flash
              ? state.flash
              : state.approval
                ? "△ cần bạn xác nhận · esc từ chối"
                : state.question
                  ? "△ model đang hỏi bạn · esc bỏ qua"
                  : state.streaming
                    ? "● đang trả lời · esc dừng"
                    : "/ lệnh · /help · ctrl+c ×2 thoát"}
      </text>
    </box>
  )
}
