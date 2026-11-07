import { useKeyboard } from "@opentui/solid"
import { createSignal } from "solid-js"
import { DialogFrame } from "./dialogs/frame"
import type { HoldChoice, TurnHoldCard } from "./state"
import { color } from "./theme"
import { enterGrace } from "./ui/clock"

/**
 * The card of a turn held before anything was sent: the investor profile or the user's constraints
 * could not be read. Nothing goes to the model until the user picks; the run-anyway button names
 * exactly the sources that failed, and applies to this turn only.
 *
 *   Chưa gửi câu hỏi: không đọc được hồ sơ nhà đầu tư (INVESTOR.md): không có quyền đọc file.
 *   ❯ Thử lại / Chạy lượt này không có hồ sơ / Huỷ
 */

const ROWS: HoldChoice[] = ["retry", "waive", "cancel"]

export function HoldCard(props: { card: TurnHoldCard }) {
  const [row, setRow] = createSignal<HoldChoice>("retry")
  // Enter right after the card appears was meant for the prompt.
  const inGrace = enterGrace()
  const label = (choice: HoldChoice) => (choice === "retry" ? "Thử lại" : choice === "waive" ? props.card.waive : "Huỷ")

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    evt.preventDefault()
    const at = ROWS.indexOf(row())
    if (evt.name === "up") return setRow(ROWS[(at + ROWS.length - 1) % ROWS.length]!)
    if (evt.name === "down" || evt.name === "tab") return setRow(ROWS[(at + 1) % ROWS.length]!)
    if (evt.name === "escape" || (evt.ctrl && evt.name === "c")) return props.card.choose("cancel")
    if (evt.name !== "return" || inGrace()) return
    props.card.choose(row())
  })

  return (
    <DialogFrame title="Chưa gửi câu hỏi" accent={color.tham} hint="↑↓ chọn · enter xác nhận · esc huỷ">
      <box flexDirection="column" flexShrink={0}>
        {props.card.text.split("\n").map((line) => (
          <text fg={color.tx} wrapMode="word">
            {line}
          </text>
        ))}
      </box>
      <box flexDirection="column" marginTop={1} flexShrink={0}>
        {ROWS.map((choice) => (
          <text fg={row() === choice ? color.tang : color.tx}>{`${row() === choice ? "❯ " : "  "}${label(choice)}`}</text>
        ))}
      </box>
    </DialogFrame>
  )
}
