import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import type { ModelMessage } from "ai"
import { isEmptyAnswer, isPromise, PROMISE_MAX_CHARS, stripEchoes } from "../../src/core/loop/stop-gate"
import { sessionsDir } from "../../src/core/session/store"

/**
 * Run the stop gate's text checks over every saved turn's final answer, offline: no model, no
 * key, no quota. Shows which past answers the gate would have sent back (only echoed todo lines,
 * or nothing) and which real answers lose lines to stripEchoes, so a pattern that misfires on
 * real answers is caught before it ships.
 *
 * Cách chạy: bun scripts/dev/stop-gate-replay.ts [--dir <thư mục sessions>] [--show 20]
 */

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const dir = flag("--dir") ?? sessionsDir()
const show = Number(flag("--show") ?? 20)

function files(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const full = path.join(root, name)
    return statSync(full).isDirectory() ? files(full) : name.endsWith(".jsonl") && name !== "index.jsonl" ? [full] : []
  })
}

const textOf = (message: ModelMessage) =>
  typeof message.content === "string"
    ? message.content
    : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")

let turns = 0
const empty: string[] = []
const stripped: string[] = []
const promises: string[] = []
/** Final answers the promise check could misfire on: short, no tool call. */
let short = 0
/** Real preambles (text beside a tool call): how many the promise check recognises. */
let preambles = 0
const missed: string[] = []
for (const file of files(dir)) {
  let last: ModelMessage | undefined
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue
    let entry: { type?: string; message?: ModelMessage }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type === "message" && entry.message?.role === "assistant") {
      last = entry.message
      const said = textOf(last).trim()
      if (said && typeof last.content !== "string" && last.content.some((p) => p.type === "tool-call")) {
        preambles++
        if (!isPromise(said)) missed.push(`${path.relative(dir, file)}: ${said.replace(/\s+/g, " ").slice(0, 100)}`)
      }
    }
    if (entry.type !== "turn_end" || !last) continue
    turns++
    const text = textOf(last)
    const where = `${path.relative(dir, file)}: ${text.replace(/\s+/g, " ").trim().slice(0, 100)}`
    // Only a final step without tool calls is judged as a promise (the gate's rule).
    const calls = typeof last.content !== "string" && last.content.some((p) => p.type === "tool-call")
    if (isEmptyAnswer(text)) empty.push(where)
    else {
      if (stripEchoes(text) !== text) stripped.push(where)
      if (!calls && text.trim().length <= PROMISE_MAX_CHARS) short++
      if (!calls && isPromise(text)) promises.push(where)
    }
    last = undefined
  }
}

console.log(`${turns} lượt đã lưu trong ${dir}`)
console.log(`\nCổng dừng sẽ gửi lại model (rỗng hoặc chỉ có dòng todo): ${empty.length}`)
for (const line of empty.slice(0, show)) console.log(`  ${line}`)
console.log(`\nCâu trả lời thật bị cắt dòng chép todo: ${stripped.length}`)
for (const line of stripped.slice(0, show)) console.log(`  ${line}`)
console.log(`\nBị coi là "hứa mà không làm" (sẽ gửi lại model): ${promises.length}`)
for (const line of promises.slice(0, show)) console.log(`  ${line}`)
console.log(`  (trên ${short} câu trả lời cuối ngắn ≤${PROMISE_MAX_CHARS} ký tự, không gọi tool — nhóm dễ báo nhầm nhất)`)
console.log(`
Câu dạo đầu thật (kèm gọi tool) nhận ra là lời hứa: ${preambles - missed.length}/${preambles}`)
for (const line of missed.slice(0, show)) console.log(`  sót: ${line}`)
