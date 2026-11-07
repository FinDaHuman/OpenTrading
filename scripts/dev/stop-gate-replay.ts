import { readFileSync } from "node:fs"
import path from "node:path"
import type { ModelMessage } from "ai"
import {
  claimsFetch,
  figureSources,
  FRAGMENT_MAX_CHARS,
  isEmptyAnswer,
  isFragment,
  isPromise,
  PROMISE_MAX_CHARS,
  ranDataTool,
  stripEchoes,
  ungroundedInTurn,
  UNFETCHED_MIN_FIGURES,
  unfetchedFigures,
} from "../../src/core/loop/stop-gate"
import { sessionsDir } from "../../src/core/session/store"
import { sessionFiles } from "./session-files"

/**
 * Run the stop gate's text checks over every saved turn's final answer, offline: no model, no
 * key, no quota. Shows which past answers the gate would have sent back (only echoed todo lines,
 * or nothing) and which real answers lose lines to stripEchoes, so a pattern that misfires on
 * real answers is caught before it ships.
 *
 * The unfetched-figures check is measured three ways. Real turns where no data tool ran are what
 * it would have sent back. The two stress rows reuse answers from turns where a tool did run:
 * without their tool results they stand in for an invented answer (how much it catches), and
 * with them they stand in for a follow-up that repeats fetched figures (how often it misfires,
 * an upper bound: a real follow-up also has the earlier answer in its history).
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
const fragments: string[] = []
const unfetched: string[] = []
/** Turns where no data tool ran, and those among them that claim fetched data. */
let noData = 0
let claiming = 0
/** Answers with a claim and figures from turns with a data tool: the stress rows. */
let cited = 0
let caught = 0
const misfired: string[] = []
/** Final answers of turns without any tool call: the group the fragment check judges. */
let toolless = 0
/** Answers of turns with a tool result, and those holding figures no result or earlier turn has. */
let judged = 0
const ungrounded: string[] = []
for (const file of sessionFiles(dir)) {
  let last: ModelMessage | undefined
  let toolsInTurn = false
  /** Earlier turns, then this turn's messages so far. */
  const history: ModelMessage[] = []
  let turn: ModelMessage[] = []
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue
    let entry: { type?: string; message?: ModelMessage }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type === "message" && entry.message) turn.push(entry.message)
    if (entry.type === "message" && entry.message?.role === "tool") toolsInTurn = true
    if (entry.type === "message" && entry.message?.role === "assistant") {
      last = entry.message
      const said = textOf(last).trim()
      if (said && typeof last.content !== "string" && last.content.some((p) => p.type === "tool-call")) {
        preambles++
        if (!isPromise(said)) missed.push(`${path.relative(dir, file)}: ${said.replace(/\s+/g, " ").slice(0, 100)}`)
      }
    }
    if (entry.type !== "turn_end") continue
    if (!last) {
      history.push(...turn)
      turn = []
      continue
    }
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
      if (!calls && !toolsInTurn) {
        toolless++
        if (isFragment(text)) fragments.push(where)
      }
      if (!calls) {
        // The turn as the gate sees it: history and the user's message, no tool results of its own.
        const asked = figureSources([...history, ...turn.filter((m) => m.role === "user")])
        const missing = asked === undefined ? [] : unfetchedFigures(text, asked)
        if (!ranDataTool(turn)) {
          noData++
          if (claimsFetch(text)) claiming++
          if (missing.length >= UNFETCHED_MIN_FIGURES) unfetched.push(`${where} [${missing.join(" ")}]`)
        } else if (claimsFetch(text) && asked !== undefined && unfetchedFigures(text, "").length > 0) {
          cited++
          if (missing.length >= UNFETCHED_MIN_FIGURES) caught++
          const left = unfetchedFigures(text, figureSources([...history, ...turn.slice(0, -1)]) ?? "")
          if (left.length >= UNFETCHED_MIN_FIGURES) misfired.push(`${where} [${left.join(" ")}]`)
        }
      }
    }
    const figures = ungroundedInTurn([...history, ...turn.filter((m) => m.role === "user")], turn)
    if (figures) {
      judged++
      if (figures.length > 0) ungrounded.push(`${where} [${figures.join(" ")}]`)
    }
    history.push(...turn)
    turn = []
    last = undefined
    toolsInTurn = false
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
Bị coi là "mẩu câu nối tiếp" (sẽ gửi lại model): ${fragments.length}`)
for (const line of fragments.slice(0, show)) console.log(`  ${line}`)
console.log(`  (trên ${toolless} câu trả lời cuối của lượt không gọi tool; chỉ xét câu ≤${FRAGMENT_MAX_CHARS} ký tự)`)
console.log(`
Bị coi là "số liệu không có tool nào lấy" (sẽ gửi lại model): ${unfetched.length}`)
for (const line of unfetched.slice(0, show)) console.log(`  ${line}`)
console.log(`  (trên ${noData} câu trả lời cuối của lượt không có tool dữ liệu; ${claiming} câu trong đó nêu nguồn hoặc nói đã lấy dữ liệu)`)
console.log(`  Thử tải, trên ${cited} câu trả lời có nguồn và số của lượt có tool:`)
console.log(`  - bỏ kết quả tool đi (giống số bịa): bắt được ${caught}/${cited}`)
console.log(`  - giữ kết quả tool (giống lượt sau nhắc lại số đã lấy): báo nhầm ${misfired.length}/${cited}`)
for (const line of misfired.slice(0, show)) console.log(`    ${line}`)
console.log(`
Số không có trong kết quả tool (lượt có tool, chỉ đo, chưa gửi lại model): ${ungrounded.length}/${judged}`)
for (const line of ungrounded.slice(0, show)) console.log(`  ${line}`)
console.log(`
Câu dạo đầu thật (kèm gọi tool) nhận ra là lời hứa: ${preambles - missed.length}/${preambles}`)
for (const line of missed.slice(0, show)) console.log(`  sót: ${line}`)
