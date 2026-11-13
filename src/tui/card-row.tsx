import { CARD_KIND_LABEL } from "../core/memory/notebook/render"
import type { Line } from "./state"
import { color } from "./theme"

/**
 * A suggestion card under the answer it came with (spec 007). It never takes the keys: it is saved or dismissed
 * on the Gợi ý tab of /memory, where Enter opens the form (nothing is stored until the user confirms it) and
 * x dismisses. Sending a new message is never a yes (design-v5 §6).
 *
 *   ┌ Gợi ý lưu · ràng buộc ─────────────────────────────┐
 *   │ Không gợi ý cổ phiếu penny                          │
 *   │ Bạn đã nói: "từ giờ đừng bao giờ gợi ý cổ phiếu …"  │
 *   │ Chưa lưu · /memory để lưu hoặc bỏ qua               │
 *   └─────────────────────────────────────────────────────┘
 */

type CardLine = Extract<Line, { kind: "card" }>

export function CardRow(props: { line: CardLine }) {
  const c = () => props.line.card
  const title = () =>
    `Gợi ý lưu · ${CARD_KIND_LABEL[c().kind]}${c().kind === "lesson" ? " (model đề xuất)" : ""}`
  const status = () => {
    if (props.line.state === "saved" && props.line.saved) return `✓ Đã lưu thành ${CARD_KIND_LABEL[props.line.saved.group]} #${props.line.saved.id}`
    if (props.line.state === "dismissed") return "Đã bỏ qua"
    return "Chưa lưu · /memory để lưu hoặc bỏ qua"
  }
  const pending = () => props.line.state === "pending"
  return (
    <box
      flexDirection="column"
      flexShrink={0}
      marginTop={1}
      border
      borderStyle="rounded"
      borderColor={pending() ? color.tham : color.rule}
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
      <text fg={color.tx3}>{status()}</text>
    </box>
  )
}
