import { createHash } from "node:crypto"
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { DeskRunView } from "./types"

/**
 * A desk run on disk: `sessions/…/<session>/desk/<runId>/journal.jsonl` (one line per agent
 * that answered) and `meta.json` (what /desk resume needs: playbook, version, args, size).
 *
 * Resume replays agent() calls from the journal by key. Claude Code matches the unchanged
 * prefix in start order; with concurrent pipelines the start order depends on which agent
 * finished first, so here the key is the call itself (version, prompt, identity) plus how
 * many identical calls came before it. A changed upstream result changes the downstream
 * prompts that quote it, so their keys change too.
 */
export interface JournalEntry {
  type: "result"
  key: string
  label: string
  phase: string
  /** What agent() resolved to: structured data, or the report text. */
  value: unknown
  requests: number
  tokens: { input: number; output: number }
  agentId?: string
  ts: string
}

export interface DeskMeta {
  format: 1
  id: string
  playbook: string
  version: string
  args: unknown
  size: DeskRunView["size"]
  effort?: DeskRunView["effort"]
  status: DeskRunView["status"]
  cut?: DeskRunView["cut"]
  createdAt: string
  updatedAt: string
  counters: DeskRunView["counters"]
  sessionId?: string
}

export const deskDir = (sessionDir: string) => path.join(sessionDir, "desk")

/** Hash of one agent() call: playbook version, prompt, and what changes the answer. */
export function callHash(version: string, prompt: string, identity: unknown): string {
  return createHash("sha256").update(JSON.stringify([version, prompt, identity])).digest("hex").slice(0, 16)
}

/** Journal key: the call's hash and how many identical calls came before it in the run. */
export const agentKey = (hash: string, occurrence: number) => `${hash}#${occurrence}`

export class DeskJournal {
  private writing: Promise<void> = Promise.resolve()
  readonly dir: string
  readonly file: string
  readonly metaFile: string

  constructor(sessionDir: string, runId: string) {
    this.dir = path.join(deskDir(sessionDir), runId)
    this.file = path.join(this.dir, "journal.jsonl")
    this.metaFile = path.join(this.dir, "meta.json")
  }

  /** Results recorded so far, by key; a missing or damaged file is an empty journal. */
  async load(): Promise<Map<string, JournalEntry>> {
    const text = await readFile(this.file, "utf8").catch(() => "")
    const out = new Map<string, JournalEntry>()
    for (const line of text.split("\n")) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as JournalEntry
        if (entry.type === "result" && typeof entry.key === "string") out.set(entry.key, entry)
      } catch {
        // A line cut by a crash: the agent simply runs again.
      }
    }
    return out
  }

  async readMeta(): Promise<DeskMeta | undefined> {
    try {
      const meta = JSON.parse(await readFile(this.metaFile, "utf8")) as DeskMeta
      return meta.format === 1 ? meta : undefined
    } catch {
      return undefined
    }
  }

  /** Writes in order; a disk error goes to `onError`, never thrown (the run goes on). */
  append(entry: JournalEntry, onError?: (error: unknown) => void) {
    return this.queue(async () => {
      await mkdir(this.dir, { recursive: true })
      await appendFile(this.file, JSON.stringify(entry) + "\n", "utf8")
    }, onError)
  }

  writeMeta(meta: DeskMeta, onError?: (error: unknown) => void) {
    return this.queue(async () => {
      await mkdir(this.dir, { recursive: true })
      await writeFile(this.metaFile, JSON.stringify(meta, null, 2) + "\n", "utf8")
    }, onError)
  }

  flush() {
    return this.writing
  }

  private queue(work: () => Promise<void>, onError?: (error: unknown) => void) {
    this.writing = this.writing.then(work).catch((error) => onError?.(error))
    return this.writing
  }
}

/** Runs recorded in a session folder, newest first. */
export async function listDeskRuns(sessionDir: string): Promise<DeskMeta[]> {
  const ids = await readdir(deskDir(sessionDir)).catch(() => [] as string[])
  const metas = await Promise.all(ids.map((id) => new DeskJournal(sessionDir, id).readMeta()))
  return metas.filter((m): m is DeskMeta => !!m).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
