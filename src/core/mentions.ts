import type { ModelMessage } from "ai"
import { stat } from "node:fs/promises"
import path from "node:path"
import type { FileState } from "./fs/file-state"
import { readScope } from "./fs/path-safety"
import { realish, type Workspace } from "./fs/workspace"
import { readFileAt } from "./tools/fs/read"
import type { ToolResult } from "./tools/types"

/**
 * `@path` in a message: the file is read for the model before the turn, so it never has to
 * be asked to (Claude Code's at-mentions, opencode's file parts). Like both, the content goes
 * as text — "harness đã đọc sẵn bằng read_file" — not as a fake tool call: Gemini 3 checks
 * the thought signatures of function calls in history.
 *
 * Every later request resends the history, so (what the user chose, after Claude Code):
 * - a file is cut at MENTION_FILE_CHARS, a message at MENTION_TOTAL_CHARS; past that the
 *   model gets a note to read on with read_file;
 * - a file attached again unchanged (same path, lines and mtime, its content still in the
 *   history) sends one line instead of the content;
 * - old attachments are cleared in batches (compact.ts pruneAttachments).
 */

export const MENTION_TAG = "tep_dinh_kem"
export const MAX_MENTIONS = 10
export const MENTION_FILE_CHARS = 20_000
export const MENTION_TOTAL_CHARS = 50_000
/** Less room than this left in the message: the file is named, not sent. */
const MIN_ROOM = 1_000

export interface Mention {
  path: string
  /** `#L10-20` (or `#10-20`): 1-based lines; `to` absent = to the end. */
  from?: number
  to?: number
}

// `@` at the start or after a space (never inside an e-mail address), then `"a path"` (its
// line range may follow the closing quote: `@"báo cáo.md"#L3-4`) or a word.
const MENTION = /(^|\s)@(?:"([^"\n]+)"(#L?\d+(?:-\d+)?)?|([^\s"]+))/g
const RANGE = /#L?(\d+)(?:-(\d+))?$/
const TRAILING = /[,.;:!?)\]}'»]+$/

function withRange(raw: string): Mention {
  const m = RANGE.exec(raw)
  if (!m) return { path: raw }
  const from = Number(m[1])
  const to = m[2] ? Number(m[2]) : undefined
  return { path: raw.slice(0, m.index), from: from || 1, to: to !== undefined && to >= from ? to : undefined }
}

/**
 * The `@` mentions of a message, each with the readings to try in order: a bare word may end
 * in the sentence's punctuation ("xem @ghi-chu.md, rồi…").
 */
export function parseMentions(text: string): Mention[][] {
  const out: Mention[][] = []
  for (const m of text.matchAll(MENTION)) {
    const quoted = m[2]
    if (quoted) {
      out.push([withRange(quoted + (m[3] ?? ""))])
      continue
    }
    const raw = m[4]!
    const tries = [withRange(raw)]
    const bare = raw.replace(TRAILING, "")
    if (bare && bare !== raw) tries.push(withRange(bare))
    out.push(tries)
  }
  return out
}

/** How the prompt writes a picked path: quoted when it has a space. */
export const mentionText = (rel: string) => (/\s/.test(rel) ? `@"${rel}"` : `@${rel}`)

const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
const unescapeAttr = (v: string) => v.replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&")

/** `<tep_dinh_kem k="v" …>body</tep_dinh_kem>`; the body cannot close the tag early. */
export function attachmentTag(attrs: Record<string, string | undefined>, body: string) {
  const head = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeAttr(v!)}"`)
    .join("")
  return `<${MENTION_TAG}${head}>\n${body.replaceAll(`</${MENTION_TAG}`, `<\\/${MENTION_TAG}`)}\n</${MENTION_TAG}>`
}

export const isAttachmentText = (text: string) => text.startsWith(`<${MENTION_TAG} `)

/** The attributes of an attachment part, or undefined for any other text. */
export function attachmentAttrs(text: string): Record<string, string> | undefined {
  if (!isAttachmentText(text)) return undefined
  const head = /^<\S+([^>]*)>/.exec(text)?.[1] ?? ""
  return Object.fromEntries([...head.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1]!, unescapeAttr(m[2]!)]))
}

/** An attachment that carries the file's content (not a stub, a note or a cleared one). */
const carriesContent = (a: Record<string, string>) => !a.da_gui && !a.da_don && !a.loi && !a.bo_qua && !a.tham_chieu

const keyOf = (a: { path?: string; mtime?: string; dong?: string }) => `${a.path}|${a.mtime}|${a.dong ?? ""}`

/** Same file, same lines, same version: what dedup and pruning compare. */
export function attachmentKey(text: string) {
  const a = attachmentAttrs(text)
  return a ? keyOf(a) : undefined
}

/** Keys of attachments whose content is still in `messages`. */
function sentBefore(messages: readonly ModelMessage[]) {
  const keys = new Set<string>()
  for (const m of messages) {
    if (m.role !== "user" || typeof m.content === "string") continue
    for (const p of m.content) {
      const a = p.type === "text" ? attachmentAttrs(p.text) : undefined
      if (a && carriesContent(a)) keys.add(keyOf(a))
    }
  }
  return keys
}

/** One line under the user's message in the transcript. */
export interface AttachedFile {
  path: string
  ok: boolean
  note: string
}

export interface Attachments {
  /** Text parts for the model, after what the user typed. */
  parts: string[]
  images: { data: string; mediaType: string }[]
  files: AttachedFile[]
}

const fmt = (n: number) => n.toLocaleString("vi-VN")

/** "120 dòng", "dòng 1–410/1.400" from read_file's header. */
function linesNote(output: string) {
  const total = /· (\d+) (?:dòng|trang)/.exec(output)?.[1]
  const shown = /đang hiện (?:dòng|trang) (\d+)–(\d+)/.exec(output)
  if (shown && total) return `dòng ${fmt(Number(shown[1]))}–${fmt(Number(shown[2]))}/${fmt(Number(total))}`
  return total ? `${fmt(Number(total))} dòng` : undefined
}

/** Cut at a line break under `max` characters, saying where the rest is. */
function capped(output: string, max: number, display: string) {
  if (output.length <= max + 2_000) return { text: output, cut: false }
  const at = output.lastIndexOf("\n", max)
  return {
    text: `${output.slice(0, at > 0 ? at : max)}\n\n(đã cắt ở ${fmt(max)} ký tự để tiết kiệm context; gọi read_file(path="${display}") với offset/pages để đọc phần còn lại)`,
    cut: true,
  }
}

export interface AttachOptions {
  workspace: Workspace
  /** Read state for edit_file: an attached file counts as read. */
  files?: FileState
  /** What the model already has: unchanged files attached again are not resent. */
  history: readonly ModelMessage[]
  /** The model reads images. */
  images: boolean
}

/** Read the files `text` mentions (inside the workspace, existing) for the model. */
export async function attachMentions(text: string, opts: AttachOptions): Promise<Attachments> {
  const out: Attachments = { parts: [], images: [], files: [] }
  const ws = opts.workspace
  const seen = new Set<string>()
  const sent = sentBefore(opts.history)
  let used = 0

  for (const tries of parseMentions(text)) {
    if (out.files.length >= MAX_MENTIONS) break
    // The first reading that names something in the workspace.
    let found: { mention: Mention; abs: string; dir: boolean; mtime: number } | undefined
    for (const mention of tries) {
      if (!mention.path) continue
      const abs = ws.resolve(mention.path)
      if (!ws.contains(abs)) continue
      try {
        const info = await stat(abs)
        found = { mention, abs, dir: info.isDirectory(), mtime: Math.floor(info.mtimeMs) }
        break
      } catch {
        // not there: a word that only looks like a path
      }
    }
    if (!found) continue
    const { mention, abs, dir, mtime } = found
    const rel = path.relative(ws.primary, abs)
    const display = (rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : abs) + (dir ? "/" : "")
    const dong = mention.from ? `${mention.from}-${mention.to ?? ""}` : undefined
    const attrs = { path: display, mtime: String(mtime), dong }
    const key = keyOf(attrs)
    if (seen.has(key)) continue
    seen.add(key)

    // Key files, credential folders, network paths: read_file asks first; so does this.
    if (readScope(abs, ws.env(), realish)) {
      out.parts.push(attachmentTag({ ...attrs, bo_qua: "1" }, `Người dùng gắn @${display} nhưng đây là file nhạy cảm (khoá, mật khẩu hoặc đường dẫn mạng) nên harness không tự đọc. Nếu thật sự cần, gọi read_file: người dùng sẽ được hỏi.`))
      out.files.push({ path: display, ok: false, note: `Không tự đọc ${display}: file nhạy cảm` })
      continue
    }
    if (sent.has(key)) {
      out.parts.push(attachmentTag({ ...attrs, da_gui: "1" }, `Người dùng gắn lại @${display}; file không đổi so với bản đã gắn ở trên trong hội thoại.`))
      out.files.push({ path: display, ok: true, note: `${display} (không đổi, đã gửi trước)` })
      continue
    }
    const room = MENTION_TOTAL_CHARS - used
    if (room < MIN_ROOM) {
      out.parts.push(attachmentTag({ ...attrs, tham_chieu: "1" }, `Người dùng gắn @${display} nhưng tin nhắn đã đủ giới hạn nội dung file gắn kèm; gọi read_file(path="${display}") nếu cần.`))
      out.files.push({ path: display, ok: true, note: `${display} (chưa gửi nội dung: quá giới hạn của tin nhắn)` })
      continue
    }
    const cap = Math.min(MENTION_FILE_CHARS, room)
    const call = `read_file(path="${display}"${mention.from ? `, offset=${mention.from}` : ""}${mention.to ? `, limit=${mention.to - mention.from! + 1}` : ""})`
    let result: string | ToolResult
    try {
      result = await readFileAt(abs, { offset: mention.from, limit: mention.to ? mention.to - mention.from! + 1 : undefined, maxChars: cap }, opts.files)
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      out.parts.push(attachmentTag({ ...attrs, loi: "1" }, `Người dùng gắn @${display}; harness gọi ${call} nhưng lỗi: ${why}`))
      out.files.push({ path: display, ok: false, note: `Không đọc được ${display}: ${why}` })
      continue
    }
    if (typeof result !== "string") {
      // An image: it goes with the message when the model can see it.
      if (opts.images && result.images?.length) {
        out.images.push(...result.images)
        out.parts.push(attachmentTag(attrs, `Người dùng gắn ảnh @${display}; ảnh đi kèm tin nhắn này. ${result.output}`))
        out.files.push({ path: display, ok: true, note: `Đã gắn ảnh ${display}` })
      } else {
        out.parts.push(attachmentTag({ ...attrs, bo_qua: "1" }, `Người dùng gắn ảnh @${display} nhưng model hiện tại không đọc được ảnh.`))
        out.files.push({ path: display, ok: false, note: `Không gửi ảnh ${display}: model này không đọc được ảnh` })
      }
      continue
    }
    const body = capped(result, cap, display)
    used += body.text.length
    out.parts.push(attachmentTag(attrs, `Người dùng gắn @${display} nên harness đã đọc sẵn bằng ${call}; không cần đọc lại phần này. Kết quả:\n${body.text}`))
    const lines = dir ? undefined : linesNote(result)
    out.files.push({ path: display, ok: true, note: `Đã đọc ${dir ? `thư mục ${display}` : display}${lines ? ` (${lines})` : ""}${body.cut ? " · đã cắt bớt" : ""}` })
  }
  return out
}

/** The transcript line of an attachment rebuilt from its tag (resumed sessions). */
export function attachedFromTag(text: string): AttachedFile | undefined {
  const a = attachmentAttrs(text)
  if (!a?.path) return undefined
  if (a.loi || a.bo_qua) return { path: a.path, ok: false, note: `Không đọc ${a.path}` }
  if (a.da_gui) return { path: a.path, ok: true, note: `${a.path} (không đổi, đã gửi trước)` }
  return { path: a.path, ok: true, note: `Đã gắn ${a.path}` }
}

/** The text parts of a user message that are attachments. */
export function attachmentsOf(message: ModelMessage): string[] {
  if (message.role !== "user" || typeof message.content === "string") return []
  return message.content.flatMap((p) => (p.type === "text" && isAttachmentText(p.text) ? [p.text] : []))
}

/**
 * "Unchanged, see above" stubs whose content is no longer above (compaction summarized it
 * away): they become a cleared attachment, which tells the model to read the file again.
 */
export function withoutOrphanStubs(messages: readonly ModelMessage[]): ModelMessage[] {
  const present = new Set<string>()
  return messages.map((message) => {
    if (message.role !== "user" || typeof message.content === "string" || attachmentsOf(message).length === 0) return message
    let changed = false
    const content = message.content.map((part) => {
      const a = part.type === "text" ? attachmentAttrs(part.text) : undefined
      if (!a || part.type !== "text") return part
      if (carriesContent(a)) present.add(keyOf(a))
      if (!a.da_gui || present.has(keyOf(a))) return part
      changed = true
      return { ...part, text: attachmentTag({ path: a.path, mtime: a.mtime, dong: a.dong, da_don: "1" }, `(nội dung @${a.path} không còn trong hội thoại; gọi read_file nếu cần)`) }
    })
    return changed ? ({ ...message, content } as ModelMessage) : message
  })
}

/** An attachment whose content was cleared from history (pruneAttachments). */
export function clearedAttachment(text: string): string | undefined {
  const a = attachmentAttrs(text)
  if (!a || !carriesContent(a)) return undefined
  return attachmentTag({ path: a.path, mtime: a.mtime, dong: a.dong, da_don: "1" }, `(nội dung @${a.path} đã dọn để tiết kiệm context; gọi read_file nếu cần)`)
}
