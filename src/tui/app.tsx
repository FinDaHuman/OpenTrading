import type { InputRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { produce } from "solid-js/store"
import { chat, describeError, type ChatMessage } from "../core/chat"
import { connectedProviders } from "../core/auth"
import { loadConfig } from "../core/config"
import { loadCatalog } from "../core/catalog"
import { loadSkills } from "../core/skills"
import { Background } from "./background"
import { COMMANDS, parseCommand } from "./commands"
import { ConnectDialog } from "./dialogs/connect"
import { HelpDialog } from "./dialogs/help"
import { ModelDialog } from "./dialogs/model"
import { SkillsDialog, toggleSkill } from "./dialogs/skills"
import { Home } from "./home"
import { providerName, pushLine, setState, state } from "./state"
import { color } from "./theme"
import { Transcript } from "./transcript"

let abort: AbortController | undefined
/** Bumped by /clear so a stream that is still unwinding never touches the new transcript. */
let epoch = 0

export function clearTranscript() {
  epoch++
  abort?.abort()
  setState("lines", [])
}

async function send(text: string) {
  const history: ChatMessage[] = state.lines.flatMap((l) =>
    l.kind === "user" || (l.kind === "assistant" && l.text) ? [{ role: l.kind, content: l.text }] : [],
  )
  history.push({ role: "user", content: text })
  pushLine({ kind: "user", text })
  const index = state.lines.length
  pushLine({ kind: "assistant", text: "", done: false })
  const mine = epoch
  const edit = (fn: (line: { text: string; done: boolean }) => void) => {
    if (epoch === mine) setState(produce((s) => fn(s.lines[index] as { text: string; done: boolean })))
  }

  const controller = new AbortController()
  abort = controller
  setState("streaming", true)
  try {
    const skills = state.skills.filter((s) => state.activeSkills.includes(s.name))
    for await (const chunk of chat(history, skills, controller.signal)) edit((l) => (l.text += chunk))
  } catch (error) {
    if (epoch === mine) {
      const aborted = controller.signal.aborted
      // Drop the assistant placeholder if nothing streamed before the failure.
      if (!state.lines[index]?.text) setState("lines", (lines) => lines.filter((_, i) => i !== index))
      pushLine({ kind: aborted ? "info" : "error", text: aborted ? "Đã dừng." : describeError(error) })
    }
  } finally {
    if (state.lines[index]?.kind === "assistant") edit((l) => (l.done = true))
    setState("streaming", false)
    if (abort === controller) abort = undefined
  }
}

export function App() {
  const renderer = useRenderer()
  const dims = useTerminalDimensions()
  const [draft, setDraft] = createSignal("")
  const [selected, setSelected] = createSignal(0)
  let input: InputRenderable | undefined

  const exit = () => {
    abort?.abort()
    renderer.destroy()
    process.exit(0)
  }

  onMount(async () => {
    const [config, skills, catalog] = await Promise.all([loadConfig(), loadSkills(), loadCatalog()])
    const connected = await connectedProviders()
    // A key from an env var counts as connected even before /connect is used.
    setState({ provider: config.provider ?? connected[0], model: config.model, skills, catalog, connected })
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
      void send(text)
      return
    }
    switch (cmd.name) {
      case "connect":
      case "model":
      case "skills":
      case "help":
        return setState("dialog", cmd.name)
      case "skill":
        return cmd.args ? toggleSkill(cmd.args) : setState("dialog", "skills")
      case "clear":
        return clearTranscript()
      case "exit":
      case "quit":
        return exit()
      default:
        pushLine({ kind: "error", text: `Không có lệnh /${cmd.name}. Gõ /help.` })
    }
  }

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    if (evt.ctrl && evt.name === "c") return exit()
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
      </Switch>
    </box>
  )
}

function StatusBar() {
  const target = () =>
    state.provider ? `${providerName(state.provider)} · ${state.model ?? "chưa chọn model"}` : "chưa kết nối"
  return (
    <box flexDirection="row" height={1} backgroundColor={color.panel2} paddingLeft={2} paddingRight={2}>
      <text fg={color.bg} bg={color.tang}>
        {" ▲ OpenTrading "}
      </text>
      <text fg={color.tx2}>{` ${target()} `}</text>
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
