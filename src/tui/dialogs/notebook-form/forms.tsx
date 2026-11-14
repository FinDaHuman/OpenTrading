import { cardSaved } from "../../cards"
import { createMemo, createSignal, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { notebookAdmin, type NotebookAdmin, type SaveResult, type SubjectTarget } from "../../../core/memory/notebook/admin"
import {
  guessKind,
  refName,
  thesisToDraft,
  toStoreDay,
  type ConstraintDraft,
  type DecisionDraft,
  type LessonDraft,
  type NewSubjectDraft,
  type SubjectRef,
  type ThesisDraft,
} from "../../../core/memory/notebook/drafts"
import { fieldChanges, fieldCounts, type FieldCount } from "../../../core/memory/notebook/form-model"
import { formatDate } from "../../../core/memory/notebook/render"
import { foldName } from "../../../core/memory/notebook/topics"
import { draftWarnings } from "../../../core/memory/notebook/warnings"
import { countChars, MEMORY_LIMITS } from "../../../core/memory/limits"
import { aliasKey } from "../../../core/memory/store/subjects"
import type { Confidence, ConstraintKind, SubjectKind, ThesisVersion } from "../../../core/memory/store/types"
import type { MemoryProvider } from "../../../core/memory/types"
import { say } from "../../notify"
import { useKeys } from "../../ui/keys"
import { leaveNotebookForm, setState, state, type NotebookFormRequest } from "../../state"
import { color } from "../../theme"
import { DialogFrame } from "../frame"
import { conflictStep, deletedStep, reviewStep } from "./conflict"
import { ExportForm } from "./export"
import { countText, formatCount } from "./fields"
import { createFormUi, FormFrame, type FormField, type FormStep, type FormUi } from "./frame"

/**
 * The notebook's forms, docked in place of the prompt. Each reads what it shows through the notebook's
 * admin handle and writes only when the user confirms; the handle turns every store error into a result
 * here, so a form never guesses. A read that fails closes the form with the reason: an empty form in place
 * of the stored version would invite overwriting it with nothing.
 */

export const FIGURE_GUIDE =
  "Không ghi giá, số liệu hiện hành hay dự báo; model lấy số mới bằng tool. " +
  "Ngưỡng của bạn (tối đa 20%, Sai nếu biên gộp dưới 10%) thì được."

type Request<G extends NotebookFormRequest["group"]> = Extract<NotebookFormRequest, { group: G }>

export function NotebookFormDialog(props: { memory: MemoryProvider }) {
  const admin = notebookAdmin(props.memory)
  return (
    <Show when={admin && state.notebookForm} keyed fallback={<Unavailable />}>
      {(req) => (
        <Switch>
          <Match when={req.group === "constraint"}>
            <ConstraintForm admin={admin!} req={req as Request<"constraint">} />
          </Match>
          <Match when={req.group === "thesis"}>
            <ThesisForm admin={admin!} req={req as Request<"thesis">} />
          </Match>
          <Match when={req.group === "lesson"}>
            <LessonForm admin={admin!} req={req as Request<"lesson">} />
          </Match>
          <Match when={req.group === "decision"}>
            <DecisionForm admin={admin!} req={req as Request<"decision">} />
          </Match>
          <Match when={req.group === "export"}>
            <ExportForm admin={admin!} />
          </Match>
        </Switch>
      )}
    </Show>
  )
}

function Unavailable() {
  useKeys((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") leaveNotebookForm()
  })
  return (
    <DialogFrame title="Sổ ghi nhớ" hint="esc đóng">
      <text>Sổ ghi nhớ đã tắt; chưa lưu.</text>
    </DialogFrame>
  )
}

/** A read failed while opening: say why and close, after the current render. */
function failOpen(message: string) {
  queueMicrotask(() => {
    say(message, "error")
    leaveNotebookForm()
  })
  return null
}

/** What every form does with a save's result; the specific cases are the form's own. */
function settle(
  ui: FormUi,
  result: SaveResult,
  on: {
    conflict?: (current: Extract<SaveResult, { reason: "conflict" }>["current"]) => void
    deleted?: () => void
    /** After a save that went through, before the form closes (a suggestion card is marked saved). */
    saved?: (saved: { id: number }) => void
    partial?: (created: NonNullable<Extract<SaveResult, { partial?: unknown }>["partial"]>["created"]) => void
  } = {},
) {
  if (result.ok) {
    on.saved?.(result.saved)
    say(result.message, "success")
    return leaveNotebookForm()
  }
  if (result.reason === "conflict") {
    if (on.conflict) return on.conflict(result.current)
  } else if (result.reason === "deleted" && on.deleted) {
    return on.deleted()
  }
  const partial = result.reason === "conflict" ? undefined : result.partial
  if (partial) on.partial?.(partial.created)
  const message = partial?.message ?? result.message
  ui.setError(message)
  say(message, "warning")
}

/** Warnings to accept first; none, and the save goes on. */
function warnFirst(ui: FormUi, warnings: readonly string[], next: () => void, extra: FormStep["choices"] = []) {
  if (warnings.length === 0) return next()
  ui.setStep({
    title: "Trước khi lưu:",
    lines: [...new Set(warnings)],
    accent: undefined,
    choices: [...extra, { label: extra.length > 0 ? "Vẫn lưu bài học" : "Vẫn lưu", run: next }, { label: "Sửa tiếp" }],
    enterPicks: extra.length,
  })
}

// ---------------------------------------------------------------------------------------------------------
// /nho: a constraint or a presentation style.

const KIND_OPTIONS = [
  { value: "constraint", label: "Ràng buộc", hint: "điều bạn không bao giờ muốn vi phạm; luôn gửi cho model, không bao giờ cắt" },
  { value: "style", label: "Cách trình bày", hint: "bạn muốn câu trả lời trông thế nào" },
] as const
const KIND_NAME: Record<ConstraintKind, string> = { constraint: "ràng buộc", style: "cách trình bày" }

function ConstraintForm(props: { admin: NotebookAdmin; req: Request<"constraint"> }) {
  const admin = props.admin
  let loaded: { id: number; version: number; kind: ConstraintKind; text: string } | undefined
  if (props.req.edit) {
    const read = admin.constraintDraft(props.req.edit.id)
    if (!read.ok) return failOpen(read.message)
    loaded = read.value
  }
  const entries = admin.entries()
  const problem = admin.problem()
  if (problem) return failOpen(problem)
  const totals = {} as Record<ConstraintKind, number>
  for (const kind of ["constraint", "style"] as const) {
    const read = admin.activeConstraintChars(kind, loaded?.id)
    if (!read.ok) return failOpen(read.message)
    totals[kind] = read.value
  }
  const inForce = entries.filter((e) => e.group === "constraint")
  const allConstraints = admin.activeConstraintChars("constraint")
  if (!allConstraints.ok) return failOpen(allConstraints.message)

  const ui = createFormUi()
  const opened: ConstraintDraft = loaded
    ? { kind: loaded.kind, text: loaded.text }
    : { kind: props.req.kind, text: props.req.text ?? "" }
  const [draft, setDraft] = createStore<ConstraintDraft>({ ...opened })
  // Opened from a lesson: the sentence came from that form, so leaving must ask (it is not saved anywhere).
  if (props.req.fromLesson) opened.text = ""
  // The version the form shows and an edit is checked against; undefined for a new entry.
  const [base, setBase] = createSignal<{ draft: ConstraintDraft; id?: number; version?: number }>({
    draft: opened,
    id: loaded?.id,
    version: loaded?.version,
  })
  const counts = createMemo(() =>
    fieldCounts("constraint", { ...draft }, draft.kind ? { activeChars: totals[draft.kind] } : undefined),
  )
  const textCount = () => counts().find((c) => c.field === "text")
  const total = () => counts().find((c) => c.field === "total")
  const problems = createMemo(() => {
    const out: string[] = []
    const t = textCount()
    if (t?.over) out.push(`«Văn bản» dài ${formatCount(t.count)} ký tự, vượt giới hạn ${formatCount(t.max)}.`)
    const sum = total()
    if (sum?.over && draft.kind) {
      const name = KIND_NAME[draft.kind]
      out.push(`Vượt tổng ${formatCount(sum.max)} ký tự cho ${name}. Rút gọn hoặc xoá bớt ${name} cũ trong /memory.`)
    }
    return out
  })
  const self = () => (base().id !== undefined && loaded ? { group: loaded.kind, id: base().id! } : undefined)
  const warnings = createMemo(() => draftWarnings("constraint", { ...draft }, entries, self()).map((w) => w.message))
  const dirty = createMemo(() => fieldChanges("constraint", opened, { ...draft }).length > 0 || draft.kind !== opened.kind)
  const canConfirm = () => Boolean(draft.kind && draft.text.trim() && problems().length === 0)

  const info = createMemo(() => {
    const out = [
      inForce.length === 0
        ? "Chưa có ràng buộc nào."
        : `Ràng buộc đang có (${inForce.length} · ${formatCount(allConstraints.value)}/${formatCount(1_500)} ký tự): ` +
          inForce.map((e) => `#${e.id} ${e.text ?? e.title}`).join(" · "),
    ]
    const sum = total()
    if (draft.kind && sum) out.push(`Tổng ${KIND_NAME[draft.kind]} sau khi lưu: ${countText(sum)} ký tự`)
    if (!draft.kind) out.push("Chọn ngăn trước khi xác nhận.")
    if (props.req.fromLesson) out.push("Mở từ form bài học: chỉ giữ câu này; các ô khác của bài học không được lưu.")
    if (props.req.card?.quote) out.push(`Mở từ thẻ gợi ý của model. Câu bạn đã gõ: "${props.req.card.quote}"`)
    out.push(FIGURE_GUIDE)
    return out
  })

  function save() {
    const b = base()
    const edit = b.id !== undefined && b.version !== undefined ? { id: b.id, expected: b.version } : undefined
    const card = props.req.card
    settle(ui, admin.saveConstraint({ ...draft }, edit, { card: !!card }), {
      saved: (s) => {
        if (card && draft.kind) cardSaved(card.id, { group: draft.kind, id: s.id })
      },
      conflict: (current) => {
        const theirs = current as ConstraintDraft & { version: number }
        const mine = { ...draft }
        ui.setStep(
          conflictStep(theirs.version, fieldChanges("constraint", theirs, mine), {
            keepMine: () => {
              setBase({ draft: { kind: theirs.kind, text: theirs.text }, id: b.id, version: theirs.version })
              ui.setStep(reviewStep(theirs.version, fieldChanges("constraint", theirs, mine), save))
            },
            takeTheirs: () => {
              setDraft({ kind: theirs.kind, text: theirs.text })
              setBase({ draft: { kind: theirs.kind, text: theirs.text }, id: b.id, version: theirs.version })
              ui.reload()
            },
          }),
        )
      },
      deleted: () =>
        ui.setStep(
          deletedStep(KIND_NAME[draft.kind ?? "constraint"], () => {
            setBase({ draft: base().draft })
            save()
          }),
        ),
    })
  }

  function confirm() {
    warnFirst(ui, warnings(), () => {
      const b = base()
      if (b.version === undefined) return save()
      const changes = fieldChanges("constraint", b.draft, { ...draft })
      if (changes.length === 0) return ui.setError(`Chưa có thay đổi nào so với bản ${b.version}.`)
      ui.setStep(reviewStep(b.version, changes, save))
    })
  }

  return (
    <FormFrame
      ui={ui}
      title={loaded ? `Sửa ${KIND_NAME[loaded.kind]} #${loaded.id}` : "Ghi nhớ"}
      subtitle={base().version !== undefined ? `Đang sửa từ bản ${base().version}` : undefined}
      fields={[
        {
          id: "text",
          label: "Văn bản",
          kind: "line",
          initial: draft.text,
          onChange: (v) => setDraft("text", v),
          count: textCount(),
        },
        {
          id: "kind",
          label: "Ngăn",
          kind: "choice",
          options: KIND_OPTIONS,
          value: draft.kind,
          onPick: (v) => setDraft("kind", v as ConstraintKind),
          locked: loaded !== undefined,
          showHints: true,
        },
      ]}
      info={info()}
      problems={problems()}
      warnings={warnings()}
      buttons={[{ id: "confirm", label: "Xác nhận", enabled: canConfirm(), run: confirm }]}
      dirty={dirty()}
    />
  )
}

/** Red lines for every field over its limit; labels only, never the text. */
function overLimits(counts: readonly FieldCount[]): string[] {
  return counts
    .filter((c) => c.over && c.field !== "total")
    .map((c) => `«${c.label}» dài ${formatCount(c.count)} ký tự, vượt giới hạn ${formatCount(c.max)}.`)
}

const badDay = (label: string, text: string | undefined) =>
  toStoreDay(text) === "invalid" ? [`«${label}» phải là ngày dạng DD/MM/YYYY.`] : []

/** "FPT Corp, Hòa Phát" → ["FPT Corp", "Hòa Phát"]. */
const splitList = (text: string) =>
  text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

/** A ticker's code as the store keeps it. */
const code = aliasKey


/**
 * /luandiem and /quyetdinh without a code: the code comes first. Enter opens the subject's own form (its
 * current thesis, or a new subject), so nothing is ever written against a subject the user has not seen.
 */
function CodeFirst(props: { group: "thesis" | "decision"; title: string }) {
  const ui = createFormUi()
  const [value, setValue] = createSignal("")
  const open = () => {
    // A new object at the top level: setState("notebookForm", {...}) would merge into the open request, keep
    // its identity, and the keyed form would never open the subject typed.
    if (value().trim()) setState({ notebookForm: { group: props.group, alias: value().trim() } })
  }
  return (
    <FormFrame
      ui={ui}
      title={props.title}
      fields={[
        { id: "code", label: "Mã hoặc tên chủ đề", kind: "line", initial: "", onChange: setValue, onEnter: open },
      ]}
      info={["Gõ mã hoặc tên chủ đề rồi Enter."]}
      buttons={[{ id: "confirm", label: "Xác nhận", enabled: false, run: () => {} }]}
      dirty={value().trim() !== ""}
    />
  )
}

// ---------------------------------------------------------------------------------------------------------
// /luandiem: a thesis, saved as a new version; for a code not in the notebook, the subject too.

const SUBJECT_KINDS = [
  { value: "ticker", label: "mã" },
  { value: "sector", label: "ngành" },
  { value: "market", label: "thị trường" },
] as const
const YES_NO = [
  { value: "no", label: "Không" },
  { value: "yes", label: "Có" },
] as const
const STATE_NAME: Record<string, string> = { refuted: "đã bị bác bỏ", closed: "đã đóng" }

interface ThesisFields {
  text: string
  detail: string
  conditions: string[]
  reviewBy: string
}

const conditionCount = (text: string, i: number): FieldCount => {
  const count = countChars(text.normalize("NFC").trim())
  const max = MEMORY_LIMITS.thesisCondition.max
  return { field: `cond.${i}`, label: `Điều kiện ${i + 1}`, count, max, over: count > max }
}

const fromThesis = (t: ThesisDraft | undefined): ThesisFields => ({
  text: t?.text ?? "",
  detail: t?.detail ?? "",
  conditions: t && t.conditions.length > 0 ? [...t.conditions] : [""],
  reviewBy: t?.reviewBy ?? "",
})
/** What is saved: blank conditions dropped (clearing one removes it). */
const toThesis = (f: ThesisFields): ThesisDraft => ({
  text: f.text,
  detail: f.detail.trim() ? f.detail : undefined,
  conditions: f.conditions.filter((c) => c.trim()),
  reviewBy: f.reviewBy.trim() ? f.reviewBy.trim() : undefined,
})

function ThesisForm(props: { admin: NotebookAdmin; req: Request<"thesis"> }) {
  const admin = props.admin
  const alias = (props.req.alias ?? "").trim()
  if (!alias) return <CodeFirst group="thesis" title="Luận điểm mới" />
  const look = admin.lookupSubject(alias)
  if (!look.ok) return failOpen(look.message)
  const sectorsRead = admin.sectors()
  if (!sectorsRead.ok) return failOpen(sectorsRead.message)
  const sectors = sectorsRead.value
  const { found, thesis, deletedUpTo, retired } = look.value

  const ui = createFormUi()
  const opened = fromThesis(thesis && thesisToDraft(thesis))
  const [draft, setDraft] = createStore<ThesisFields>(structuredClone(opened))
  // The thesis version the form shows (an edit is checked against it), null when there is none yet.
  const [expected, setExpected] = createSignal<number | null>(thesis?.version ?? null)
  const [base, setBase] = createSignal<ThesisDraft>(toThesis(opened))
  // A subject made by a save whose thesis then failed: from then on it is an existing subject.
  const [made, setMade] = createSignal<{ id: number; display: string; aliases?: string[] }>()
  const [madeSector, setMadeSector] = createSignal<{ id: number; display: string }>()
  const [subject, setSubject] = createStore({ kind: "ticker" as SubjectKind, sector: "", others: "", upper: false })
  const isNew = () => !found && !made()
  // A new ticker is stored in capitals, a sector or market as typed: the form names it the same way.
  const display = () => found?.display ?? (subject.kind === "ticker" ? code(alias) : alias.trim())

  const current = () => toThesis(draft)
  const counts = createMemo(() => fieldCounts("thesis", current()))
  const countOf = (field: string) => counts().find((c) => c.field === field)
  const problems = createMemo(() => [
    ...overLimits(counts().filter((c) => !c.field.startsWith("conditions."))),
    ...overLimits(draft.conditions.map(conditionCount)),
    ...badDay("Hạn xem lại", draft.reviewBy),
  ])
  const warnings = createMemo(() => draftWarnings("thesis", current(), []).map((w) => w.message))
  const dirty = createMemo(
    () =>
      fieldChanges("thesis", toThesis(opened), current()).length > 0 ||
      (isNew() && (subject.kind !== "ticker" || subject.sector.trim() !== "" || subject.others.trim() !== "" || subject.upper)),
  )
  const canConfirm = () => Boolean(draft.text.trim()) && problems().length === 0

  function newSubject(): NewSubjectDraft {
    const name = subject.sector.trim()
    const known = name ? sectors.find((s) => foldName(s.display) === foldName(name)) : undefined
    const sector = madeSector()
      ? { id: madeSector()!.id }
      : known
        ? { id: known.id }
        : name && subject.kind === "ticker"
          ? { newName: name }
          : undefined
    return {
      kind: subject.kind,
      alias,
      sector: subject.kind === "ticker" ? sector : undefined,
      otherAliases: splitList(subject.others),
      uppercaseOnly: subject.upper,
    }
  }
  const target = () => (found ? { id: found.id } : made() ? { id: made()!.id, aliases: made()!.aliases } : newSubject())

  const load = (t: ThesisDraft & { version: number }) => {
    const fields = fromThesis(t)
    setDraft(fields)
    setBase(toThesis(fields))
    setExpected(t.version)
    ui.reload()
  }

  function save() {
    const mine = current()
    settle(ui, admin.saveThesis(target(), expected(), mine), {
      conflict: (cur) => {
        const theirs = cur as ThesisDraft & { version: number }
        ui.setStep(
          conflictStep(theirs.version, fieldChanges("thesis", theirs, mine), {
            keepMine: () => {
              setExpected(theirs.version)
              setBase(theirs)
              ui.setStep(reviewStep(theirs.version, fieldChanges("thesis", theirs, mine), save))
            },
            takeTheirs: () => load(theirs),
          }),
        )
      },
      deleted: () =>
        ui.setStep(
          deletedStep("luận điểm", () => {
            setExpected(null)
            save()
          }),
        ),
      partial: (created) => {
        const s = created.find((c) => c.role === "subject")
        if (s) setMade({ id: s.id, display: s.display, aliases: s.aliases })
        const sec = created.find((c) => c.role === "sector")
        if (sec) setMadeSector({ id: sec.id, display: sec.display })
      },
    })
  }

  function confirm() {
    warnFirst(ui, warnings(), () => {
      const version = expected()
      if (version === null) return save()
      const changes = fieldChanges("thesis", base(), current())
      if (changes.length === 0) return ui.setError(`Chưa có thay đổi nào so với bản ${version}.`)
      ui.setStep(reviewStep(version, changes, save))
    })
  }

  const subtitle = () =>
    expected() !== null
      ? `Đang sửa từ bản ${expected()}`
      : found
        ? deletedUpTo
          ? "Luận điểm mới (bản trước đã xoá)"
          : "Luận điểm mới"
        : made()
          ? `Chủ đề ${made()!.display} (#${made()!.id}, đã có)`
          : "Chủ đề mới"

  const notes = () => {
    const out: string[] = []
    if (retired && isNew()) {
      out.push(
        `«${code(alias)}» từng là bí danh của chủ đề #${retired.subjectId} (nay là ${retired.display}), ` +
          `đã thôi dùng ngày ${formatDate(retired.retiredAt)}. Lưu sẽ tạo chủ đề mới ${display()}; ` +
          `muốn viết luận điểm cho chủ đề #${retired.subjectId} thì gõ /luandiem ${retired.display}.`,
      )
    }
    const st = found?.thesisState
    if (thesis && st && STATE_NAME[st]) {
      out.push(`Trạng thái hiện tại: ${STATE_NAME[st]}. Lưu bản mới đưa trạng thái về «đang theo dõi».`)
    }
    return out
  }

  const subjectFields = (): FormField[] =>
    !isNew()
      ? []
      : [
          {
            id: "skind",
            label: "Loại",
            kind: "choice",
            options: SUBJECT_KINDS,
            value: subject.kind,
            onPick: (v) => setSubject("kind", v as SubjectKind),
          },
          ...(subject.kind === "ticker"
            ? [
                {
                  id: "sector",
                  label: "Ngành",
                  kind: "line" as const,
                  initial: subject.sector,
                  onChange: (v: string) => setSubject("sector", v),
                  hint: madeSector()
                    ? `${madeSector()!.display} (#${madeSector()!.id}, đã có)`
                    : sectors.length > 0
                      ? `Có sẵn: ${sectors.map((s) => s.display).join(", ")}; tên khác thì tạo ngành mới`
                      : "Chưa có ngành nào; gõ tên để tạo",
                },
              ]
            : []),
          {
            id: "others",
            label: "Bí danh khác",
            kind: "line",
            initial: subject.others,
            onChange: (v) => setSubject("others", v),
            hint: "cách nhau bằng dấu phẩy",
          },
          {
            id: "upper",
            label: "Chỉ khớp khi viết hoa",
            kind: "choice",
            options: YES_NO,
            value: subject.upper ? "yes" : "no",
            onPick: (v) => setSubject("upper", v === "yes"),
          },
        ]

  const fields = (): FormField[] => [
    ...subjectFields(),
    {
      id: "text",
      label: "Văn bản",
      kind: "line",
      initial: draft.text,
      onChange: (v) => setDraft("text", v),
      count: countOf("text"),
    },
    ...draft.conditions.map(
      (c, i): FormField => ({
        id: `cond.${i}`,
        label: `Điều kiện ${i + 1}`,
        kind: "line",
        initial: c,
        placeholder: "Sai nếu …",
        onChange: (v) => setDraft("conditions", i, v),
        count: conditionCount(c, i),
      }),
    ),
    {
      id: "review",
      label: "Hạn xem lại",
      kind: "line",
      initial: draft.reviewBy,
      onChange: (v) => setDraft("reviewBy", v),
      hint: "DD/MM/YYYY",
    },
    {
      id: "detail",
      label: "Chi tiết",
      kind: "text",
      initial: draft.detail,
      onChange: (v) => setDraft("detail", v),
      count: countOf("detail"),
    },
  ]

  const full = () => draft.conditions.length >= MEMORY_LIMITS.thesisConditions.max

  return (
    <FormFrame
      ui={ui}
      title={found ? `Luận điểm ${display()}` : `Luận điểm mới ${display()}`}
      subtitle={subtitle()}
      notes={notes()}
      fields={fields()}
      info={[...(full() ? ["Tối đa 8 điều kiện."] : []), FIGURE_GUIDE]}
      problems={problems()}
      warnings={warnings()}
      buttons={[
        {
          id: "add",
          label: "Thêm điều kiện",
          enabled: !full(),
          run: () => setDraft("conditions", draft.conditions.length, ""),
        },
        { id: "confirm", label: "Xác nhận", enabled: canConfirm(), run: confirm },
      ]}
      dirty={dirty()}
    />
  )
}

// ---------------------------------------------------------------------------------------------------------
// /quyetdinh: the decision log. Append-only, on this machine only; it rests on the thesis version the form
// showed, never on one looked up at save time that the user has not seen.

const LOCAL_ONLY = "Nhật ký quyết định chỉ nằm trên máy này; không bao giờ được gửi cho model. Đây không phải lệnh giao dịch."
const CONFIDENCE_OPTIONS = [
  { value: "low", label: "thấp" },
  { value: "medium", label: "vừa" },
  { value: "high", label: "cao" },
] as const

function DecisionForm(props: { admin: NotebookAdmin; req: Request<"decision"> }) {
  const admin = props.admin
  const alias = (props.req.alias ?? "").trim()
  if (!alias) return <CodeFirst group="decision" title="Quyết định mới" />
  const look = admin.lookupSubject(alias)
  if (!look.ok) return failOpen(look.message)
  const { found, thesis } = look.value

  const ui = createFormUi()
  const [draft, setDraft] = createStore({
    action: "",
    reason: "",
    expectation: "",
    confidence: undefined as Confidence | undefined,
    reviewOn: "",
    changeMind: "",
  })
  const [shown, setShown] = createSignal<ThesisVersion | undefined>(thesis)
  const [attach, setAttach] = createSignal<"thesis" | "none">(thesis ? "thesis" : "none")
  const [made, setMade] = createSignal<{ id: number; display: string; aliases?: string[] }>()
  const display = found?.display ?? code(alias)

  const decision = (basis: DecisionDraft["basis"]): DecisionDraft => ({
    action: draft.action,
    reason: draft.reason,
    expectation: draft.expectation.trim() ? draft.expectation : undefined,
    confidence: draft.confidence,
    reviewOn: draft.reviewOn.trim() ? draft.reviewOn.trim() : undefined,
    changeMind: draft.changeMind.trim() ? draft.changeMind : undefined,
    basis,
  })
  const counts = createMemo(() => fieldCounts("decision", decision("none")))
  const countOf = (field: string) => counts().find((c) => c.field === field)
  const problems = createMemo(() => [...overLimits(counts()), ...badDay("Ngày xem lại", draft.reviewOn)])
  const warnings = createMemo(() => draftWarnings("decision", decision("none"), []).map((w) => w.message))
  const dirty = createMemo(
    () =>
      [draft.action, draft.reason, draft.expectation, draft.reviewOn, draft.changeMind].some((v) => v.trim()) ||
      !!draft.confidence,
  )
  const canConfirm = () => Boolean(draft.action.trim() && draft.reason.trim()) && problems().length === 0
  const target = (): SubjectTarget | NewSubjectDraft =>
    found
      ? { id: found.id }
      : made()
        ? { id: made()!.id, aliases: made()!.aliases }
        : { kind: "ticker", alias, otherAliases: [], uppercaseOnly: false }

  const goneStep = (version: number): FormStep => ({
    title: `Luận điểm ${display} bản ${version} vừa bị xoá. Ghi quyết định không gắn luận điểm, hoặc huỷ.`,
    accent: color.tham,
    choices: [
      {
        label: "Ghi không gắn luận điểm",
        run: () => {
          setAttach("none")
          setShown(undefined)
          save("none")
        },
      },
      { label: "Huỷ" },
    ],
  })

  function save(basis: DecisionDraft["basis"]) {
    settle(ui, admin.saveDecision(target(), decision(basis)), {
      deleted: () => (basis === "none" ? ui.setError("Mục này đã bị xoá ở nơi khác.") : ui.setStep(goneStep(basis.version))),
      partial: (created) => {
        const s = created.find((c) => c.role === "subject")
        if (s) setMade({ id: s.id, display: s.display, aliases: s.aliases })
      },
    })
  }

  function confirm() {
    warnFirst(ui, warnings(), () => {
      const seen = shown()
      if (attach() === "none" || !seen || !found) return save("none")
      // Read again at confirm time; the comparison runs outside the store's write, which accepts any live
      // version, so a version saved in between is harmless: the decision still rests on the one seen.
      const now = admin.subject(found.id)
      if (!now.ok) return ui.setError(now.message)
      const current = now.value.thesis
      if (!current) return ui.setStep(goneStep(seen.version))
      if (current.version === seen.version) return save({ version: seen.version })
      ui.setStep({
        title: `Luận điểm ${display} vừa có bản ${current.version} (bạn đang xem bản ${seen.version}). Gắn quyết định với:`,
        accent: color.tham,
        choices: [
          { label: `Bản ${seen.version}, bản bạn đã xem`, run: () => save({ version: seen.version }) },
          { label: `Xem bản ${current.version} trước`, run: () => setShown(current) },
          { label: "Huỷ" },
        ],
      })
    })
  }

  const notes = () => {
    const out = [LOCAL_ONLY]
    if (!found && !made()) out.push(`${display} chưa có trong sổ; lưu sẽ tạo chủ đề ${display} (loại mã).`)
    const t = shown()
    if (t) {
      out.push(`Căn cứ: luận điểm ${display} bản ${t.version}`, `  ${t.text}`)
      t.conditions.forEach((c, i) => out.push(`  (${i + 1}) ${c}`))
    } else if (found) {
      out.push(`${display} chưa có luận điểm`)
    }
    return out
  }

  const fields = (): FormField[] => [
    {
      id: "action",
      label: "Việc",
      kind: "line",
      initial: draft.action,
      onChange: (v) => setDraft("action", v),
      count: countOf("action"),
    },
    {
      id: "reason",
      label: "Lý do",
      kind: "text",
      initial: draft.reason,
      onChange: (v) => setDraft("reason", v),
      count: countOf("reason"),
    },
    {
      id: "expectation",
      label: "Kỳ vọng",
      kind: "text",
      initial: draft.expectation,
      onChange: (v) => setDraft("expectation", v),
      count: countOf("expectation"),
    },
    {
      id: "confidence",
      label: "Mức tự tin",
      kind: "choice",
      options: CONFIDENCE_OPTIONS,
      value: draft.confidence,
      onPick: (v) => setDraft("confidence", v as Confidence),
    },
    {
      id: "reviewOn",
      label: "Ngày xem lại",
      kind: "line",
      initial: draft.reviewOn,
      onChange: (v) => setDraft("reviewOn", v),
      hint: "DD/MM/YYYY",
    },
    {
      id: "changeMind",
      label: "Điều gì làm đổi ý",
      kind: "text",
      initial: draft.changeMind,
      onChange: (v) => setDraft("changeMind", v),
      count: countOf("changeMind"),
    },
    ...(shown()
      ? [
          {
            id: "basis",
            label: "Gắn luận điểm",
            kind: "choice" as const,
            options: [
              { value: "thesis", label: `Gắn bản ${shown()!.version}` },
              { value: "none", label: "Không gắn luận điểm" },
            ],
            value: attach(),
            onPick: (v: string) => setAttach(v as "thesis" | "none"),
          },
        ]
      : []),
  ]

  return (
    <FormFrame
      ui={ui}
      title={`Quyết định ${display}`}
      notes={notes()}
      fields={fields()}
      info={[FIGURE_GUIDE]}
      problems={problems()}
      warnings={warnings()}
      buttons={[{ id: "confirm", label: "Xác nhận", enabled: canConfirm(), run: confirm }]}
      dirty={dirty()}
    />
  )
}

// ---------------------------------------------------------------------------------------------------------
// /baihoc: a lesson. Read by the model on demand only; a hard rule saved here would stop being always
// applied, so the form says so and offers the constraint form instead.

interface LessonFields {
  title: string
  summary: string
  appliesTo: string
  exceptions: string
  detail: string
  tags: string
}

function LessonForm(props: { admin: NotebookAdmin; req: Request<"lesson"> }) {
  const admin = props.admin
  let loaded: (LessonDraft & { id: number; version: number }) | undefined
  if (props.req.edit) {
    const read = admin.lessonDraft(props.req.edit.id)
    if (!read.ok) return failOpen(read.message)
    loaded = read.value
  }
  const entries = admin.entries()
  const problem = admin.problem()
  if (problem) return failOpen(problem)

  const ui = createFormUi()
  const fieldsOf = (l: LessonDraft | undefined, title = ""): LessonFields => ({
    title: l?.title ?? title,
    summary: l?.summary ?? (l ? "" : (props.req.summary ?? "")),
    appliesTo: (l?.appliesTo ?? []).map(refName).join(", "),
    exceptions: l?.exceptions ?? "",
    detail: l?.detail ?? "",
    tags: (l?.tags ?? []).join(", "),
  })
  const opened = fieldsOf(loaded, props.req.title)
  const [draft, setDraft] = createStore<LessonFields>({ ...opened })
  // Names already resolved to subjects: the loaded version's, and any created by a save that then failed.
  const known = new Map<string, SubjectRef>((loaded?.appliesTo ?? []).map((r) => [foldName(refName(r)), r]))
  const [base, setBase] = createSignal<{ draft: LessonDraft; version?: number }>({
    draft: loaded ? { ...loaded } : toLesson(opened),
    version: loaded?.version,
  })

  /** The draft with names as they would resolve now: unknown names read as new sectors. */
  function toLesson(f: LessonFields, refs?: SubjectRef[]): LessonDraft {
    return {
      title: f.title,
      summary: f.summary,
      appliesTo: refs ?? splitList(f.appliesTo).map((n) => known.get(foldName(n)) ?? { newName: n, kind: guessKind(n) }),
      exceptions: f.exceptions.trim() ? f.exceptions : undefined,
      detail: f.detail.trim() ? f.detail : undefined,
      tags: splitList(f.tags),
    }
  }
  const current = () => toLesson(draft)
  const counts = createMemo(() => fieldCounts("lesson", current()))
  const countOf = (field: string) => counts().find((c) => c.field === field)
  const problems = createMemo(() => overLimits(counts()))
  const self = loaded ? { group: "lesson" as const, id: loaded.id } : undefined
  const found = createMemo(() => draftWarnings("lesson", current(), entries, self))
  const warnings = () => found().map((w) => w.message)
  const dirty = createMemo(() => JSON.stringify({ ...draft }) !== JSON.stringify(opened))
  const canConfirm = () => Boolean(draft.title.trim() && draft.summary.trim()) && problems().length === 0

  function save(refs: SubjectRef[]) {
    const mine = toLesson(draft, refs)
    const b = base()
    const edit = loaded && b.version !== undefined ? { id: loaded.id, expected: b.version } : undefined
    const card = props.req.card
    settle(ui, admin.saveLesson(mine, edit, { card: !!card }), {
      saved: (s) => {
        if (card) cardSaved(card.id, { group: "lesson", id: s.id })
      },
      conflict: (cur) => {
        const theirs = cur as LessonDraft & { version: number }
        ui.setStep(
          conflictStep(theirs.version, fieldChanges("lesson", theirs, mine), {
            keepMine: () => {
              setBase({ draft: theirs, version: theirs.version })
              ui.setStep(reviewStep(theirs.version, fieldChanges("lesson", theirs, mine), () => save(refs)))
            },
            takeTheirs: () => {
              for (const r of theirs.appliesTo) known.set(foldName(refName(r)), r)
              setDraft(fieldsOf(theirs))
              setBase({ draft: theirs, version: theirs.version })
              ui.reload()
            },
          }),
        )
      },
      deleted: () =>
        ui.setStep(
          deletedStep("bài học", () => {
            setBase({ draft: base().draft })
            loaded = undefined
            save(refs)
          }),
        ),
      partial: (created) => {
        for (const c of created) {
          const name = c.index === undefined ? undefined : (refs[c.index] as { newName?: string } | undefined)?.newName
          if (name) known.set(foldName(name), { id: c.id, display: c.display })
        }
      },
    })
  }

  /** Every "applies to" name as a subject: known ones, then the notebook; unknown ones are asked about. */
  function resolve(next: (refs: SubjectRef[]) => void) {
    const refs: SubjectRef[] = []
    const unknown: string[] = []
    for (const name of splitList(draft.appliesTo)) {
      const hit = known.get(foldName(name))
      if (hit) {
        refs.push(hit)
        continue
      }
      const look = admin.lookupSubject(name)
      if (!look.ok) return ui.setError(look.message)
      if (look.value.found) refs.push({ id: look.value.found.id, display: look.value.found.display })
      else {
        refs.push({ newName: name, kind: guessKind(name) })
        unknown.push(name)
      }
    }
    if (unknown.length === 0) return next(refs)
    const names = unknown.map((n) => `«${n}»`).join(", ")
    const sectorsOnly = unknown.every((n) => guessKind(n) === "sector")
    const listed = unknown.map((n) => `«${n}» (${guessKind(n) === "ticker" ? "mã" : "ngành"})`).join(", ")
    ui.setStep({
      title: sectorsOnly
        ? `Chưa có chủ đề ${names}. Tạo chủ đề ngành ${names}?`
        : `Chưa có chủ đề ${listed}. Tạo các chủ đề này?`,
      choices: [{ label: "Tạo", run: () => next(refs) }, { label: "Sửa tiếp" }],
    })
  }

  function confirm() {
    const rule = found().find((w) => w.kind === "hard_rule")
    const asConstraint = rule
      ? [
          {
            label: "Lưu thành ràng buộc (chỉ giữ câu này)",
            // A new object at the top level: setState("notebookForm", {...}) merged into the lesson's
            // request and kept its edit: { id }, so the constraint form opened constraint #id.
            run: () =>
              setState({
                notebookForm: {
                  group: "constraint",
                  text: rule.field === "summary" ? draft.summary.trim() : draft.title.trim(),
                  kind: "constraint",
                  fromLesson: true,
                },
              }),
          },
        ]
      : []
    warnFirst(
      ui,
      warnings(),
      () =>
        resolve((refs) => {
          const b = base()
          if (b.version === undefined) return save(refs)
          const changes = fieldChanges("lesson", b.draft, toLesson(draft, refs))
          if (changes.length === 0) return ui.setError(`Chưa có thay đổi nào so với bản ${b.version}.`)
          ui.setStep(reviewStep(b.version, changes, () => save(refs)))
        }),
      asConstraint,
    )
  }

  const line = (id: keyof LessonFields, label: string, extra: Partial<FormField> = {}): FormField => ({
    id,
    label,
    kind: "line",
    initial: draft[id],
    onChange: (v) => setDraft(id, v),
    ...extra,
  })

  return (
    <FormFrame
      ui={ui}
      title={loaded ? `Sửa bài học #${loaded.id}` : "Bài học mới"}
      subtitle={base().version !== undefined ? `Đang sửa từ bản ${base().version}` : undefined}
      fields={[
        line("title", "Tiêu đề", { count: countOf("title") }),
        line("summary", "Tóm tắt", { count: countOf("summary") }),
        line("appliesTo", "Áp dụng cho", { hint: "tên mã hoặc ngành, cách nhau bằng dấu phẩy" }),
        line("exceptions", "Ngoại lệ", { count: countOf("exceptions") }),
        { ...line("detail", "Chi tiết", { count: countOf("detail") }), kind: "text" },
        line("tags", "Tag", { hint: "cách nhau bằng dấu phẩy" }),
      ]}
      info={[FIGURE_GUIDE]}
      problems={problems()}
      warnings={warnings()}
      buttons={[{ id: "confirm", label: "Xác nhận", enabled: canConfirm(), run: confirm }]}
      dirty={dirty()}
    />
  )
}
