import { useKeys } from "../ui/keys"
import { createResource, createSignal, Match, Switch } from "solid-js"
import type { Runtime } from "../../core/runtime"
import { listSessions } from "../../core/session/store"
import { currentSession, resumeSession } from "../session"
import { closeDialog, state } from "../state"
import { say } from "../notify"
import { color } from "../theme"
import { shortPath } from "../home"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

function when(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Pick a stored session and continue it. Sessions of this folder first; tab shows every folder. */
export function SessionsDialog(props: { runtime: Runtime }) {
  const [everywhere, setEverywhere] = createSignal(false)
  // A string source: createResource never fetches for a falsy one (false = this folder).
  const [sessions] = createResource(
    () => (everywhere() ? "all" : "here"),
    (scope) => listSessions(scope === "all" ? {} : { cwd: process.cwd() }),
  )
  const scope = () => (everywhere() ? "mọi thư mục" : shortPath(process.cwd()))
  const toggle = () => `tab ${everywhere() ? "chỉ thư mục này" : "mọi thư mục"}`

  useKeys((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "escape") closeDialog()
    else if (evt.name === "tab" && !evt.shift) setEverywhere((v) => !v)
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
      <Match when={sessions.loading && !sessions.latest}>
        <DialogFrame title="Phiên đã lưu" hint="esc đóng">
          <text fg={color.tx2}>Đang đọc…</text>
        </DialogFrame>
      </Match>
      <Match when={(sessions() ?? []).length === 0}>
        <DialogFrame title={`Phiên · ${scope()}`} hint={`${toggle()} · esc đóng`}>
          <text fg={color.tx2}>
            {everywhere()
              ? "Chưa có phiên nào. Mỗi lượt hỏi–đáp được lưu tự động vào ~/.opentrading/sessions."
              : "Chưa có phiên nào ở thư mục này. Bấm tab để xem phiên ở thư mục khác."}
          </text>
        </DialogFrame>
      </Match>
      <Match when={sessions()}>
        {(list) => (
          <DialogFrame title={`Phiên · ${scope()} · ${list().length}`} hint={`gõ để lọc · ${toggle()} · enter mở lại · esc đóng`}>
            <Picker
              items={list().map((s) => ({
                label: s.title,
                hint: `${when(s.updatedAt)} · ${s.turns} lượt${s.model ? ` · ${s.model}` : ""}${everywhere() && s.cwd ? ` · ${shortPath(s.cwd)}` : ""}`,
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
