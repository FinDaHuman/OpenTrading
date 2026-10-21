import type { ModelMessage } from "ai"
import { appendFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { stripImages } from "../tools/registry"
import type { AgentStatus } from "./types"

/**
 * A subagent's own transcript, next to its parent session (Claude Code's sidechains):
 *   sessions/YYYY/MM/<sessionId>/subagents/agent-<id>.jsonl
 *   sessions/YYYY/MM/<sessionId>/subagents/agent-<id>.meta.json
 * The parent file only holds the spawn_subagent call and its result. Session listing reads
 * index.jsonl, so these files never show up as sessions.
 */
export type SidechainEntry =
  | {
      type: "agent_meta"
      format: 1
      agentId: string
      agentType: string
      description: string
      prompt: string
      parentSessionId: string
      parentCallId?: string
      deskRunId?: string
      background: boolean
      provider: string
      model: string
      createdAt: string
    }
  | { type: "message"; ts: string; message: ModelMessage }
  | { type: "notice"; ts: string; text: string }
  | {
      type: "agent_end"
      ts: string
      status: AgentStatus
      error?: string
      toolCount: number
      usage: { input: number; output: number }
      durationMs: number
    }

export interface SidechainMeta {
  agentId: string
  agentType: string
  description: string
  status: AgentStatus
  createdAt: string
  updatedAt: string
  toolCount: number
  usage: { input: number; output: number }
  parentCallId?: string
  /** The ultradesk run that started the agent. */
  deskRunId?: string
}

export const sidechainDir = (sessionDir: string) => path.join(sessionDir, "subagents")

export class Sidechain {
  private writing: Promise<void> = Promise.resolve()
  readonly file: string
  readonly metaFile: string

  constructor(sessionDir: string, agentId: string) {
    this.file = path.join(sidechainDir(sessionDir), `agent-${agentId}.jsonl`)
    this.metaFile = path.join(sidechainDir(sessionDir), `agent-${agentId}.meta.json`)
  }

  /** Append entries in order; a disk error is reported once through `onError`, never thrown. */
  append(entries: SidechainEntry[], onError?: (error: unknown) => void) {
    this.writing = this.writing
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true })
        const lines = entries.map((e) => (e.type === "message" ? { ...e, message: stripImages([e.message])[0] } : e))
        await appendFile(this.file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8")
      })
      .catch((error) => onError?.(error))
    return this.writing
  }

  writeMeta(meta: SidechainMeta, onError?: (error: unknown) => void) {
    this.writing = this.writing
      .then(async () => {
        await mkdir(path.dirname(this.metaFile), { recursive: true })
        await writeFile(this.metaFile, JSON.stringify(meta, null, 2) + "\n", "utf8")
      })
      .catch((error) => onError?.(error))
    return this.writing
  }

  flush() {
    return this.writing
  }
}
