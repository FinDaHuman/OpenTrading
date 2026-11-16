import { z } from "zod"
import { listSessions, loadSession } from "../../session/store"
import { visibleUserText } from "../../agent"
import type { ModelMessage } from "ai"
import type { RedactionCheck } from "../../memory/redaction/check"
import { LOCAL_SOURCE, type ToolDef } from "../types"

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat
}

function assistantText(m: ModelMessage) {
  if (typeof m.content === "string") return m.content
  return m.content
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim()
}

/** Each user question with the last assistant text before the next question (its conclusion). */
export function turnsOf(messages: ModelMessage[]) {
  const turns: { question: string; answer: string }[] = []
  for (const m of messages) {
    if (m.role === "user") {
      const q = visibleUserText(m)
      if (q) turns.push({ question: q, answer: "" })
    } else if (m.role === "assistant" && turns.length > 0) {
      const text = assistantText(m)
      if (text) turns[turns.length - 1]!.answer = text
    }
  }
  return turns
}

/**
 * This user's saved sessions (~/.opentrading/sessions), the local counterpart of the MCP
 * server's shared run log: past conversations never mix between users.
 */
export function sessionHistoryTools(deps: { redaction?: RedactionCheck } = {}): ToolDef[] {
  const list: ToolDef<{ limit?: number }> = {
    name: "session_list",
    description:
      "Lists the conversations saved on this machine (newest first). Use when the user asks about an earlier session. Not for market data (that is the MCP tools).",
    input: z.object({ limit: z.number().int().min(1).max(30).optional().describe("Number of sessions (default 10)") }),
    readOnly: true,
    deferrable: true,
    deferByDefault: true,
    source: LOCAL_SOURCE,
    summarize: () => "session_list()",
    async execute(input) {
      const all = await listSessions()
      const rows = all.slice(0, input.limit ?? 10).map((s) => ({
        id: s.id,
        title: s.title,
        turns: s.turns,
        updatedAt: s.updatedAt,
        model: s.model,
      }))
      if (rows.length === 0) return "No saved sessions yet."
      return rows.map((r) => `- ${r.id} · ${r.turns} turns · ${r.title} (${r.updatedAt})`).join("\n")
    },
  }
  const get: ToolDef<{ id: string }> = {
    name: "session_get",
    description:
      "Reads an earlier session by id: each user question and the conclusion given (shortened). Use when you need the context or conclusions of an earlier session.",
    input: z.object({ id: z.string().min(4).describe("Session id from session_list (a prefix of at least 4 characters is fine)") }),
    readOnly: true,
    deferrable: true,
    deferByDefault: true,
    source: LOCAL_SOURCE,
    summarize: (input) => `session_get(${input.id})`,
    async execute(input) {
      const matches = (await listSessions()).filter((s) => s.id === input.id || s.id.startsWith(input.id))
      if (matches.length > 1 && !matches.some((s) => s.id === input.id)) {
        throw new Error(`Prefix "${input.id}" matches ${matches.length} sessions: ${matches.slice(0, 5).map((s) => s.id).join(", ")}. Use a longer id.`)
      }
      // Read with the masks (never written here): what the user deleted does not come back through an old session.
      const loaded = await loadSession(input.id, { check: deps.redaction })
      // The whole conversation (display), not just what is left after the last compaction.
      const turns = turnsOf(loaded.display).slice(-12)
      return [
        `Session ${loaded.summary.id} · ${loaded.summary.turns} turns · ${loaded.summary.title} (${loaded.summary.updatedAt})`,
        ...turns.map((t, i) => `${i + 1}. Q: ${clip(t.question, 200)}${t.answer ? `\n   A: ${clip(t.answer, 400)}` : ""}`),
      ].join("\n")
    },
  }
  // Marked here, for every tool of the group, so a history tool added later is kept from
  // subagents without anyone having to list its name.
  return [list, get].map((def): ToolDef => ({ ...def, mainAgentOnly: true }))
}

/** Health check of this machine's harness, as opposed to the MCP server's own `doctor`. */
export function doctorLocalTool(deps: {
  mcpStatus: () => { name: string; state: string; tools: string[]; error?: string }[]
  /** The configured model id, never its key. */
  model: () => Promise<string | undefined>
  home: string
  /** Providers with a saved key (names only). */
  providers?: () => Promise<string[]>
  /** Auto skills hidden because a required tool is missing, with the missing names. */
  hiddenSkills?: () => { name: string; missing: string[] }[]
}): ToolDef<Record<string, never>> {
  return {
    name: "doctor_local",
    description:
      "Checks OpenTrading on this machine: the model, providers with a key (keys are never shown), the data folder, MCP servers and their tool counts, skills hidden for missing tools. Use when the user asks about the setup or connection errors. It does not check the server's data sources (that is the server's own doctor tool).",
    input: z.object({}),
    readOnly: true,
    deferrable: true,
    deferByDefault: true,
    source: LOCAL_SOURCE,
    summarize: () => "doctor_local()",
    async execute() {
      const servers = deps.mcpStatus()
      const providers = (await deps.providers?.()) ?? []
      const hidden = deps.hiddenSkills?.() ?? []
      return [
        `Model: ${(await deps.model()) ?? "none selected (type /model)"}`,
        `Providers with a key: ${providers.length > 0 ? providers.join(", ") : "none (type /connect)"}`,
        `Data folder: ${deps.home}${process.env.OPENTRADING_HOME ? " (from OPENTRADING_HOME)" : ""}`,
        servers.length > 0 ? "MCP:" : "MCP: no server configured",
        ...servers.map((s) => `- ${s.name}: ${s.state} (${s.tools.length} tool)${s.error ? ` — ${s.error.slice(0, 160)}` : ""}`),
        hidden.length > 0 ? `Skills hidden (${hidden.length}) for missing tools:` : "Skills: none hidden for missing tools.",
        ...hidden.map((h) => `- ${h.name}: missing ${h.missing.join(", ")}`),
      ].join("\n")
    },
  }
}
