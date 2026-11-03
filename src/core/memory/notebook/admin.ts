import { MemoryStoreError } from "../store/errors"
import type { MemoryReader, MemoryWriter } from "../store/open"
import type { Source } from "../store/types"
import type { MemoryProvider } from "../types"
import { formatDate, THESIS_STATE_LABEL } from "./render"

/**
 * The /memory screen's handle on the notebook: the user's own read (every kind, decisions included)
 * and the four deletes, each checked against the version on screen. It is an object capability: the
 * provider handed to the agent loop holds no reference to it, and only code that imports this module
 * can look it up (a test checks that only the /memory dialogs do, outside this folder).
 */

export type NotebookGroup = "constraint" | "style" | "thesis" | "lesson" | "decision"

export interface NotebookEntry {
  group: NotebookGroup
  /** Thesis: the subject's id. */
  id: number
  /** Absent for decisions (they are appended, never revised). */
  version?: number
  /** One line for the list. */
  title: string
  /** Everything stored, for the detail view (plain text: a screen, not a prompt). */
  detail: string
  state?: string
  createdAt: string
}

export type RemoveResult =
  | { ok: true; message: string }
  | { ok: false; reason: "conflict" | "busy" | "deleted" | "failed"; message: string; currentVersion?: number }

export interface NotebookAdmin {
  readonly path: string
  /** Why the notebook cannot be read or changed now, if it cannot. */
  problem(): string | undefined
  entries(): NotebookEntry[]
  remove(group: NotebookGroup, key: { id: number; version?: number }): RemoveResult
}

/** What lifecycle.ts hands over: the store's user side, while it is open. */
export interface AdminSide {
  readonly path: string
  reader(): MemoryReader | undefined
  writer(): MemoryWriter | undefined
  problem(): MemoryStoreError | undefined
  closed(): boolean
}

const admins = new WeakMap<object, NotebookAdmin>()

/** Called by lifecycle.ts when it opens a notebook; once per provider. */
export function grantNotebookAdmin(provider: MemoryProvider, admin: NotebookAdmin): void {
  if (admins.has(provider)) throw new Error("This notebook already has an admin handle")
  admins.set(provider, admin)
}

/** The handle for a notebook provider; undefined for any other memory (off, the legacy file memory). */
export function notebookAdmin(memory: MemoryProvider): NotebookAdmin | undefined {
  return admins.get(memory)
}

const SOURCE: Record<Source, string> = {
  manual: "tự ghi",
  card: "từ thẻ gợi ý",
  investor_import: "nhập từ INVESTOR.md",
}
const saved = (version: number | undefined, at: string, source: Source) =>
  `${version === undefined ? "" : `Bản ${version} · `}lưu ${formatDate(at)} · nguồn: ${SOURCE[source]}`
const firstLine = (text: string) => text.split(/\r?\n/, 1)[0]!
const lines = (...parts: (string | false | undefined)[]) => parts.filter((p): p is string => !!p).join("\n")

function readEntries(r: MemoryReader): NotebookEntry[] {
  const out: NotebookEntry[] = []
  for (const kind of ["constraint", "style"] as const) {
    for (const c of r.constraints(kind)) {
      out.push({
        group: kind,
        id: c.id,
        version: c.version,
        title: firstLine(c.text),
        detail: lines(c.text, "", saved(c.version, c.createdAt, c.source)),
        createdAt: c.createdAt,
      })
    }
  }
  const subjects = r.subjects()
  const name = (id: number) => subjects.find((s) => s.id === id)?.display ?? `#${id}`
  for (const s of subjects) {
    const t = s.currentVersion === undefined ? undefined : r.thesis(s.id)
    if (!t) continue
    const state = THESIS_STATE_LABEL[s.thesisState] ?? s.thesisState
    out.push({
      group: "thesis",
      id: s.id,
      version: t.version,
      title: s.display,
      state,
      detail: lines(
        `Trạng thái: ${state}`,
        `Luận điểm: ${t.text}`,
        t.conditions.length > 0 && `Sai nếu:\n${t.conditions.map((c, i) => `  (${i + 1}) ${c}`).join("\n")}`,
        t.reviewBy && `Hạn xem lại: ${formatDate(t.reviewBy)}`,
        t.detail && `Chi tiết: ${t.detail}`,
        s.sectorId !== undefined && `Ngành: ${name(s.sectorId)}`,
        `Bí danh: ${s.aliases.filter((a) => !a.retiredAt).map((a) => a.alias).join(", ")}`,
        "",
        saved(t.version, t.validFrom, t.source),
      ),
      createdAt: t.validFrom,
    })
  }
  for (const l of r.lessons()) {
    out.push({
      group: "lesson",
      id: l.id,
      version: l.version,
      title: l.title,
      detail: lines(
        `Tiêu đề: ${l.title}`,
        `Tóm tắt: ${l.summary}`,
        l.appliesTo.length > 0 && `Áp dụng cho: ${l.appliesTo.map(name).join(", ")}`,
        l.exceptions && `Ngoại lệ: ${l.exceptions}`,
        l.detail && `Chi tiết: ${l.detail}`,
        l.tags.length > 0 && `Tag: ${l.tags.join(", ")}`,
        "",
        saved(l.version, l.createdAt, l.source),
      ),
      createdAt: l.createdAt,
    })
  }
  for (const d of r.decisions()) {
    if ("deleted" in d) continue
    out.push({
      group: "decision",
      id: d.id,
      title: `D${d.id} ${firstLine(d.action)}`,
      detail: lines(
        `Mã: ${name(d.subjectId)}`,
        `Hành động: ${d.action}`,
        `Lý do: ${d.reason}`,
        d.expectation && `Kỳ vọng: ${d.expectation}`,
        d.confidence && `Độ tin: ${d.confidence}`,
        d.reviewOn && `Xem lại ngày: ${formatDate(d.reviewOn)}`,
        d.changeMind && `Đổi ý khi: ${d.changeMind}`,
        d.basis !== "none" && `Dựa trên luận điểm bản ${d.basis.version}${d.basis.deleted ? " (đã xoá)" : ""}`,
        "",
        saved(undefined, d.createdAt, d.source),
        "Quyết định chỉ nằm trên máy này; không bao giờ được gửi cho model.",
      ),
      createdAt: d.createdAt,
    })
  }
  return out
}

/** The wording the user chose for "stopped using" (a deleted copy already sent cannot be recalled). */
const stopped = (what: string) =>
  `Đã ngừng dùng ${what}: model không còn nhận mục này. Nội dung đã gửi trước đây vẫn còn trong lịch sử các phiên đã dùng nó; trong hội thoại đang mở, model được dặn không dùng nữa. Bản đã gửi provider không thu hồi được.`

export function createNotebookAdmin(side: AdminSide): NotebookAdmin {
  let readProblem: string | undefined
  const unavailable = () =>
    side.closed()
      ? "Sổ ghi nhớ đã tắt."
      : side.problem()
        ? `Sổ ghi nhớ chưa mở được: ${side.problem()!.message}`
        : undefined

  return Object.freeze({
    path: side.path,
    problem: () => unavailable() ?? readProblem,
    entries(): NotebookEntry[] {
      const reader = side.closed() ? undefined : side.reader()
      if (!reader) return []
      try {
        const out = readEntries(reader)
        readProblem = undefined
        return out
      } catch (error) {
        if (!(error instanceof MemoryStoreError)) throw error
        readProblem = error.message
        return []
      }
    },
    remove(group: NotebookGroup, key: { id: number; version?: number }): RemoveResult {
      const writer = side.closed() ? undefined : side.writer()
      const reader = side.reader()
      if (!writer || !reader) {
        return { ok: false, reason: "failed", message: unavailable() ?? "Sổ ghi nhớ chưa mở được." }
      }
      try {
        // Decisions have no version: they are appended, never revised.
        const version = key.version ?? 0
        let message: string
        switch (group) {
          case "constraint":
            writer.deleteConstraint(key.id, version)
            message = `Đã ngừng dùng ràng buộc #${key.id}: model không còn nhận mục này từ lượt sau. Bản đã gửi provider không thu hồi được.`
            break
          case "style":
            writer.deleteConstraint(key.id, version)
            message = `Đã ngừng dùng cách trình bày #${key.id}: model không còn nhận mục này từ lượt sau. Bản đã gửi provider không thu hồi được.`
            break
          case "thesis": {
            const display = reader.subject(key.id)?.display ?? `#${key.id}`
            writer.deleteThesis(key.id, version)
            message = stopped(`luận điểm ${display}`)
            break
          }
          case "lesson":
            writer.deleteLesson(key.id, version)
            message = stopped(`bài học #${key.id}`)
            break
          case "decision":
            writer.deleteDecision(key.id)
            message = `Đã xoá quyết định D${key.id} khỏi ứng dụng. Quyết định chưa bao giờ được gửi cho model.`
            break
        }
        return { ok: true, message }
      } catch (error) {
        // The one place store errors become what the screen says.
        if (!(error instanceof MemoryStoreError)) throw error
        const current = (error.current as { version?: number } | undefined)?.version
        if (error.kind === "conflict" && current !== undefined) {
          return {
            ok: false,
            reason: "conflict",
            currentVersion: current,
            message: `Mục này vừa được sửa ở nơi khác (đang là bản ${current}). Mở lại để xem bản mới.`,
          }
        }
        // A thesis deleted elsewhere shows up as a conflict with nothing current.
        if (error.kind === "conflict" || error.kind === "deleted" || error.kind === "not_found") {
          return { ok: false, reason: "deleted", message: "Mục này đã bị xoá ở nơi khác. Mở lại để xem danh sách mới." }
        }
        if (error.kind === "busy") {
          return { ok: false, reason: "busy", message: "Kho memory đang bận (cửa sổ OpenTrading khác đang ghi). Thử lại." }
        }
        return { ok: false, reason: "failed", message: error.message }
      }
    },
  })
}
