import { useKeys } from "../ui/keys"
import { createResource, Match, Switch } from "solid-js"
import type { Runtime } from "../../core/runtime"
import { listSessions } from "../../core/session/store"
import { currentSession, resumeSession } from "../session"
import { closeDialog, state } from "../state"
import { say } from "../notify"
import { color } from "../theme"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

function when(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Pick a stored session and continue it. */
export function SessionsDialog(props: { runtime: Runtime }) {
  const [sessions] = createResource(listSessions)

  useKeys((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") closeDialog()
  })

  async function open(id: string) {
    closeDialog()
    if (state.streaming) return say("Đang trả lời; dừng (esc) rồi mới mở phiên khác.", "warning")
    if (id === currentSession().id) return
    try {
      await resumeSession(props.runtime, id)
    } catch (error) {
      say(error instanceof Error ? error.message : String(error), "error")
    }
  }

  return (
    <Switch>
      <Match when={sessions.loading}>
        <DialogFrame title="Phiên đã lưu" hint="esc đóng">
          <text fg={color.tx2}>Đang đọc…</text>
        </DialogFrame>
      </Match>
      <Match when={(sessions() ?? []).length === 0}>
        <DialogFrame title="Phiên đã lưu" hint="esc đóng">
          <text fg={color.tx2}>Chưa có phiên nào. Mỗi lượt hỏi–đáp được lưu tự động vào ~/.opentrading/sessions.</text>
        </DialogFrame>
      </Match>
      <Match when={sessions()}>
        {(list) => (
          <DialogFrame title={`Phiên đã lưu · ${list().length}`} hint="gõ để lọc · enter mở lại · esc đóng">
            <Picker
              items={list().map((s) => ({
                label: s.title,
                hint: `${when(s.updatedAt)} · ${s.turns} lượt${s.model ? ` · ${s.model}` : ""}`,
                mark: s.id === currentSession().id ? "●" : " ",
                value: s.id,
              }))}
              onPick={(id) => void open(id)}
              rows={12}
            />
          </DialogFrame>
        )}
      </Match>
    </Switch>
  )
}
