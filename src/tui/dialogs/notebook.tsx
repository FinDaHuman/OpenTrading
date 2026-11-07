import { useKeys } from "../ui/keys"
import { createMemo, createSignal, Match, Show, Switch } from "solid-js"
import type { NotebookAdmin, NotebookEntry, NotebookGroup, ThesisStateChoice } from "../../core/memory/notebook/admin"
import { formatDate, THESIS_STATE_LABEL } from "../../core/memory/notebook/render"
import { closeDialog } from "../state"
import { say } from "../notify"
import { redactOpen } from "../session"
import type { RedactionCheck } from "../../core/memory/redaction/check"
import { color } from "../theme"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"
import { showNotebookForm } from "./notebook-form/open"
import type { NotebookFormRequest } from "../state"

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
 * /memory for the notebook: the five groups the user stored, the full text of one, deleting it, editing it
 * in its form (decisions are appended, never edited), a thesis's state, and exporting to Markdown.
 * Deleting and changing a state ask first and name the version on screen, so a version saved meanwhile in
 * another window is never changed by mistake.
 */

const STATES: ThesisStateChoice[] = ["watching", "refuted", "closed"]

/** The form that edits an entry, opened exactly as its notebook command would open it. */
function editRequest(e: NotebookEntry): NotebookFormRequest | undefined {
  switch (e.group) {
    case "constraint":
    case "style":
      return { group: "constraint", edit: { id: e.id } }
    case "thesis":
      return { group: "thesis", alias: e.title }
    case "lesson":
      return { group: "lesson", edit: { id: e.id } }
    case "decision":
      return undefined
  }
}
/** `redaction`: the runtime's check, so a delete masks the open conversation at once. */
export function NotebookDialog(props: { admin: NotebookAdmin; redaction?: RedactionCheck }) {
  const [entries, setEntries] = createSignal(props.admin.entries())
  // Read right after each listing: an unreadable store must show as such, never as an empty notebook.
  const [problem, setProblem] = createSignal(props.admin.problem())
  const reload = () => {
    setEntries(props.admin.entries())
    setProblem(props.admin.problem())
  }
  const [open, setOpen] = createSignal<string>()
  const [confirming, setConfirming] = createSignal(false)
  // Changing a thesis state: picking one of the three, then confirming it.
  const [stating, setStating] = createSignal(false)
  const [nextState, setNextState] = createSignal<ThesisStateChoice>()
  const selected = createMemo(() => entries().find((e) => keyOf(e) === open()))

  function remove(entry: NotebookEntry) {
    const result = props.admin.remove(entry.group, { id: entry.id, version: entry.version })
    say(result.message, result.ok ? "success" : "error", result.ok ? 12000 : 8000)
    // Mask the open conversation now; redactOpen leaves it to the next turn while a turn or compaction runs.
    if (result.ok && (entry.group === "lesson" || entry.group === "thesis")) void redactOpen(props.redaction)
    setConfirming(false)
    if (result.ok || result.reason === "deleted") setOpen(undefined)
    reload()
  }

  function changeState(entry: NotebookEntry, to: ThesisStateChoice) {
    const result = props.admin.setThesisState(entry.id, entry.version!, to)
    say(result.message, result.ok ? "success" : "error")
    setNextState(undefined)
    if (result.ok || (!result.ok && result.reason === "deleted")) setOpen(undefined)
    reload()
  }

  useKeys((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "escape") {
      if (confirming()) return setConfirming(false)
      if (nextState()) return setNextState(undefined)
      if (stating()) return setStating(false)
      return open() ? setOpen(undefined) : closeDialog()
    }
    const entry = selected()
    if (!entry) {
      // The list's filter takes typed letters, so export is on Ctrl+X.
      if (evt.ctrl && evt.name === "x") {
        evt.preventDefault()
        showNotebookForm({ group: "export" })
      }
      return
    }
    const to = nextState()
    if (to) {
      if (evt.name === "return") {
        // The list comes back under this key press: its filter must not take the same Enter.
        evt.preventDefault()
        changeState(entry, to)
      }
      return
    }
    if (stating()) {
      const pick = STATES[Number(evt.sequence) - 1]
      if (pick) {
        setStating(false)
        setNextState(pick)
      }
      return
    }
    if (confirming() && evt.name === "return") remove(entry)
    else if (confirming()) return
    else if (evt.name === "d") setConfirming(true)
    else if (evt.name === "s") {
      const request = editRequest(entry)
      if (!request) return
      // The form's first field takes focus under this key press: it must not also get the "s".
      evt.preventDefault()
      showNotebookForm(request)
    } else if (evt.name === "t" && entry.group === "thesis") setStating(true)
  })

  const detailHint = (e: NotebookEntry) =>
    confirming() || nextState()
      ? "enter xác nhận · esc huỷ"
      : stating()
        ? "số để chọn · esc huỷ"
        : e.group === "decision"
          ? "d xoá · esc quay lại"
          : e.group === "thesis"
            ? "s sửa · t đổi trạng thái · d xoá · esc quay lại"
            : "s sửa · d xoá · esc quay lại"

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
            hint={detailHint(entry())}
          >
            <text fg={color.tx} wrapMode="word">
              {entry().detail}
            </text>
            <Show when={stating()}>
              <text fg={color.tham} marginTop={1} wrapMode="word">
                {`Đổi trạng thái luận điểm ${entry().title} (đang xem bản ${entry().version}): ` +
                  STATES.map((st, i) => `[${i + 1}] ${THESIS_STATE_LABEL[st]}`).join("   ")}
              </text>
            </Show>
            <Show when={nextState()}>
              {(to) => (
                <text fg={color.tham} marginTop={1} wrapMode="word">
                  {`Đổi trạng thái sang «${THESIS_STATE_LABEL[to()]}»? Không tạo bản mới. ` +
                    "Nếu nơi khác vừa lưu bản mới hơn thì không đổi."}
                </text>
              )}
            </Show>
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
        <DialogFrame title={`Sổ ghi nhớ · ${entries().length}`} hint="enter xem · ctrl+x xuất Markdown · esc đóng">
          <Show when={problem()}>
            <text fg={color.tham} wrapMode="word" marginBottom={1}>
              {`△ ${problem()}`}
            </text>
          </Show>
          <Show
            when={entries().length > 0 || problem()}
            fallback={
              <text fg={color.tx2} wrapMode="word">
                Sổ ghi nhớ còn trống. Ghi bằng /nho (ràng buộc, cách trình bày), /luandiem {"<mã>"}, /baihoc, /quyetdinh {"<mã>"}.
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
