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
 * and edits to the user's files. Rules as in Claude Code's Write/Edit tools:
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
    if (!(await stat(abs)).isFile()) throw new Error(`${abs} is a directory.`)
  } catch (error) {
    if (error instanceof Error && error.message.endsWith("is a directory.")) throw error
    return undefined
  }
  return new Uint8Array(await Bun.file(abs).arrayBuffer())
}

/** Why `abs` (currently `bytes`) must not be changed now, or undefined. */
function notReadYet(abs: string, bytes: Uint8Array, state: FileState, whole: boolean): string | undefined {
  const seen = state.get(abs)
  if (!seen) return `${abs} has not been read: call read_file before ${whole ? "overwriting" : "editing"} it (so no unseen content is lost).`
  if (whole && !seen.full) return `Only part of ${abs} has been read: read it whole with read_file before overwriting it, or use edit_file to change the exact place.`
  if (hashBytes(bytes) !== seen.hash) return `${abs} changed since the last read_file (the user or another program edited it). Read it again before writing.`
  return undefined
}

const scopeOf = (deps: WriteDeps, raw: string) =>
  writeCheck(
    deps.workspace.resolve(raw),
    (p) => deps.workspace.contains(p),
    deps.workspace.env(),
    realish,
    (p) => deps.workspace.inScratch(p),
  )

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
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${abs} was just created by another program. Read it with read_file before writing.`)
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
    if (input.content.length > MAX_WRITE_CHARS) return `Content too long (${input.content.length} characters, at most ${MAX_WRITE_CHARS}).`
    const abs = deps.workspace.resolve(input.path)
    const current = await readBytes(abs)
    if (!current) return undefined
    if (isBinary(abs, current)) return `${abs} is a binary file; write_file does not overwrite binary files.`
    return notReadYet(abs, current, deps.state, true)
  }
  return {
    name: "write_file",
    description:
      "Creates or overwrites a whole text file (path relative to the workspace, file name without Vietnamese diacritics). Use when the user wants a result saved as a file (.md, .csv, .json, self-contained .html). " +
      "Do not use to change a few places (use edit_file) or when the user only asks a question. Read an existing file with read_file before overwriting it.",
    input: z.object({
      path: z.string().min(1),
      content: z.string(),
    }),
    ...gateHooks(deps),
    validate,
    async autoSafe(input) {
      const abs = deps.workspace.resolve(input.path)
      return deps.history.createdThisRun(abs) || !(await readBytes(abs).catch(() => undefined))
    },
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
      return current ? `Overwrote ${abs} (${lineCount(text)} lines). The user can undo with /undo.` : `Created ${abs} (${lineCount(text)} lines).`
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
  if (oldString === "") return { error: "old_string is empty: use write_file to create a new file." }
  if (oldString === newString) return { error: "old_string and new_string are identical: nothing to change." }
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
  if (count === 0) return { error: "old_string was not found in the file. Check every character, space and line break (read that part again with read_file); do not copy line numbers into old_string." }
  if (count > 1 && !all) return { error: `old_string occurs ${count} times. Add surrounding lines to make it unique, or set replace_all=true to change every occurrence.` }
  return { text: all ? text.split(target).join(replacement) : text.replace(target, () => replacement), count }
}

export function editFileTool(deps: WriteDeps): ToolDef<EditFileInput> {
  /** The file's bytes, its LF text and the edited LF text, or an error for the model. */
  async function plan(input: EditFileInput) {
    const abs = deps.workspace.resolve(input.path)
    const current = await readBytes(abs)
    if (!current) return { error: `No file ${abs}. Create a new file with write_file.` }
    if (isBinary(abs, current)) return { error: `${abs} is a binary file; edit_file only edits text files.` }
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
      "Edits a passage in an existing text file: replaces old_string with new_string (old_string must match character for character and occur once, unless replace_all=true). " +
      "The file must have been read with read_file in this session; keep the file's indentation and do not copy read_file's line numbers into old_string. " +
      "Use to update a few places in an existing plan, report, note or table. Do not use to create a file or rewrite most of one (use write_file). " +
      "The user approves each edit (the diff is shown in a dialog) and can undo it.",
    input: z.object({
      path: z.string().min(1).describe("Path of the file to edit"),
      old_string: z.string().describe("The passage to replace, copied exactly from the file"),
      new_string: z.string().describe("The new passage"),
      replace_all: z.boolean().optional().describe("Replace every match (default false)"),
    }),
    ...gateHooks(deps),
    async validate(input) {
      const p = await plan(input)
      return "error" in p ? p.error : undefined
    },
    autoSafe: async (input) => deps.history.createdThisRun(deps.workspace.resolve(input.path)),
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
      return `Edited ${p.abs}${p.count > 1 ? ` (${p.count} places)` : ""}: +${diff.added} −${diff.removed} lines. The user can undo with /undo.`
    },
  }
}
