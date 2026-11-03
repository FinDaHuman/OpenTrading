import { useKeys } from "../ui/keys"
import { createMemo, createSignal, Match, Show, Switch } from "solid-js"
import type { NotebookAdmin, NotebookEntry, NotebookGroup } from "../../core/memory/notebook/admin"
import { formatDate } from "../../core/memory/notebook/render"
import { closeDialog } from "../state"
import { say } from "../notify"
import { color } from "../theme"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

const GROUPS: { group: NotebookGroup; name: string }[] = [
  { group: "constraint", name: "Ràng buộc" },
  { group: "style", name: "Cách trình bày" },
  { group: "thesis", name: "Luận điểm" },
  { group: "lesson", name: "Bài học" },
  { group: "decision", name: "Quyết định" },
]
const ONE: Record<NotebookGroup, string> = {
  constraint: "ràng buộc",
  style: "cách trình bày",
  thesis: "luận điểm",
  lesson: "bài học",
  decision: "quyết định",
}

const keyOf = (e: Pick<NotebookEntry, "group" | "id">) => `${e.group}:${e.id}`
const label = (e: NotebookEntry) => (e.group === "thesis" || e.group === "decision" ? e.title : `#${e.id} ${e.title}`)
const hint = (e: NotebookEntry) =>
  e.group === "decision" ? formatDate(e.createdAt) : [`bản ${e.version}`, e.state].filter(Boolean).join(" · ")

/**
 * /memory for the notebook: the five groups the user stored, the full text of one, and deleting it.
 * Deleting asks first and names the version on screen, so a version saved meanwhile in another window is
 * never deleted by mistake.
 */
export function NotebookDialog(props: { admin: NotebookAdmin }) {
  const [entries, setEntries] = createSignal(props.admin.entries())
  // Read right after each listing: an unreadable store must show as such, never as an empty notebook.
  const [problem, setProblem] = createSignal(props.admin.problem())
  const reload = () => {
    setEntries(props.admin.entries())
    setProblem(props.admin.problem())
  }
  const [open, setOpen] = createSignal<string>()
  const [confirming, setConfirming] = createSignal(false)
  const selected = createMemo(() => entries().find((e) => keyOf(e) === open()))

  function remove(entry: NotebookEntry) {
    const result = props.admin.remove(entry.group, { id: entry.id, version: entry.version })
    say(result.message, result.ok ? "success" : "error", result.ok ? 12000 : 8000)
    setConfirming(false)
    if (result.ok || result.reason === "deleted") setOpen(undefined)
    reload()
  }

  useKeys((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "escape") {
      if (confirming()) return setConfirming(false)
      return open() ? setOpen(undefined) : closeDialog()
    }
    const entry = selected()
    if (!entry) return
    if (confirming() && evt.name === "return") remove(entry)
    else if (!confirming() && evt.name === "d") setConfirming(true)
  })

  const items = () =>
    GROUPS.flatMap(({ group, name }) => {
      const of = entries().filter((e) => e.group === group)
      const heading = `${name} (${of.length})`
      return of.map((e) => ({ label: label(e), hint: hint(e), mark: "●", group: heading, value: keyOf(e) }))
    })

  return (
    <Switch>
      <Match when={selected()}>
        {(entry) => (
          <DialogFrame
            title={`Sổ ghi nhớ · ${ONE[entry().group]} · ${label(entry())}`}
            hint={confirming() ? "enter xoá · esc huỷ" : "d xoá · esc quay lại"}
          >
            <text fg={color.tx} wrapMode="word">
              {entry().detail}
            </text>
            <Show when={confirming()}>
              <text fg={color.tham} marginTop={1} wrapMode="word">
                {entry().version === undefined
                  ? `Xoá ${ONE[entry().group]} này khỏi ứng dụng?`
                  : `Xoá ${ONE[entry().group]} này (đang xem bản ${entry().version})? Nếu nơi khác vừa lưu bản mới hơn thì không xoá.`}
              </text>
            </Show>
          </DialogFrame>
        )}
      </Match>
      <Match when={true}>
        <DialogFrame title={`Sổ ghi nhớ · ${entries().length}`} hint="enter xem · esc đóng">
          <Show when={problem()}>
            <text fg={color.tham} wrapMode="word" marginBottom={1}>
              {`△ ${problem()}`}
            </text>
          </Show>
          <Show
            when={entries().length > 0 || problem()}
            fallback={
              <text fg={color.tx2} wrapMode="word">
                Sổ ghi nhớ còn trống. Lệnh ghi (ràng buộc, luận điểm, bài học, quyết định) sẽ có ở bản sau.
              </text>
            }
          >
            <Picker items={items()} onPick={setOpen} rows={14} />
          </Show>
        </DialogFrame>
      </Match>
    </Switch>
  )
}
