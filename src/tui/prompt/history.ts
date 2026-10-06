import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { dataDir } from "../../core/paths"

/**
 * Prompt history for ↑/↓ and Ctrl+R, like Claude Code's `~/.claude/history.jsonl`:
 * one global append-only file, every submitted line (slash commands included), newest
 * last. Only the most recent entries are kept in memory and recalled.
 */
export type HistoryEntry = { text: string; ts: number }

/** How many entries ↑ and Ctrl+R can reach (Claude Code reads back 100). */
export const MAX_RECALL = 100
/** The file is rewritten down to MAX_RECALL lines once it grows past this. */
const MAX_FILE_LINES = 500

export const historyFile = () => path.join(dataDir(), "prompt-history.jsonl")

let entries: HistoryEntry[] = []
let loaded: Promise<void> | undefined
let writing: Promise<void> = Promise.resolve()

function parse(raw: string): HistoryEntry[] {
  const out: HistoryEntry[] = []
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    try {
      const value = JSON.parse(line) as Partial<HistoryEntry>
      if (typeof value.text === "string" && value.text.trim()) out.push({ text: value.text, ts: Number(value.ts) || 0 })
    } catch {
      // A torn last line (crash mid-write) is skipped, the rest still loads.
    }
  }
  return out
}

/** Read the file once per process (and again after `resetHistory`). */
export function loadHistory(): Promise<void> {
  loaded ??= (async () => {
    let raw = ""
    try {
      raw = await readFile(historyFile(), "utf8")
    } catch {
      return
    }
    const all = parse(raw)
    const recent = all.slice(-MAX_RECALL)
    // Anything typed before the load finished stays newest.
    entries = [...recent, ...entries]
    if (all.length > MAX_FILE_LINES) {
      writing = writing.then(() => write(recent.map((e) => JSON.stringify(e) + "\n").join(""), false)).catch(() => {})
    }
  })()
  return loaded
}

async function write(data: string, append: boolean) {
  const file = historyFile()
  await mkdir(path.dirname(file), { recursive: true })
  // Prompts can hold private notes: owner-only, like mcp-auth.json.
  if (append) await appendFile(file, data, { encoding: "utf8", mode: 0o600 })
  else await writeFile(file, data, { encoding: "utf8", mode: 0o600 })
  if (process.platform !== "win32") await chmod(file, 0o600).catch(() => {})
}

/** Remember a submitted (or cleared) prompt. Blank text and a repeat of the newest entry are skipped. */
export function addHistory(text: string) {
  if (!text.trim()) return
  if (entries.at(-1)?.text === text) return
  const entry = { text, ts: Date.now() }
  entries.push(entry)
  if (entries.length > MAX_RECALL) entries = entries.slice(-MAX_RECALL)
  writing = writing.then(() => write(JSON.stringify(entry) + "\n", true)).catch(() => {})
}

/** Newest first. */
export function historyEntries(): string[] {
  return entries.map((e) => e.text).reverse()
}

/** Wait for pending writes (tests, exit). */
export const historyFlushed = () => writing

/** Forget the in-memory copy so the next `loadHistory` reads the file again (tests). */
export function resetHistory() {
  entries = []
  loaded = undefined
}

/**
 * Ctrl+R: entries containing `query` (case-insensitive), newest first, without
 * duplicates. An empty query matches everything.
 */
export function searchHistory(query: string): string[] {
  const q = query.toLowerCase()
  const seen = new Set<string>()
  const out: string[] = []
  for (const text of historyEntries()) {
    if (seen.has(text) || !text.toLowerCase().includes(q)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

/**
 * ↑/↓ walk through the history. Index -1 is the draft being typed, saved on the first ↑
 * and given back when ↓ goes past the newest entry.
 */
export class HistoryCursor {
  private index = -1
  private draft = ""

  /** The entry shown, or undefined when back at the draft. */
  get current(): string | undefined {
    return this.index < 0 ? undefined : historyEntries()[this.index]
  }

  /** Forget the position (after a submit, or once the recalled text was edited). */
  reset() {
    this.index = -1
    this.draft = ""
  }

  /** Older entry, or undefined when there is none. `value` is what the input holds now. */
  up(value: string): string | undefined {
    const list = historyEntries()
    // Typing over a recalled entry makes it the new draft.
    if (this.index >= 0 && value !== list[this.index]) this.reset()
    if (this.index + 1 >= list.length) return undefined
    if (this.index < 0) this.draft = value
    this.index++
    return list[this.index]
  }

  /** Newer entry, the saved draft past the newest, or undefined when already at the draft. */
  down(value: string): string | undefined {
    const list = historyEntries()
    if (this.index >= 0 && value !== list[this.index]) this.reset()
    if (this.index < 0) return undefined
    this.index--
    return this.index < 0 ? this.draft : list[this.index]
  }
}
