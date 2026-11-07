import type { MemoryProvider } from "../../core/memory/types"
import { notebookAdmin } from "../../core/memory/notebook/admin"
import type { RedactionCheck } from "../../core/memory/redaction/check"
import { closeDialog } from "../state"
import { useKeys } from "../ui/keys"
import { color } from "../theme"
import { DialogFrame } from "./frame"
import { NotebookDialog } from "./notebook"

/** /memory: the notebook's own screen, or how to turn memory on. */
export function MemoryDialog(props: { memory: MemoryProvider; redaction?: RedactionCheck }) {
  const admin = notebookAdmin(props.memory)
  if (admin) return <NotebookDialog admin={admin} redaction={props.redaction} />
  return <MemoryOff />
}

function MemoryOff() {
  useKeys((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") closeDialog()
  })
  return (
    <DialogFrame title="Memory" hint="esc đóng">
      <text fg={color.tx2}>Memory đang tắt.</text>
      <text fg={color.tx3} marginTop={1} wrapMode="word">
        Bật Sổ ghi nhớ trong /config (có hiệu lực ngay, không cần mở lại OpenTrading).
      </text>
    </DialogFrame>
  )
}
