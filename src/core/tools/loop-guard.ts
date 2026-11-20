import type { ToolDef } from "./types"

/**
 * A turn has no step cap by default (#77), so a model stuck on the same call would spin
 * until the user notices. opencode's guard (`session/processor.ts`, DOOM_LOOP_THRESHOLD):
 * the same tool with the same input this many times in a row asks the user to go on.
 */
export const LOOP_THRESHOLD = 3

/** Consecutive identical calls of one tool set (one turn, or one subagent run). */
export class LoopGuard {
  private last: string | undefined
  private count = 0

  /** Count this call; the run length when it is a repeat at or past the threshold. */
  note(name: string, input: unknown): number | undefined {
    const key = `${name}\u0000${stableJson(input)}`
    if (key === this.last) this.count++
    else {
      this.last = key
      this.count = 1
    }
    return this.count >= LOOP_THRESHOLD ? this.count : undefined
  }
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "undefined"
}

/** The tool as the approval prompt shows it when its calls repeat. */
export function loopDef(def: ToolDef, count: number): ToolDef {
  return {
    ...def,
    description: `Model đã gọi ${def.displayName ?? def.name} với cùng tham số ${count} lần liên tiếp, có thể đang lặp. Cho chạy tiếp?`,
    // Asks whatever the tool's own rule; "session" stops asking for this tool's repeats.
    askFor: () => "lap-lai",
  }
}

/** What the model reads when the user stops the loop. */
export function loopDenied(def: ToolDef, count: number, message?: string): string {
  const base = `The user stopped a loop: you called ${def.name} with the same arguments ${count} times in a row. Do not make this call again; try another way or answer with the data you have.`
  return message ? `${base} The user's message: ${message}` : base
}
