import { useKeyboard } from "@opentui/solid"
import { CARD_KIND_LABEL } from "../core/memory/notebook/render"
import type { MemoryProvider } from "../core/memory/types"
import { dismissCard, openCard } from "./cards"
import { setState, state, type Line } from "./state"
import { color } from "./theme"
import { enterGrace } from "./ui/clock"

/**
 * A suggestion card under the answer it came with (spec 007). It never takes the keys by itself: /goiy gives
 * them to it, then Enter opens the form (nothing is stored until the user confirms it), x dismisses, and Esc
 * (or any other key) gives them back to the prompt. Sending a new message is never a yes (design-v5 §6).
 *
 *   ┌ Gợi ý lưu · ràng buộc ─────────────────────────────┐
 *   │ Không gợi ý cổ phiếu penny                          │
 *   │ Bạn đã nói: "từ giờ đừng bao giờ gợi ý cổ phiếu …"  │
 *   │ Enter mở form · x bỏ qua · Esc về ô nhập            │
 *   └─────────────────────────────────────────────────────┘
 */

type CardLine = Extract<Line, { kind: "card" }>

export function CardRow(props: { line: CardLine }) {
  const c = () => props.line.card
  const focused = () => state.cardFocus === c().id
  const title = () =>
    `Gợi ý lưu · ${CARD_KIND_LABEL[c().kind]}${c().kind === "lesson" ? " (model đề xuất)" : ""}`
  const status = () => {
    if (props.line.state === "saved" && props.line.saved) return `✓ Đã lưu thành ${CARD_KIND_LABEL[props.line.saved.group]} #${props.line.saved.id}`
    if (props.line.state === "dismissed") return "Đã bỏ qua"
    return focused() ? "Enter mở form · x bỏ qua · Esc về ô nhập" : "Chưa lưu · gõ /goiy để chọn thẻ"
  }
  const pending = () => props.line.state === "pending"
  return (
    <box
      flexDirection="column"
      flexShrink={0}
      marginTop={1}
      border
      borderStyle="rounded"
      borderColor={focused() ? color.tang : pending() ? color.tham : color.rule}
      title={` ${title()} `}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={pending() ? color.tx : color.tx3} wrapMode="word">
        {c().kind === "lesson" ? `${c().title}: ${c().summary}` : c().text}
      </text>
      {c().quote ? (
        <text fg={color.tx3} wrapMode="word">
          {`Bạn đã nói: "${c().quote}"`}
        </text>
      ) : null}
      <text fg={focused() ? color.tang : color.tx3}>{status()}</text>
    </box>
  )
}

/** The keys of the focused card, mounted while it has them. */
export function CardKeys(props: { id: string; memory: MemoryProvider }) {
  // Enter right after the card takes the keys was meant for the prompt.
  const inGrace = enterGrace()
  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    evt.preventDefault()
    if (evt.name === "return") {
      if (!inGrace()) openCard(props.memory, props.id)
      return
    }
    if (evt.name === "x" && !evt.ctrl && !evt.meta) return dismissCard(props.id)
    // Esc or anything else: the prompt has the keys again; the card stays pending.
    setState("cardFocus", undefined)
  })
  return null
}
