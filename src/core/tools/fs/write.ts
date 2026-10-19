import { mkdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { lineDiff, newFileDiff, type Diff } from "../../fs/diff"
import { hashBytes, type FileState } from "../../fs/file-state"
import type { FileHistory } from "../../fs/history"
import { writeCheck } from "../../fs/path-safety"
import { decodeFile, encodeFile, isBinary, splitLines } from "../../fs/text"
import { realish, type Workspace } from "../../fs/workspace"
import { LOCAL_SOURCE, type ApprovalPreview, type ToolDef } from "../types"

/**
 * write_file / edit_file: the agent's artifacts (plans, reports, CSV tables, HTML pages)
 * and edits to the user's files. Rules from Claude Code's FileWriteTool/FileEditTool:
 * - an existing file is changed only after read_file showed it (whole, for an overwrite) and
 *   only while it is unchanged since (checked again under the write lock: compare and swap);
 * - encoding, BOM and CRLF of an existing file are kept;
 * - a new file is created exclusively (`wx`), so a file that appeared meanwhile is not lost;
 * - every change is copied first (FileHistory) so /undo can put it back.
 * Where a write may go is the permission gate's business (writeCheck → askFor/blockFor).
 */

export interface WriteDeps {
  workspace: Workspace
  state: FileState
  history: FileHistory
}

export type WriteFileInput = { path: string; content: string }
export type EditFileInput = { path: string; old_string: string; new_string: string; replace_all?: boolean }

const MAX_WRITE_CHARS = 2_000_000

async function readBytes(abs: string): Promise<Uint8Array | undefined> {
  try {
    if (!(await stat(abs)).isFile()) throw new Error(`${abs} là thư mục.`)
  } catch (error) {
    if (error instanceof Error && error.message.endsWith("là thư mục.")) throw error
    return undefined
  }
  return new Uint8Array(await Bun.file(abs).arrayBuffer())
}

/** Why `abs` (currently `bytes`) must not be changed now, or undefined. */
function notReadYet(abs: string, bytes: Uint8Array, state: FileState, whole: boolean): string | undefined {
  const seen = state.get(abs)
  if (!seen) return `Chưa đọc ${abs}: gọi read_file trước khi ${whole ? "ghi đè" : "sửa"} (để không mất nội dung chưa xem).`
  if (whole && !seen.full) return `Mới đọc một phần ${abs}: đọc toàn bộ bằng read_file trước khi ghi đè cả file, hoặc dùng edit_file để sửa đúng chỗ.`
  if (hashBytes(bytes) !== seen.hash) return `${abs} đã thay đổi kể từ lần read_file gần nhất (người dùng hoặc chương trình khác sửa). Đọc lại rồi mới ghi.`
  return undefined
}

const scopeOf = (deps: WriteDeps, raw: string) => writeCheck(deps.workspace.resolve(raw), (p) => deps.workspace.contains(p), deps.workspace.env(), realish)

/** The gate hooks both tools share: where (askFor/blockFor), what for rules (subject), one session group. */
function gateHooks(deps: WriteDeps) {
  return {
    effect: "file" as const,
    approvalGroup: "file-edit",
    readOnly: false,
    // Sent by name only in ‖ read-only mode (tool search); declared in full in ▸ (agent.ts).
    deferrable: true,
    source: LOCAL_SOURCE,
    blockFor: (input: { path: string }) => {
      const check = scopeOf(deps, input.path)
      return "block" in check ? check.block : undefined
    },
    askFor: (input: unknown) => {
      const raw = (input as { path?: string }).path
      if (typeof raw !== "string") return undefined
      const check = scopeOf(deps, raw)
      return "scope" in check ? check.scope : undefined
    },
    subject: (input: { path: string }) => deps.workspace.resolve(input.path),
  }
}

/** Content as it will be written to an existing file: its line endings, then its encoding. */
function encodeLike(content: string, existing: Uint8Array | undefined) {
  if (!existing) return { bytes: encodeFile(content, "utf8"), text: content }
  const { encoding, eol } = decodeFile(existing)
  const text = eol === "\r\n" && !content.includes("\r\n") ? content.replace(/\n/g, "\r\n") : content
  return { bytes: encodeFile(text, encoding), text }
}

async function commitWrite(deps: WriteDeps, abs: string, before: Uint8Array | undefined, bytes: Uint8Array, tool: string) {
  const pending = await deps.history.before(abs, before)
  if (before) await writeFile(abs, bytes)
  else {
    await mkdir(path.dirname(abs), { recursive: true })
    try {
      await writeFile(abs, bytes, { flag: "wx" })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${abs} vừa được tạo bởi chương trình khác. Đọc nó bằng read_file trước khi ghi.`)
      throw error
    }
  }
  const change = await pending.commit(bytes, tool)
  const info = await stat(abs)
  deps.state.record(abs, { mtimeMs: info.mtimeMs, size: info.size, hash: hashBytes(bytes), full: true })
  return change
}

const lineCount = (text: string) => splitLines(text).length

const previewOf = (title: string, d: Diff): ApprovalPreview => ({ title, diff: d.lines, added: d.added, removed: d.removed })

export function writeFileTool(deps: WriteDeps): ToolDef<WriteFileInput> {
  async function validate(input: WriteFileInput) {
    if (input.content.length > MAX_WRITE_CHARS) return `Nội dung quá dài (${input.content.length} ký tự, tối đa ${MAX_WRITE_CHARS}).`
    const abs = deps.workspace.resolve(input.path)
    const current = await readBytes(abs)
    if (!current) return undefined
    if (isBinary(abs, current)) return `${abs} là file nhị phân; write_file không ghi đè file nhị phân.`
    return notReadYet(abs, current, deps.state, true)
  }
  return {
    name: "write_file",
    description:
      "Tạo file mới hoặc ghi đè cả một file text trên máy người dùng (đường dẫn tuyệt đối, hoặc tương đối tính từ workspace; thư mục cha được tạo nếu thiếu). " +
      "Dùng khi người dùng muốn lưu kết quả thành file: kế hoạch/báo cáo/ghi chú .md, bảng .csv, trang .html trực quan (biểu đồ, bảng; viết tự chứa: CSS, JS, SVG nội tuyến, không tải script từ mạng), dữ liệu .json. " +
      "Đặt file trong workspace, tên file không dấu, ví dụ bao-cao/ke-hoach-FPT.md. Ghi đè file đã có thì phải read_file toàn bộ file đó trước. " +
      "Không dùng khi chỉ sửa vài chỗ trong file có sẵn (dùng edit_file) hoặc khi người dùng chỉ hỏi đáp (trả lời trực tiếp, không tạo file). " +
      "Mỗi lần ghi người dùng duyệt (diff hiện trong hộp thoại) và có thể hoàn tác.",
    input: z.object({
      path: z.string().min(1).describe("Đường dẫn file, ví dụ bao-cao/ke-hoach-FPT.md hoặc D:\\Dau-tu\\so-sanh.csv"),
      content: z.string().describe("Toàn bộ nội dung file"),
    }),
    ...gateHooks(deps),
    validate,
    async preview(input) {
      const abs = deps.workspace.resolve(input.path)
      const current = await readBytes(abs)
      if (!current) {
        const diff = newFileDiff(input.content)
        return previewOf(`${abs} (mới, ${diff.added} dòng)`, diff)
      }
      const diff = lineDiff(decodeFile(current).text.replace(/\r\n/g, "\n"), input.content.replace(/\r\n/g, "\n"))
      return previewOf(`${abs} (ghi đè, +${diff.added} −${diff.removed} dòng)`, diff)
    },
    summarize: (input) => `write_file ${input.path}`,
    async execute(input) {
      const abs = deps.workspace.resolve(input.path)
      // Again under the write lock: the user may have edited the file while the prompt was up.
      const invalid = await validate(input)
      if (invalid) throw new Error(invalid)
      const current = await readBytes(abs)
      const { bytes, text } = encodeLike(input.content, current)
      await commitWrite(deps, abs, current, bytes, "write_file")
      return current ? `Đã ghi đè ${abs} (${lineCount(text)} dòng). Người dùng hoàn tác được bằng /undo.` : `Đã tạo ${abs} (${lineCount(text)} dòng).`
    },
  }
}

const CURLY = /[‘’‚‛“”„‟]/g
const HAS_CURLY = /[‘’‚‛“”„‟]/
const straight = (s: string) => s.replace(CURLY, (c) => ("‘’‚‛".includes(c) ? "'" : '"'))

/** Straight quotes in `text` styled like the file's curly ones (opening after a space or bracket). */
function curlify(text: string) {
  return text.replace(/["']/g, (q, i: number) => {
    const before = i === 0 ? " " : text[i - 1]!
    const opening = /[\s([{—–-]/.test(before)
    if (q === '"') return opening ? "“" : "”"
    return opening ? "‘" : "’"
  })
}

/** The edited text, or why it cannot be done. Works on LF text; the caller restores CRLF. */
export function applyEdit(text: string, oldString: string, newString: string, all = false): { text: string; count: number } | { error: string } {
  if (oldString === "") return { error: "old_string rỗng: tạo file mới thì dùng write_file." }
  if (oldString === newString) return { error: "old_string và new_string giống hệt nhau: không có gì để sửa." }
  let target = oldString.replace(/\r\n/g, "\n")
  let replacement = newString.replace(/\r\n/g, "\n")
  let count = text.split(target).length - 1
  if (count === 0) {
    // The file has curly quotes where the model typed straight ones (Word exports).
    const at = straight(text).indexOf(straight(target))
    if (at >= 0) {
      const actual = text.slice(at, at + target.length)
      if (HAS_CURLY.test(actual)) replacement = curlify(replacement)
      target = actual
      count = text.split(target).length - 1
    }
  }
  if (count === 0) return { error: "Không tìm thấy old_string trong file. Kiểm tra lại từng ký tự, khoảng trắng và xuống dòng (đọc lại đoạn đó bằng read_file); không chép số dòng vào old_string." }
  if (count > 1 && !all) return { error: `old_string xuất hiện ${count} lần. Thêm vài dòng xung quanh cho duy nhất, hoặc đặt replace_all=true để sửa mọi chỗ.` }
  return { text: all ? text.split(target).join(replacement) : text.replace(target, () => replacement), count }
}

export function editFileTool(deps: WriteDeps): ToolDef<EditFileInput> {
  /** The file's bytes, its LF text and the edited LF text, or an error for the model. */
  async function plan(input: EditFileInput) {
    const abs = deps.workspace.resolve(input.path)
    const current = await readBytes(abs)
    if (!current) return { error: `Không có file ${abs}. Tạo file mới bằng write_file.` }
    if (isBinary(abs, current)) return { error: `${abs} là file nhị phân; edit_file chỉ sửa file text.` }
    const stale = notReadYet(abs, current, deps.state, false)
    if (stale) return { error: stale }
    const decoded = decodeFile(current)
    const before = decoded.text.replace(/\r\n/g, "\n")
    const edited = applyEdit(before, input.old_string, input.new_string, input.replace_all)
    if ("error" in edited) return { error: edited.error }
    return { abs, current, decoded, before, after: edited.text, count: edited.count }
  }
  return {
    name: "edit_file",
    description:
      "Sửa một đoạn trong file text đã có: thay old_string bằng new_string (old_string phải khớp đúng từng ký tự và chỉ xuất hiện một lần, trừ khi replace_all=true). " +
      "Phải read_file file đó trước trong phiên; giữ nguyên thụt đầu dòng như trong file, không chép số dòng của read_file vào old_string. " +
      "Dùng khi cập nhật vài chỗ trong kế hoạch, báo cáo, ghi chú hay bảng số liệu có sẵn. Không dùng khi tạo file mới hoặc viết lại gần hết file (dùng write_file). " +
      "Mỗi lần sửa người dùng duyệt (diff hiện trong hộp thoại) và có thể hoàn tác.",
    input: z.object({
      path: z.string().min(1).describe("Đường dẫn file cần sửa"),
      old_string: z.string().describe("Đoạn cần thay, chép đúng từ file"),
      new_string: z.string().describe("Đoạn mới"),
      replace_all: z.boolean().optional().describe("Thay mọi chỗ khớp (mặc định false)"),
    }),
    ...gateHooks(deps),
    async validate(input) {
      const p = await plan(input)
      return "error" in p ? p.error : undefined
    },
    async preview(input) {
      const p = await plan(input)
      if ("error" in p) return undefined
      const diff = lineDiff(p.before, p.after)
      return previewOf(`${p.abs} (sửa${p.count > 1 ? ` ${p.count} chỗ` : ""}, +${diff.added} −${diff.removed} dòng)`, diff)
    },
    summarize: (input) => `edit_file ${input.path}`,
    async execute(input) {
      // Planned again under the write lock (compare and swap with what read_file saw).
      const p = await plan(input)
      if ("error" in p) throw new Error(p.error)
      const text = p.decoded.eol === "\r\n" ? p.after.replace(/\n/g, "\r\n") : p.after
      await commitWrite(deps, p.abs, p.current, encodeFile(text, p.decoded.encoding), "edit_file")
      const diff = lineDiff(p.before, p.after)
      return `Đã sửa ${p.abs}${p.count > 1 ? ` (${p.count} chỗ)` : ""}: +${diff.added} −${diff.removed} dòng. Người dùng hoàn tác được bằng /undo.`
    },
  }
}
