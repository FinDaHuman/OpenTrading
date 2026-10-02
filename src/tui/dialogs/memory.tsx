import { truncate } from "../ui/text"
import { useKeys } from "../ui/keys"
import { createMemo, createResource, createSignal, Match, Show, Switch } from "solid-js"
import type { MemoryItem, MemoryProvider } from "../../core/memory/types"
import { closeDialog, pushLine } from "../state"
import { color } from "../theme"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

/**
 * Review memory: proposals from the model stay "pending" (never used) until approved here —
 * the propose → approve flow Cursor used, so no memory becomes an invisible instruction.
 */
export function MemoryDialog(props: { memory: MemoryProvider }) {
  const [items, { refetch }] = createResource(async () => (await props.memory.list?.()) ?? [])
  const [open, setOpen] = createSignal<string>()
  const selected = createMemo(() => items()?.find((i) => i.id === open()))
  const manageable = Boolean(props.memory.list)

  async function act(action: "approve" | "reject" | "remove", item: MemoryItem) {
    await props.memory[action]?.(item.id)
    pushLine({
      kind: "info",
      text: `${action === "approve" ? "Đã duyệt" : action === "reject" ? "Đã bỏ" : "Đã xoá"} memory: ${truncate(item.text, 60)}`,
    })
    setOpen(undefined)
    await refetch()
  }

  useKeys((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "escape") return open() ? setOpen(undefined) : closeDialog()
    const item = selected()
    if (!item) return
    if (item.status === "pending" && evt.name === "a") void act("approve", item)
    else if (item.status === "pending" && evt.name === "r") void act("reject", item)
    else if (item.status === "active" && evt.name === "d") void act("remove", item)
  })

  return (
    <Switch>
      <Match when={!manageable}>
        <DialogFrame title="Memory" hint="esc đóng">
          <text fg={color.tx2}>{`Memory đang tắt (provider: ${props.memory.id}).`}</text>
          <text fg={color.tx3} marginTop={1} wrapMode="word">
            Bật memory trong /config (có hiệu lực ngay, không cần mở lại OpenTrading).
          </text>
        </DialogFrame>
      </Match>
      <Match when={selected()}>
        {(item) => (
          <DialogFrame
            title={item().status === "pending" ? "Memory chờ duyệt" : "Memory đang dùng"}
            hint={item().status === "pending" ? "a duyệt · r bỏ · esc quay lại" : "d xoá · esc quay lại"}
           
          >
            <text fg={color.tx} wrapMode="word">
              {item().text}
            </text>
            <text fg={color.tx3} marginTop={1}>
              {`${item().source?.via === "model" ? "Model đề xuất" : "Người dùng ghi"} · ${item().createdAt.slice(0, 16).replace("T", " ")}`}
            </text>
          </DialogFrame>
        )}
      </Match>
      <Match when={true}>
        <DialogFrame title={`Memory · ${items()?.length ?? 0}`} hint="enter xem · esc đóng">
          <Show
            when={(items() ?? []).length > 0}
            fallback={<text fg={color.tx2}>Chưa có memory. Nói "Ghi nhớ: …" trong chat, hoặc để model đề xuất.</text>}
          >
            <Picker
              items={(items() ?? []).map((i) => ({
                label: truncate(i.text, 70),
                hint: i.status === "pending" ? "chờ duyệt" : "đang dùng",
                mark: i.status === "pending" ? "?" : "●",
                value: i.id,
              }))}
              onPick={setOpen}
              rows={10}
            />
          </Show>
        </DialogFrame>
      </Match>
    </Switch>
  )
}
