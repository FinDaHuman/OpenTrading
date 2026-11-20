import { stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { readScope } from "../../fs/path-safety"
import { decodeFile, isBinary, splitLines } from "../../fs/text"
import { walkFiles, type WalkEntry } from "../../fs/walk"
import { realish, type Workspace } from "../../fs/workspace"
import { LOCAL_SOURCE, type ToolDef } from "../types"

/**
 * glob_files / grep_files over a folder (the workspace by default). Pure TypeScript so it
 * works without ripgrep on a stock Windows machine; VCS/package folders are pruned and key
 * files are never opened (walk.ts). Results sort newest first (Claude Code Glob/Grep).
 */

export const GLOB_LIMIT = 100
export const GREP_HEAD_LIMIT = 250
/** The same cap as read_file's text files: whatever it can read, grep can search. */
export const GREP_MAX_FILE_BYTES = 20 * 1024 * 1024
const GREP_MAX_LINE = 500

/** Root to search: the given folder or the workspace; asks first when it is a secret tree. */
function rootOf(workspace: Workspace, raw: string | undefined) {
  return raw ? workspace.resolve(raw) : workspace.primary
}

/** A search root that is a network path, an odd Windows spelling or a secret tree (also via symlinks) asks first. */
const secretRoot = (workspace: Workspace) => (input: unknown) => {
  const raw = (input as { path?: string }).path
  return raw ? readScope(workspace.resolve(raw), workspace.env(), realish) : undefined
}

async function ensureDir(abs: string) {
  try {
    if (!(await stat(abs)).isDirectory()) throw new Error(`${abs} is a file, not a directory (read it with read_file).`)
  } catch (error) {
    if (error instanceof Error && error.message.includes("not a directory")) throw error
    throw new Error(`No directory ${abs}.`)
  }
}

/** Newest first; equal times by path. */
async function byMtime(files: WalkEntry[]) {
  const timed = await Promise.all(files.map(async (f) => ({ f, t: await stat(f.abs).then((s) => s.mtimeMs, () => 0) })))
  return timed.sort((a, b) => b.t - a.t || a.f.rel.localeCompare(b.f.rel)).map((x) => x.f)
}

/** A pattern without `/` matches the file name at any depth (`*.csv`), like rg --glob. */
function matcher(pattern: string) {
  const glob = new Bun.Glob(pattern)
  const anywhere = !pattern.includes("/")
  return (rel: string) => glob.match(rel) || (anywhere && glob.match(rel.slice(rel.lastIndexOf("/") + 1)))
}

export type GlobInput = { pattern: string; path?: string }

export function globFilesTool(workspace: Workspace): ToolDef<GlobInput> {
  return {
    name: "glob_files",
    description:
      'Finds files by name pattern (glob, e.g. "*.pdf", "bao-cao/**/*.md"), most recently modified first, at most 100. ' +
      "Use to see which files exist before reading. Not for searching text inside files (use grep_files).",
    input: z.object({
      pattern: z.string().min(1),
      path: z.string().optional().describe("Default: the workspace"),
    }),
    readOnly: true,
    deferrable: true,
    // Not deferred by default (#317): hidden, turns listed files or checked config with shell instead.
    source: LOCAL_SOURCE,
    askFor: secretRoot(workspace),
    subject: (input) => rootOf(workspace, input.path),
    summarize: (input) => `glob_files ${input.pattern}${input.path ? ` trong ${input.path}` : ""}`,
    async execute(input, ctx) {
      const root = rootOf(workspace, input.path)
      await ensureDir(root)
      const match = matcher(input.pattern)
      const { files, capped } = await walkFiles(root, { signal: ctx.signal, accept: match, env: workspace.env() })
      const sorted = await byMtime(files)
      const shown = sorted.slice(0, GLOB_LIMIT)
      if (shown.length === 0) return `No file matches "${input.pattern}" in ${root}.${capped ? " (The directory is too large and the search stopped early: narrow path.)" : ""}`
      return [
        `${sorted.length} files match "${input.pattern}" in ${root}${sorted.length > shown.length ? ` (showing the ${shown.length} newest; narrow the pattern or path)` : ""}:`,
        ...shown.map((f) => f.abs),
        ...(capped ? ["(The directory is too large and the search stopped early: results may be incomplete; narrow path.)"] : []),
      ].join("\n")
    },
  }
}

export type GrepInput = {
  pattern: string
  path?: string
  glob?: string
  ignore_case?: boolean
  output_mode?: "files_with_matches" | "content" | "count"
  context?: number
  head_limit?: number
}

export function grepFilesTool(workspace: Workspace): ToolDef<GrepInput> {
  return {
    name: "grep_files",
    description:
      "Searches text (JavaScript regex) in the text files of a directory or one file. output_mode: files_with_matches (default), content (matching lines, plus context), count. " +
      "Use to find a ticker, number or keyword across many files or in a long file. Not for finding files by name (use glob_files); does not read PDFs or images.",
    input: z.object({
      pattern: z.string().min(1),
      path: z.string().optional().describe("Default: the workspace"),
      glob: z.string().optional().describe('File filter, e.g. "*.md"'),
      ignore_case: z.boolean().optional(),
      output_mode: z.enum(["files_with_matches", "content", "count"]).optional(),
      context: z.number().int().min(0).max(10).optional(),
      head_limit: z.number().int().min(1).max(2000).optional().describe("Default 250"),
    }),
    readOnly: true,
    deferrable: true,
    deferByDefault: true,
    source: LOCAL_SOURCE,
    askFor: secretRoot(workspace),
    subject: (input) => rootOf(workspace, input.path),
    summarize: (input) => `grep_files "${input.pattern}"${input.path ? ` trong ${input.path}` : ""}`,
    async execute(input, ctx) {
      let re: RegExp
      try {
        re = new RegExp(input.pattern, input.ignore_case ? "iu" : "u")
      } catch (error) {
        throw new Error(`Invalid pattern "${input.pattern}": ${error instanceof Error ? error.message : String(error)}`)
      }
      const target = rootOf(workspace, input.path)
      let info
      try {
        info = await stat(target)
      } catch {
        throw new Error(`No file or directory ${target}.`)
      }
      let files: WalkEntry[]
      let capped = false
      if (info.isFile()) files = [{ abs: target, rel: path.basename(target) }]
      else {
        const accept = input.glob ? matcher(input.glob) : undefined
        const walked = await walkFiles(target, { signal: ctx.signal, accept, env: workspace.env() })
        files = walked.files
        capped = walked.capped
      }
      const mode = input.output_mode ?? "files_with_matches"
      const limit = input.head_limit ?? GREP_HEAD_LIMIT
      const around = mode === "content" ? (input.context ?? 0) : 0
      const hits: { file: WalkEntry; count: number; rows: string[] }[] = []
      // Files not searched are always said: "not found" must never mean "not looked at".
      const tooBig: string[] = []
      const unreadable: string[] = []
      for (const file of files) {
        if (ctx.signal.aborted) throw new Error("Cancelled.")
        let bytes: Uint8Array
        try {
          const size = (await stat(file.abs)).size
          if (size > GREP_MAX_FILE_BYTES) {
            tooBig.push(file.abs)
            continue
          }
          bytes = new Uint8Array(await Bun.file(file.abs).arrayBuffer())
        } catch {
          unreadable.push(file.abs)
          continue
        }
        if (isBinary(file.abs, bytes)) continue
        const lines = splitLines(decodeFile(bytes).text)
        const matched: number[] = []
        lines.forEach((line, i) => {
          if (re.test(line)) matched.push(i)
        })
        if (matched.length === 0) continue
        const rows: string[] = []
        if (mode === "content") {
          let shownUpTo = -1
          for (const i of matched) {
            const from = Math.max(shownUpTo + 1, i - around)
            if (rows.length > 0 && from > shownUpTo + 1) rows.push("--")
            for (let j = from; j <= Math.min(lines.length - 1, i + around); j++) {
              const text = lines[j]!.length > GREP_MAX_LINE ? `${lines[j]!.slice(0, GREP_MAX_LINE)}…` : lines[j]!
              rows.push(`${file.abs}:${j + 1}${j === i ? ":" : "-"}${text}`)
              shownUpTo = j
            }
          }
        }
        hits.push({ file, count: matched.length, rows })
      }
      const skipped = skippedNote(tooBig, unreadable)
      if (hits.length === 0) {
        if (info.isFile() && skipped) throw new Error(`Could not search ${target}: ${skipped}`)
        return [`"${input.pattern}" not found in ${target}.${capped ? " (The directory is too large and the search stopped early: narrow path.)" : ""}`, ...(skipped ? [`(${skipped})`] : [])].join("\n")
      }
      const ordered = mode === "content" ? hits : await byMtimeHits(hits)
      const out =
        mode === "files_with_matches"
          ? ordered.map((h) => h.file.abs)
          : mode === "count"
            ? ordered.map((h) => `${h.file.abs}:${h.count}`)
            : ordered.flatMap((h) => h.rows)
      const shown = out.slice(0, limit)
      const total = hits.reduce((n, h) => n + h.count, 0)
      return [
        `${total} matching lines in ${hits.length} files${out.length > shown.length ? ` (showing ${shown.length}/${out.length} result lines; raise head_limit or narrow path/glob)` : ""}:`,
        ...shown,
        ...(capped ? ["(The directory is too large and the search stopped early: results may be incomplete; narrow path.)"] : []),
        ...(skipped ? [`(${skipped})`] : []),
      ].join("\n")
    },
  }
}

/** "Bỏ qua 2 file lớn hơn 20 MiB: a.csv, b.csv; kết quả có thể thiếu." (undefined when none). */
function skippedNote(tooBig: string[], unreadable: string[]): string | undefined {
  const list = (files: string[]) => `${files.slice(0, 5).join(", ")}${files.length > 5 ? `, … (+${files.length - 5})` : ""}`
  const parts = [
    tooBig.length ? `skipped ${tooBig.length} files over ${GREP_MAX_FILE_BYTES / 1024 / 1024} MiB: ${list(tooBig)}` : "",
    unreadable.length ? `could not read ${unreadable.length} files: ${list(unreadable)}` : "",
  ].filter(Boolean)
  return parts.length ? `${parts.join("; ")}; results may be incomplete (read the part you need with read_file and offset/limit).` : undefined
}

async function byMtimeHits<T extends { file: WalkEntry }>(hits: T[]) {
  const order = await byMtime(hits.map((h) => h.file))
  const rank = new Map(order.map((f, i) => [f.abs, i]))
  return [...hits].sort((a, b) => rank.get(a.file.abs)! - rank.get(b.file.abs)!)
}
