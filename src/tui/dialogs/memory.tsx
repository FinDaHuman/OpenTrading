import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import { notebookAdmin } from "../../core/memory/notebook/admin"
import { CARD_KIND_LABEL } from "../../core/memory/notebook/render"
import type { Runtime } from "../../core/runtime"
import { dismissCard, openCard, pendingCards } from "../cards"
import { closeDialog, setState, state, type MemoryTab } from "../state"
import { color } from "../theme"
import { enterGrace } from "../ui/clock"
import { useKeys } from "../ui/keys"
import { nextTab, TabRow } from "../ui/tabs"
import { truncate, width } from "../ui/text"
import { DialogFrame } from "./frame"
import { MemorySettings } from "./memory-settings"
import { NotebookDialog } from "./notebook"

const TABS: readonly MemoryTab[] = ["cards", "notebook", "settings"]
const TAB_HINT = "←/→ đổi tab · esc đóng"

/**
 * /memory, Claude Code's Settings style: three tabs on one row.
 *   Gợi ý       the suggestion cards still waiting (spec 007): enter opens the form filled in, x dismisses;
 *   Sổ ghi nhớ  the notebook itself (notebook.tsx);
 *   Cài đặt     memory on or off and the suggestion-card switch (also in /config › Memory).
 * It opens on Gợi ý while a card waits, else on Sổ ghi nhớ (app.tsx). ←/→ and tab/shift+tab switch tabs from
 * a list; never while an entry is open or a delete or a state change is being confirmed.
 */
export function MemoryDialog(props: { runtime: Runtime }) {
  // A tab with a view of its own open (an entry, a confirmation) keeps the keys.
  const [locked, setLocked] = createSignal(false)
  // The runtime's memory is replaced in place by the Cài đặt tab: `changed` makes the tabs read it again.
  const [changed, setChanged] = createSignal(0)
  const admin = createMemo(() => (changed(), notebookAdmin(props.runtime.memory)))

  const tabs = () => {
    const waiting = pendingCards().length
    return [
      { id: "cards" as const, label: waiting ? `Gợi ý (${waiting})` : "Gợi ý" },
      { id: "notebook" as const, label: "Sổ ghi nhớ" },
      { id: "settings" as const, label: "Cài đặt" },
    ]
  }
  const header = () => <TabRow title="Memory" tabs={tabs()} selected={state.memoryTab} />

  useKeys((evt) => {
    if (evt.eventType === "release" || locked() || evt.ctrl || evt.meta) return
    const to = nextTab(TABS, state.memoryTab, evt)
    if (to) {
      // The list's filter must not move its cursor or take the tab.
      evt.preventDefault()
      return setState("memoryTab", to)
    }
    // The notebook tab answers Esc itself (it also closes an open entry).
    if (evt.name === "escape" && state.memoryTab !== "notebook") closeDialog()
  })

  return (
    <Switch>
      <Match when={state.memoryTab === "cards"}>
        <CardsTab runtime={props.runtime} header={header()} />
      </Match>
      <Match when={state.memoryTab === "notebook"}>
        <Show when={admin()} keyed fallback={<NotebookOff header={header()} />}>
          {(a) => <NotebookDialog admin={a} redaction={props.runtime.redaction} header={header()} onLock={setLocked} />}
        </Show>
      </Match>
      <Match when={state.memoryTab === "settings"}>
        <MemorySettings
          runtime={props.runtime}
          header={header()}
          hint={`enter chọn · ${TAB_HINT}`}
          onChanged={() => setChanged((n) => n + 1)}
        />
      </Match>
    </Switch>
  )
}

function NotebookOff(props: { header: JSX.Element }) {
  return (
    <DialogFrame title="Memory" header={props.header} hint={TAB_HINT}>
      <text fg={color.tx2}>Memory đang tắt.</text>
      <text fg={color.tx3} marginTop={1} wrapMode="word">
        Bật Sổ ghi nhớ ở tab Cài đặt (→), có hiệu lực ngay, không cần mở lại OpenTrading.
      </text>
    </DialogFrame>
  )
}

/** The pending cards, oldest first; the highlighted one shows what the user said. */
function CardsTab(props: { runtime: Runtime; header: JSX.Element }) {
  const dims = useTerminalDimensions()
  const cards = () => pendingCards()
  const [index, setIndex] = createSignal(0)
  // A dismissed or saved card leaves the list: the highlight stays in range.
  const at = () => Math.min(index(), Math.max(0, cards().length - 1))
  // Enter right after /memory was typed belongs to the prompt.
  const inGrace = enterGrace()

  useKeys((evt) => {
    if (evt.eventType === "release") return
    const list = cards()
    if (list.length === 0) return
    const card = list[at()]!
    if (evt.name === "up") setIndex((at() - 1 + list.length) % list.length)
    else if (evt.name === "down") setIndex((at() + 1) % list.length)
    else if (evt.name === "return") {
      if (inGrace()) return
      // The form's first field takes focus under this key press: it must not also get the Enter.
      evt.preventDefault()
      openCard(props.runtime.memory, card.id)
    } else if (evt.name === "x" && !evt.ctrl && !evt.meta) dismissCard(card.id)
  })

  const text = (c: ReturnType<typeof pendingCards>[number]) => (c.kind === "lesson" ? `${c.title}: ${c.summary}` : c.text ?? "")

  return (
    <DialogFrame
      title="Memory"
      header={props.header}
      hint={cards().length ? `↑↓ chọn · enter mở form để lưu · x bỏ qua · ${TAB_HINT}` : TAB_HINT}
    >
      <Show
        when={cards().length > 0}
        fallback={
          <text fg={color.tx2} wrapMode="word">
            Không có thẻ gợi ý nào đang chờ. Khi bạn nói một điều nên nhớ, model có thể đề xuất lưu; thẻ hiện dưới câu trả lời và ở đây.
          </text>
        }
      >
        <For each={cards()}>
          {(c, i) => {
            const on = () => i() === at()
            const label = CARD_KIND_LABEL[c.kind]
            const kind = `${label.charAt(0).toLocaleUpperCase("vi")}${label.slice(1)}${c.kind === "lesson" ? " (model đề xuất)" : ""} · `
            return (
              <box flexDirection="column" flexShrink={0}>
                <text fg={on() ? color.tang : color.tx} wrapMode="none">
                  <span style={{ fg: on() ? color.tang : color.tx3 }}>{on() ? "› " : "  "}</span>
                  <span style={{ fg: color.tx3 }}>{kind}</span>
                  <span style={{ bold: on() }}>{truncate(text(c), Math.max(20, dims().width - 8 - width(kind)))}</span>
                </text>
                <Show when={on() && c.quote}>
                  <text fg={color.tx3} wrapMode="word" paddingLeft={4}>
                    {`Bạn đã nói: "${c.quote}"`}
                  </text>
                </Show>
              </box>
            )
          }}
        </For>
      </Show>
    </DialogFrame>
  )
}
