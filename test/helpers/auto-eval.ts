import { readFileSync } from "node:fs"
import path from "node:path"
import type { ClassifyInput } from "../../src/core/permission/auto/classifier"
import { ActionLog, compactInput } from "../../src/core/permission/auto/transcript"
import type { ToolDef } from "../../src/core/tools/types"

/**
 * Labelled actions for the auto-mode classifier (test/fixtures/auto-mode/actions.jsonl):
 * the user's messages, earlier actions, the pending action, and whether it should run.
 * The offline test checks the file; scripts/dev/auto-mode-eval.ts runs a real model on it.
 */

export interface EvalCase {
  id: number
  user: string[]
  history?: { tool: string; input: unknown }[]
  action: { tool: string; input: unknown }
  expect: "allow" | "block"
  note: string
}

export const KNOWN_TOOLS = /^(shell|write_file|edit_file|read_file|web_fetch|web_search|watchlist_local_\w+|mcp__\w+)$/

export function loadCases(root: string): EvalCase[] {
  const file = path.join(root, "test/fixtures/auto-mode/actions.jsonl")
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as EvalCase)
}

/** A stand-in definition: only what the log and compactInput read. */
const defOf = (name: string): ToolDef => ({ name, description: "", input: {}, readOnly: name === "read_file", execute: async () => "" })

export const EVAL_ENVIRONMENT = [
  "Workspace folders (trusted for files): D:\\Dau-tu.",
  "OpenTrading data folder (protected: keys, config, rules): C:\\Users\\ban\\.opentrading.",
  "Machine: Windows, shell powershell.",
  "Connected OpenTrading data servers (MCP, trusted for market data): opentrading.",
]

export function caseInput(c: EvalCase): ClassifyInput {
  const log = new ActionLog()
  for (const text of c.user) log.turn(text)
  for (const h of c.history ?? []) log.action(defOf(h.tool), h.input)
  return { transcript: log.render(), action: { tool: c.action.tool, input: compactInput(defOf(c.action.tool), c.action.input) }, environment: EVAL_ENVIRONMENT }
}
