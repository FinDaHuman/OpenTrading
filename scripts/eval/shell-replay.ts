import { mathNearMiss, mathOnlyCommand } from "../../src/core/tools/shell/math"
import type { ShellInfo } from "../../src/core/tools/shell/run"

/**
 * What the harness does with an arithmetic command a model wrote, with nobody to approve it
 * (`ot -p`, evals, read-only agents): "run" it unasked, refuse it as a "near" miss with the form
 * to use, or send it to the approval gate ("ask"), where it is denied. No model, no shell: this
 * replays recorded commands against the grammar, on any machine.
 */
export type Replayed = "run" | "near" | "ask"

export interface RecordedCommand {
  /** The shell the command was written for. */
  shell: ShellInfo["kind"]
  command: string
  /** A label to group by (awk-vars, python…). */
  form?: string
  source?: string
}

export function replayCommand({ command, shell }: RecordedCommand): Replayed {
  const kind = { kind: shell }
  if (mathOnlyCommand(command, kind)) return "run"
  return mathNearMiss(command, kind) ? "near" : "ask"
}

export const parseCommands = (text: string): RecordedCommand[] =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordedCommand)

export function replayAll(commands: RecordedCommand[]) {
  const total: Record<Replayed, number> = { run: 0, near: 0, ask: 0 }
  const forms: Record<string, Record<Replayed, number>> = {}
  for (const command of commands) {
    const result = replayCommand(command)
    total[result]++
    const form = (forms[command.form ?? "khác"] ??= { run: 0, near: 0, ask: 0 })
    form[result]++
  }
  return { commands: commands.length, total, forms }
}
