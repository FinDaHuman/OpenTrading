import { splitLines } from "./text"

/**
 * A short line diff for the approval prompt: what the write or edit will change, with two
 * lines of context around each change. Common head and tail are trimmed first; the middle
 * uses an LCS table when it is small, else shows old lines removed and new lines added.
 */

export interface DiffLine {
  kind: "+" | "-" | " " | "…"
  text: string
  /** Line number in the new file (" " and "+") or the old one ("-"). */
  n?: number
}

export interface Diff {
  lines: DiffLine[]
  added: number
  removed: number
}

const CONTEXT = 2
const MAX_CELLS = 1_000_000

function middleOps(a: string[], b: string[]): ("=" | "-" | "+")[] {
  if (a.length * b.length > MAX_CELLS) return [...a.map(() => "-" as const), ...b.map(() => "+" as const)]
  const w = b.length + 1
  const table = new Uint32Array((a.length + 1) * w)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * w + j] = a[i] === b[j] ? table[(i + 1) * w + j + 1]! + 1 : Math.max(table[(i + 1) * w + j]!, table[i * w + j + 1]!)
    }
  }
  const ops: ("=" | "-" | "+")[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push("=")
      i++
      j++
    } else if (table[(i + 1) * w + j]! >= table[i * w + j + 1]!) {
      ops.push("-")
      i++
    } else {
      ops.push("+")
      j++
    }
  }
  while (i++ < a.length) ops.push("-")
  while (j++ < b.length) ops.push("+")
  return ops
}

export function lineDiff(before: string, after: string): Diff {
  const a = splitLines(before)
  const b = splitLines(after)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const ops = [...Array<"=">(head).fill("="), ...middleOps(a.slice(head, a.length - tail), b.slice(head, b.length - tail)), ...Array<"=">(tail).fill("=")]

  const full: DiffLine[] = []
  let i = 0
  let j = 0
  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op === "=") {
      full.push({ kind: " ", text: b[j]!, n: j + 1 })
      i++
      j++
    } else if (op === "-") {
      full.push({ kind: "-", text: a[i]!, n: i + 1 })
      i++
      removed++
    } else {
      full.push({ kind: "+", text: b[j]!, n: j + 1 })
      j++
      added++
    }
  }
  // Keep changes and CONTEXT lines around them; collapse the rest into "…".
  const keep = full.map(() => false)
  full.forEach((line, k) => {
    if (line.kind === " ") return
    for (let d = -CONTEXT; d <= CONTEXT; d++) if (k + d >= 0 && k + d < full.length) keep[k + d] = true
  })
  const lines: DiffLine[] = []
  full.forEach((line, k) => {
    if (keep[k]) lines.push(line)
    else if (lines.at(-1)?.kind !== "…") lines.push({ kind: "…", text: "" })
  })
  if (lines.length === 1 && lines[0]!.kind === "…") lines.length = 0
  return { lines, added, removed }
}

/** Diff of a brand-new file: every line added. */
export function newFileDiff(content: string): Diff {
  const lines = splitLines(content).map((text, k) => ({ kind: "+" as const, text, n: k + 1 }))
  return { lines, added: lines.length, removed: 0 }
}
