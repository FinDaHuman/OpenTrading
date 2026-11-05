import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import type { ModelMessage } from "ai"
import { classifyOutcome, FAILURE_STREAK_NUDGE, FAILURE_STREAK_STOP, turnFailures, type ToolOutcome } from "../../src/core/loop/failures"
import { sessionsDir } from "../../src/core/session/store"
import { cleanToolErrors } from "../../src/core/tools/errors"
import { stableJson } from "../../src/core/tools/loop-guard"
import { readSourceState, SOURCE_FAILED_PREFIX } from "../../src/core/tools/outcome"

/**
 * Run the tool failure rules over every saved turn, offline: no model, no key, no quota. Shows how
 * often each kind of failure happens, whether repeating the same call worked, and how many turns
 * would get a reminder, lose their tools or report a data gap. Prints counts only, so the output
 * holds nothing from the conversations.
 *
 * Sessions saved before the notice existed hold the bare envelope; those results are read as if
 * they carried it. What a real model would have done differently cannot be replayed.
 *
 * Cách chạy: bun scripts/dev/tool-failure-replay.ts [--dir <thư mục sessions>]
 */

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const dir = flag("--dir") ?? sessionsDir()

function files(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const full = path.join(root, name)
    return statSync(full).isDirectory() ? files(full) : name.endsWith(".jsonl") && name !== "index.jsonl" ? [full] : []
  })
}

type Output = { type?: string; value?: unknown }

function textOf(output: Output | undefined) {
  const value = output?.value
  if (typeof value === "string") return value
  if (Array.isArray(value)) return (value as { type?: string; text?: string }[]).find((p) => p?.type === "text")?.text ?? ""
  return ""
}

/** A result saved before the notice existed, as it would read now. */
function withNotice(message: ModelMessage): ModelMessage {
  if (message.role !== "tool") return message
  const content = message.content.map((part) => {
    if (part.type !== "tool-result") return part
    const text = textOf(part.output as Output).replace(/^\[ref [^\]]+\]\s*/, "")
    if (readSourceState(text)?.availability !== "unavailable") return part
    return { ...part, output: { type: "text" as const, value: `${SOURCE_FAILED_PREFIX} ${text}` } }
  })
  return { ...message, content }
}

function sessionMessages(file: string): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue
    try {
      const entry = JSON.parse(line) as { type?: string; message?: ModelMessage }
      if (entry.type === "message" && entry.message) out.push(withNotice(entry.message))
    } catch {}
  }
  // Old sessions carry the SDK's "AI_…Error: Error: …" prefixes.
  return cleanToolErrors(out)
}

function turnsOf(messages: ModelMessage[]) {
  const turns: ModelMessage[][] = []
  for (const message of messages) {
    if (message.role === "user") turns.push([message])
    else turns.at(-1)?.push(message)
  }
  return turns
}

const kinds = new Map<ToolOutcome, { count: number; repeated: number; repeatWorked: number }>()
const sessionsWith = new Map<ToolOutcome, Set<string>>()
let sessions = 0
let turnCount = 0
let results = 0
let nudged = 0
let stopped = 0
let withGaps = 0

for (const file of files(dir)) {
  const turns = turnsOf(sessionMessages(file))
  if (turns.length > 0) sessions++
  for (const turn of turns) {
    turnCount++
    const seen: { key: string; outcome: ToolOutcome }[] = []
    const inputs = new Map<string, unknown>()
    for (const message of turn) {
      if (message.role === "assistant" && Array.isArray(message.content)) {
        for (const part of message.content) if (part.type === "tool-call") inputs.set(part.toolCallId, part.input)
      }
      if (message.role !== "tool") continue
      for (const part of message.content) {
        if (part.type !== "tool-result") continue
        const output = part.output as Output
        seen.push({
          key: `${part.toolName}\u0000${stableJson(inputs.get(part.toolCallId))}`,
          outcome: classifyOutcome(!String(output?.type ?? "").startsWith("error"), textOf(output)),
        })
      }
    }
    results += seen.length
    seen.forEach(({ key, outcome }, i) => {
      if (outcome === "ok") return
      const row = kinds.get(outcome) ?? { count: 0, repeated: 0, repeatWorked: 0 }
      kinds.set(outcome, row)
      row.count++
      if (!sessionsWith.has(outcome)) sessionsWith.set(outcome, new Set())
      sessionsWith.get(outcome)!.add(file)
      const repeat = seen.slice(i + 1).find((later) => later.key === key)
      if (!repeat) return
      row.repeated++
      if (repeat.outcome === "ok") row.repeatWorked++
    })
    // Every prefix of the turn, as prepareStep sees it.
    let worst = 0
    turn.forEach((message, i) => {
      if (message.role === "tool") worst = Math.max(worst, turnFailures(turn.slice(0, i + 1)).streak)
    })
    if (worst >= FAILURE_STREAK_NUDGE) nudged++
    if (worst >= FAILURE_STREAK_STOP) stopped++
    if (turnFailures(turn).gaps.length > 0) withGaps++
  }
}

console.log(`${sessions} session, ${turnCount} lượt, ${results} kết quả tool (${dir})`)
console.log("")
console.log("Loại lỗi            số ca  session  gọi lại y hệt  thành công")
for (const [kind, row] of [...kinds].sort((a, b) => b[1].count - a[1].count)) {
  const cells = [kind.padEnd(18), String(row.count).padStart(6), String(sessionsWith.get(kind)!.size).padStart(8), String(row.repeated).padStart(14), String(row.repeatWorked).padStart(11)]
  console.log(cells.join(" "))
}
console.log("")
console.log(`Lượt còn thiếu dữ liệu khi kết thúc: ${withGaps}`)
console.log(`Lượt chạm ngưỡng nhắc (${FAILURE_STREAK_NUDGE} bước toàn lỗi): ${nudged}`)
console.log(`Lượt chạm ngưỡng tắt tool (${FAILURE_STREAK_STOP} bước toàn lỗi): ${stopped}`)
