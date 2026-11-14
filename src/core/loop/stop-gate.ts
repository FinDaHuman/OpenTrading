import type { Ablations } from "../ablation"
import { isCallTag, stripMarkup } from "./markup"
import { answerFigures, sourceNumbers, tracesTo, ungroundedFigures } from "./figures"
import type { ModelMessage, StepResult, ToolSet } from "ai"
import { hasOpenTodos, LEGACY_TODO_PREFIX, TODO_PREFIX, TODO_WRITE, type Todo } from "../tools/todos"

/**
 * When a turn may end. Every harness read (Claude Code, Codex, opencode, Gemini CLI) ends a
 * turn when the model calls no tool; what differs is the gate at that point. This one is code
 * only — no model call judges the answer (quota) — and spends a request only on a final step
 * that is already broken, never on a valid answer.
 *
 * Seen 29/10 with gemini-3.1-flash-lite: a turn whose whole answer was
 * "*(Đã hoàn thành các việc cần làm)*" (the model echoing its own todo status) ended as done.
 */

/** Recovery requests a turn may spend at most: the gate never loops. */
export const MAX_RECOVERIES = 2

export type RecoveryKind = "malformed" | "text-call" | "length" | "empty" | "promise" | "fragment" | "unfetched" | "draft"

/** What the last request's final step produced. */
export interface LastStep {
  /** Text of that step only (an earlier step's preamble is not an answer). */
  text: string
  /** Tools it called. */
  toolNames: string[]
  /** The SDK's unified finish reason (stop, length, content-filter…). */
  finish?: string
  /** The provider's own (Gemini: MALFORMED_FUNCTION_CALL, SAFETY…). */
  rawFinish?: string
  /** It streamed reasoning. */
  reasoned?: boolean
  /** The step came right after tool results. */
  afterTools?: boolean
  /** A tool already ran in this turn (a fragment is only judged on a turn without any). */
  toolsInTurn?: boolean
  /** A tool other than todo_write ran in this turn: there is data to answer from. */
  dataInTurn?: boolean
  /**
   * Data tools whose data the turn lacks (loop/failures.ts), and whether any tool other than the
   * harness's own returned something. Undefined = not measured (judged as before).
   */
  gaps?: readonly string[]
  usableData?: boolean
  /** A data tool (MCP, web) returned data in this turn. */
  fetchedData?: boolean
  /** Figures presented as fetched data with nothing behind them (see unfetchedFigures). */
  unfetched?: number
}

export type Verdict =
  | { action: "accept" }
  | { action: "continue"; kind: RecoveryKind; nudge: string; toolChoice: "auto" | "none" }
  /** Broken and no recovery left (or none would help): end the turn and say so. */
  | { action: "give-up"; kind: RecoveryKind | "blocked" }

/** A call the model meant but sent malformed, or a call where none was allowed. */
const MALFORMED = /^(MALFORMED_FUNCTION_CALL|UNEXPECTED_TOOL_CALL)$/i
/** Stopped by the provider's filters: asking again gets the same answer. */
const BLOCKED = /^(SAFETY|RECITATION|BLOCKLIST|PROHIBITED_CONTENT|SPII|IMAGE_SAFETY|LANGUAGE)$/i

export const RESCUE_MALFORMED =
  "<nhac_nho>\nLời gọi tool vừa rồi sai định dạng nên không chạy. Gọi lại tool đúng tham số, hoặc trả lời người dùng nếu đã đủ dữ liệu.\n</nhac_nho>"
/**
 * The step was only a tool call written as text (DeepSeek's DSML in issues #268 and #278, a
 * `<tool_call>` block): markup.ts took it out and nothing ran. Tools stay on. The empty-answer
 * rescue would turn them off right after tool results, and the model then does the arithmetic it
 * meant to run in its head.
 */
export const RESCUE_TEXT_CALL =
  "<nhac_nho>\nLời gọi tool vừa rồi được viết thành chữ trong câu trả lời nên chưa chạy. Gọi lại tool đó bằng tool call ngay trong bước này, hoặc trả lời người dùng nếu đã đủ dữ liệu. Không viết thẻ lời gọi tool thành chữ.\n</nhac_nho>"
export const RESCUE_LENGTH =
  "<nhac_nho>\nCâu trả lời bị cắt vì chạm giới hạn độ dài output. Viết tiếp ngay từ chỗ dừng: không xin lỗi, không tóm tắt lại phần đã viết.\n</nhac_nho>"
/** Gemini CLI's nudge after an empty answer: the answer, or a tool when data is missing. */
export const RESCUE_EMPTY =
  "<nhac_nho>\nBạn chưa viết câu trả lời nào cho người dùng. Trả lời ngay dựa trên dữ liệu đã có, hoặc gọi tool nếu còn thiếu dữ liệu. Không viết dòng trạng thái việc cần làm.\n</nhac_nho>"
export const RESCUE_PROMISE =
  "<nhac_nho>\nBước trước kết thúc mà không gọi tool nào. Thiếu dữ liệu thì gọi tool ngay trong bước này; đủ rồi thì trả lời người dùng.\n</nhac_nho>"
export const RESCUE_FRAGMENT =
  "<nhac_nho>\nTrả lời trực tiếp tin nhắn mới nhất của người dùng ở trên; gọi tool nếu cần dữ liệu.\n</nhac_nho>"
export const RESCUE_UNFETCHED =
  "<nhac_nho>\nLượt này chưa có tool nào chạy. Gọi tool lấy dữ liệu ngay trong bước này rồi mới viết số liệu; không lấy được thì nói rõ là thiếu dữ liệu và không viết số.\n</nhac_nho>"
export const RESCUE_DRAFT =
  "<nhac_nho>\nBạn chưa viết câu trả lời cho người dùng. Viết ngay câu trả lời hoàn chỉnh từ kết quả tool ở trên, theo cấu trúc của skill đã nạp; mục nào chưa có dữ liệu thì ghi rõ là thiếu. Không viết dàn ý, kế hoạch hay tên tool.\n</nhac_nho>"
/** A draft written before any data came: fetch first, or answer. */
export const RESCUE_DRAFT_FETCH =
  "<nhac_nho>\nBạn chưa viết câu trả lời cho người dùng và lượt này chưa lấy dữ liệu nào. Gọi tool lấy dữ liệu ngay trong bước này rồi trả lời; không viết dàn ý, kế hoạch hay tên tool.\n</nhac_nho>"
/** Tools off (it brought 2.5-flash-lite's empty answers back). */
export const RESCUE_EMPTY_FINAL = "Hãy trả lời câu hỏi của người dùng dựa trên kết quả tool ở trên. Không gọi thêm tool. Số cần tính mà chưa tính được thì tự tính từ đúng các số tool đã trả về và ghi rõ công thức cùng từng số đầu vào."

/** Data sources failed this turn and none brought data (a clock or file tool may still have run). */
export const sourcesFailed = (last: Pick<LastStep, "gaps" | "fetchedData">) => !!last.gaps?.length && last.fetchedData === false

/** How the gap rescue starts: the loop leaves out the failure reminder beside it (same gaps). */
export const GAPS_RESCUE_START = "<nhac_nho>\nCác nguồn sau chưa trả dữ liệu trong lượt này:"

/**
 * An empty answer when every data source of the turn failed: answer about what is missing. 13/11
 * eval m6: after this rescue the model wrote "Mình đang thực hiện các bước khắc phục để kết nối
 * lại với nguồn dữ liệu mới", work nothing in the harness does, hence the clause against it.
 */
export function rescueGaps(gaps: readonly string[]): string {
  return `${GAPS_RESCUE_START} ${gaps.join(", ")}. Viết ngay câu trả lời cho người dùng: nói rõ phần nào chưa lấy được và vì sao (nguồn lỗi, quá thời gian), dùng phần dữ liệu khác nếu đã có, không tự điền số cho phần thiếu, gợi ý thử lại sau. Không viết là bạn đang khắc phục hay kết nối lại nguồn. Không viết dòng nhắc việc hay thẻ hệ thống.\n</nhac_nho>`
}

/** Last empty-answer rescue: data is in the turn, write the final answer now. */
export const RESCUE_ANSWER_NOW =
  "Viết NGAY câu trả lời cuối cùng cho người dùng, đúng định dạng được yêu cầu, chỉ dùng các số tool đã trả về ở trên (số chưa tính được thì tự tính và ghi công thức cùng từng số đầu vào). Không suy luận dài, không gọi tool, không trả lời rỗng."

export function judgeStop(last: LastStep, done: readonly RecoveryKind[], disabled?: Ablations): Verdict {
  // Still calling tools: the step cap ended the run, and its summary step has its own rules.
  if (last.toolNames.some((name) => name !== TODO_WRITE)) return { action: "accept" }
  const raw = last.rawFinish ?? ""
  const empty = isEmptyAnswer(last.text)
  const left = MAX_RECOVERIES - done.length
  const used = (kind: RecoveryKind) => done.filter((k) => k === kind).length
  const once = (kind: Extract<RecoveryKind, "malformed" | "text-call" | "promise" | "unfetched" | "fragment" | "draft">) => left > 0 && used(kind) === 0 && !disabled?.has(`gate-${kind}`)

  if (empty && (BLOCKED.test(raw) || last.finish === "content-filter")) return { action: "give-up", kind: "blocked" }
  if (MALFORMED.test(raw) && empty) {
    if (once("malformed")) return { action: "continue", kind: "malformed", nudge: RESCUE_MALFORMED, toolChoice: "auto" }
    return { action: "give-up", kind: "malformed" }
  }
  // Nothing but a call written as text: ask for the real call once. A second one is an empty answer.
  if (empty && isTextCall(last.text) && once("text-call")) return { action: "continue", kind: "text-call", nudge: RESCUE_TEXT_CALL, toolChoice: "auto" }
  if (!empty && last.finish === "length") {
    // A cut answer is still an answer: out of budget, keep it as it is.
    if (left > 0 && !disabled?.has("gate-length")) return { action: "continue", kind: "length", nudge: RESCUE_LENGTH, toolChoice: "auto" }
    return { action: "accept" }
  }
  if (empty) {
    // Every source failed (13/11 eval m6, m3): "answer from the tool results" left the model nothing
    // to write, so it answered empty again. Ask for the answer about what is missing instead, tools
    // off first (the calls were already retried), then on (it may try another source).
    const failedOnly = sourcesFailed(last)
    if (failedOnly && left > 0 && !disabled?.has("gate-empty"))
      return { action: "continue", kind: "empty", nudge: rescueGaps(last.gaps!), toolChoice: used("empty") === 0 ? "none" : "auto" }
    // Pilot or15 fin-l5-profile-01: after a tool loop both rescues came back reasoning-only, the turn ended with
    // fetched data and no answer. One last, answer-only rescue with tools off when the turn has data.
    const hasData = !failedOnly && (last.usableData ?? last.dataInTurn)
    if (left <= 0 && hasData && used("empty") < MAX_RECOVERIES + 1 && !disabled?.has("gate-empty"))
      return { action: "continue", kind: "empty", nudge: RESCUE_ANSWER_NOW, toolChoice: "none" }
    if (left <= 0 || disabled?.has("gate-empty")) return { action: "give-up", kind: "empty" }
    // Right after tool results the data is there: tools off first, the fix that brought
    // 2.5-flash-lite's empty answers back. Otherwise the model may still lack data, so it may
    // call a tool first (Gemini CLI). The second try is the other one.
    const off = !!last.afterTools !== (used("empty") > 0)
    return off
      ? { action: "continue", kind: "empty", nudge: RESCUE_EMPTY_FINAL, toolChoice: "none" }
      : { action: "continue", kind: "empty", nudge: RESCUE_EMPTY, toolChoice: "auto" }
  }
  // After a cut answer the step holds only the rest of it, so the checks below cannot judge it.
  const continuing = done.includes("length")
  // The step ended on its own: no tool, or only a todo_write beside the answer. That one finishes
  // as "tool-calls" (the SDK's name for Gemini's STOP with a function call), not "stop".
  const finished = last.toolNames.every((name) => name === TODO_WRITE) && ["stop", "tool-calls"].includes(last.finish ?? "stop")
  // Wrote its own working notes (an outline, "chưa lấy… sẽ", a todo_write to call) as the answer,
  // once. With data fetched, tools off: write the answer from it. Without, it may fetch first.
  if (finished && !continuing && isDraft(last.text) && once("draft")) {
    return last.dataInTurn
      ? { action: "continue", kind: "draft", nudge: RESCUE_DRAFT, toolChoice: "none" }
      : { action: "continue", kind: "draft", nudge: RESCUE_DRAFT_FETCH, toolChoice: "auto" }
  }
  // Said it would fetch something and stopped without calling a tool: send it back once, tools on.
  if (last.toolNames.length === 0 && (last.finish ?? "stop") === "stop" && isPromise(last.text)) {
    if (once("promise")) return { action: "continue", kind: "promise", nudge: RESCUE_PROMISE, toolChoice: "auto" }
  }
  // Presented figures as fetched data with no tool behind them: send it back once, tools on.
  if (finished && !continuing && isUnfetched(last)) {
    if (once("unfetched")) return { action: "continue", kind: "unfetched", nudge: RESCUE_UNFETCHED, toolChoice: "auto" }
  }
  // Continued an earlier sentence instead of answering the new message: send it back once.
  if (last.toolNames.length === 0 && (last.finish ?? "stop") === "stop" && !last.toolsInTurn && !continuing && isFragment(last.text)) {
    if (once("fragment")) return { action: "continue", kind: "fragment", nudge: RESCUE_FRAGMENT, toolChoice: "auto" }
  }
  return { action: "accept" }
}

/**
 * Lines a model writes when it echoes the todo tool instead of answering: the tool's result
 * prefix, the TUI's one-line label, "(Đã hoàn thành các việc cần làm)".
 */
const ECHO_LINE = new RegExp(
  `^(${escape(TODO_PREFIX)}|${escape(LEGACY_TODO_PREFIX)}|Cập nhật việc cần làm|Đã hoàn thành (hết |tất cả |toàn bộ )?(các )?việc cần làm|Đã đóng (danh sách )?việc cần làm)`,
  "i",
)
/** A rendered todo item (renderTodos): only dropped next to an echoed status line. */
const TODO_ITEM = /^\[[x> -]\] /

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Zero-width characters and HTML comments carry no answer (Gemini CLI strips them too). */
function invisible(text: string) {
  return text.replace(/[​-‍﻿‎‏]/g, "").replace(/<!--[\s\S]*?-->/g, "")
}

/** A line stripped of markdown emphasis and wrapping parentheses. */
const bare = (line: string) => line.normalize("NFC").trim().replace(/^[\s*_()]+|[\s*_()]+$/g, "")

/**
 * The text without echoed todo status lines (and the item list printed under one), and without
 * harness markup (loop/markup.ts) unless `markup` is false.
 */
export function stripEchoes(text: string, { markup = true }: { markup?: boolean } = {}): string {
  if (markup) text = stripMarkup(text).text
  const lines = text.split("\n")
  if (!lines.some((line) => ECHO_LINE.test(bare(line)))) return text
  const kept = lines.filter((line) => {
    const b = bare(line)
    return !ECHO_LINE.test(b) && !TODO_ITEM.test(line.trim())
  })
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

/** Verbs of fetching or working that a promise names. */
const ACTS =
  "lấy|tải|nạp|kiểm tra|tra cứu|tra|xem|tìm|gọi|phân tích|tổng hợp|truy vấn|so sánh|vẽ|đọc|thu thập|cập nhật|tính|rà soát|đối chiếu|chạy|thử|sử dụng|dùng|gửi|bổ sung|nghiên cứu"

/** What a fetch is about: a promise names data or tools, advice to the user does not. */
const OBJECTS = "dữ liệu|số liệu|thông tin|tool|công cụ|skill|chúng|nguồn|báo cáo|BCTC|giá|kết quả"

/** A promise to act: "mình sẽ lấy…", "để mình kiểm tra", "vui lòng chờ", "let me…", "I'll…". */
// JS's \b only knows ASCII letters ("Để", "thử" break it): word edges are spelled out.
const B = String.raw`(?<![\p{L}\p{N}_])`
const E = String.raw`(?![\p{L}\p{N}_])`
const INTENT = new RegExp(
  [
    String.raw`${B}(mình|tôi|em)\s+(sẽ|đang|xin phép|cần|tiến hành)\s+(đi\s+)?(${ACTS})${E}`,
    // Subject-less, at the start of the sentence or clause, about data or tools ("Đang lấy dữ
    // liệu…", "giờ gọi chúng…", "Thử các nguồn khác"): advice to the user ("Thử đặt lệnh…",
    // "Tiếp tục nghiên cứu ngành…") names no data or tool.
    String.raw`(^|[,;]\s*)(đang|bây giờ|giờ|tiếp theo|trước tiên|bắt đầu)\s+(cần\s+)?(${ACTS})${E}.{0,30}${B}(${OBJECTS})${E}`,
    String.raw`(^|[,;]\s*)thử\s+(lại|các nguồn|nguồn|tool|công cụ|cách khác|dữ liệu|${B}[A-Z]{3,}${E})`,
    String.raw`(^|[,;]\s*)(gọi thêm|gọi song song|gọi cùng lúc)${E}`,
    String.raw`${B}(để|chờ|đợi)\s+(mình|tôi|em)${E}`,
    String.raw`${B}vui lòng (chờ|đợi)${E}`,
    String.raw`${B}tiếp theo,?\s+(mình|tôi|em)${E}`,
    String.raw`${B}let me${E}`,
    String.raw`${B}I('ll| will| am going to)${E}`,
    String.raw`${B}next,? I${E}`,
  ].join("|"),
  "iu",
)
/** The model offers or asks: the user speaks next, so it is not a broken promise. */
const OFFER = /\?\s*$|^(nếu bạn|nếu cần|bạn có muốn|bạn muốn|if you|would you|do you want)/iu
/**
 * The sentence waits on someone other than the model: the user gives something ("bạn vui lòng
 * … cung cấp giá …, mình sẽ tính"), or a source comes back ("khi nguồn hoạt động lại, mình sẽ…"),
 * before or after "mình sẽ". 13/11 eval m3: sent back for this, the model wrote the same answer
 * twice. The subject is required: "sau khi nạp tool", "khi có dữ liệu" or "sau khi lấy được giá"
 * leave the model as the actor, and "bạn chờ chút" asks the user to wait for it. "bạn" counts
 * only where a clause starts: "thông tin bạn cung cấp, mình sẽ phân tích" is about what the user
 * already gave, a real promise.
 */
const WAITS = new RegExp(
  [
    String.raw`(^|[,;:]\s*|${B}(khi|nếu|sau khi|một khi|ngay khi|hoặc)\s+)bạn\s+((vui lòng|có thể|hãy|cứ|chỉ cần|thử)\s+)*(thử lại|cung cấp|gửi|nhập|chọn|chia sẻ|xác nhận|cho (mình|tôi|em) biết)${E}`,
    String.raw`${B}(khi|nếu|sau khi|một khi|ngay khi)\s+(nguồn|hệ thống|kết nối|dữ liệu|máy chủ)${E}[^,.;!?]{0,40}${B}(hoạt động|trở lại|ổn định|khôi phục|phục hồi|có lại)${E}`,
  ].join("|"),
  "iu",
)
/** Above this, the text is an answer that happens to end on a plan, not a bare promise. */
export const PROMISE_MAX_CHARS = 400

/**
 * The step only promised to act and stopped: short, no table, and its last sentence says the
 * model is about to do something (or it ends on ":"), without offering it to the user. Gemini
 * CLI asks a model "who speaks next" for this; here it is a check in code (no request).
 */
export function isPromise(text: string): boolean {
  const body = stripEchoes(invisible(text)).trim()
  // Prices, percentages and amounts: a text carrying them already answers something.
  if (!body || body.length > PROMISE_MAX_CHARS || /^\s*\|.*\|\s*$/m.test(body) || answerFigures(body).length > 0) return false
  const lastLine = bare(body.split("\n").filter((l) => l.trim()).at(-1) ?? "")
  if (OFFER.test(lastLine)) return false
  if (/:\s*$/.test(lastLine)) return true
  const sentences = lastLine.split(/(?<=[.!…])\s+/).filter((s) => s.trim())
  const last = sentences.at(-1) ?? lastLine
  // An offer within the sentence (OFFER only sees the start of the line).
  return INTENT.test(last) && !WAITS.test(last) && !OFFER.test(last)
}

/** A harness tool named in prose: an answer for the user has no use for these names. */
const HARNESS_TOOL = /(?<![\w])(todo_write|load_skill|tool_search|spawn_subagent)(?![\w])/
/** A line the model writes to itself: what it fetched, what it must still do, how it will answer. */
const SELF_NOTE = /^(cấu trúc (câu )?trả lời|cần phân tích (tiếp|thêm)|đã đủ dữ liệu để|kết quả đã lấy\s*:|todo close)/iu
/** A section it means to fill later: "Kỹ thuật (chưa lấy - sẽ dựa trên…)". */
const PLANNED = new RegExp(String.raw`${B}chưa (lấy|có dữ liệu)${E}[^\n]{0,40}${B}sẽ${E}`, "iu")
/** Signals a step must show at least this many kinds of before it counts as a draft. */
export const DRAFT_MIN_SIGNALS = 2

/**
 * The step is the model's working notes, not an answer. Seen 08/11 with gemini-3.1-flash-lite:
 * "Kết quả đã lấy: …", "Cần phân tích tiếp", "Cấu trúc trả lời (theo yêu cầu): 1. … 3. Kỹ thuật
 * (chưa lấy - sẽ dựa trên…)", "Todo close: Gọi `todo_write`", then a todo_write closing the list.
 * Each signal alone also turns up in real answers (a list of tools, a company's "Kế hoạch:"), so
 * two kinds are needed: over 596 stored assistant texts (sessions and docs/eval) only that one
 * matched.
 */
export function isDraft(text: string): boolean {
  const body = stripEchoes(invisible(text)).normalize("NFC")
  const lines = body.split("\n").map(bare)
  const signals = [HARNESS_TOOL.test(body), lines.some((line) => SELF_NOTE.test(line)), PLANNED.test(body)]
  return signals.filter(Boolean).length >= DRAFT_MIN_SIGNALS
}

/** Above this, the text is an answer of its own, not a stray continuation. */
export const FRAGMENT_MAX_CHARS = 300

/**
 * The whole answer is the tail of a sentence: a space then a lowercase word, or a comma,
 * semicolon, colon, closing bracket or ellipsis first. Seen 30/10 with gemini-3.1-flash-lite,
 * which answered a new question with " hoặc FPT không, hoặc bạn muốn…" or ", bạn có thể phân
 * tích thêm cho mình…" (continuing its previous closing line, see loop/history-shape.ts). A
 * real answer starts a sentence, a ticker, a number or markdown, or a line ("\n\nDưới đây…").
 */
export function isFragment(text: string): boolean {
  const raw = invisible(text).normalize("NFC")
  const body = stripEchoes(raw).trim()
  if (!body || body.length > FRAGMENT_MAX_CHARS) return false
  return /^[ \t]+\p{Ll}/u.test(raw) || /^[,;:)…]/u.test(body)
}

/** Figures an answer must lack a source for before the gate spends a request on it. */
export const UNFETCHED_MIN_FIGURES = 2

/** The step's answer carries figures no tool, user or earlier turn gave. */
export const isUnfetched = (last: Pick<LastStep, "unfetched">) => (last.unfetched ?? 0) >= UNFETCHED_MIN_FIGURES

/** A tool's own name: a harness or provider identifier the model copied into the answer. */
const TOOL_NAME = /mcp__\w+|default_api:/
/** The answer says it fetched the data. "Chưa lấy dữ liệu" and offers do not match. */
const FETCH_CLAIM = new RegExp(String.raw`${B}(đã|vừa)\s+(lấy|tra cứu|truy xuất|tải)\s+(được\s+)?(dữ liệu|số liệu)${E}`, "iu")
/** A `Nguồn:` line, wherever markdown or a bracket puts it, and what follows it. */
const SOURCE_LINE = new RegExp(String.raw`${B}nguồn\s*[:：]([^\n]*)`, "giu")
/** The source is the user, the model's own arithmetic or an example: no fetch is claimed. */
const NOT_FETCHED = new RegExp(String.raw`${B}(bạn|người dùng|tự tính|tính từ|ví dụ|giả định|minh họa|minh hoạ)${E}`, "iu")

/** The answer claims its data was fetched: it names a tool, says so, or cites a data source. */
export function claimsFetch(text: string): boolean {
  const body = text.normalize("NFC")
  if (TOOL_NAME.test(body) || FETCH_CLAIM.test(body)) return true
  return [...body.matchAll(SOURCE_LINE)].some((source) => !NOT_FETCHED.test(source[1] ?? ""))
}

/**
 * Figures of an answer that claims fetched data but that `known` (see figureSources) does not
 * hold, at any common scale and rounded as the answer writes them. Seen 05/11 with
 * gemini-3.1-flash-lite: no tool in the turn, "Tôi đã lấy dữ liệu" and a `Nguồn:` naming a tool
 * over an invented P/E, ROE and revenue. An answer that claims nothing is never judged: it may
 * be a worked example or the user's own numbers, and a misfire costs a request. For the same
 * reason figures marked as computed do not count, and an answer whose figures are mostly known
 * is a follow-up on fetched data: empty result.
 */
export function unfetchedFigures(text: string, known: string): string[] {
  if (!claimsFetch(text)) return []
  // Read as the eval scorer and the per-turn measure read them (figures.ts): one figure written
  // twice counts once, "nghìn tỷ" and "…T" keep the rounding they were written with.
  const seen = new Set<string>()
  const figures = answerFigures(text).filter((f) => !f.derived && !seen.has(f.text) && seen.add(f.text))
  if (figures.length === 0) return []
  const numbers = sourceNumbers(known)
  const missing = figures.filter((f) => !tracesTo(f, numbers)).map((f) => f.text)
  return missing.length * 2 >= figures.length ? missing : []
}

/**
 * Figures of a turn's answer that nothing it read holds, in a turn where tools ran. Only measured:
 * the guard tried on 13/10 had no precision, so this sends nothing back until a replay shows it
 * can. Undefined when it cannot judge: no tool ran, or an image or file is in the turn.
 */
export function ungroundedInTurn(earlier: readonly ModelMessage[], turn: readonly ModelMessage[], context = ""): string[] | undefined {
  const asked = figureSources(earlier)
  const results = turn.filter((m) => m.role === "tool")
  const answer = turn.findLast((m) => m.role === "assistant")
  if (asked === undefined || results.length === 0 || !answer) return undefined
  const text = typeof answer.content === "string" ? answer.content : answer.content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("")
  const numbers = sourceNumbers(`${context}\n${asked}`)
  // Each result on its own: a JSON result reads as JSON.
  for (const message of results) {
    for (const part of message.content) {
      if (part.type !== "tool-result") continue
      const { value } = part.output as { value?: unknown }
      for (const n of sourceNumbers(typeof value === "string" ? value : JSON.stringify(value ?? ""))) numbers.add(n)
    }
  }
  return ungroundedFigures(text, numbers)
}

/**
 * Everything a turn may take figures from, as text; undefined when the turn has an image or a
 * file (figures read from one cannot be checked here).
 */
export function figureSources(messages: readonly ModelMessage[]): string | undefined {
  const opaque = messages.some((m) => typeof m.content !== "string" && m.content.some((part) => part.type === "image" || part.type === "file"))
  return opaque ? undefined : JSON.stringify(messages)
}

/** A tool other than the todo list ran: a todo_write fetches nothing. */
export function ranDataTool(messages: readonly ModelMessage[]): boolean {
  return messages.some((m) => m.role === "tool" && m.content.some((part) => part.type === "tool-result" && part.toolName !== TODO_WRITE))
}

/** No answer in it: nothing visible once echoed todo lines are gone. */
/**
 * The text holds a tool call written as markup (it never ran). A fake todo_write is not counted:
 * like a real one, it is no reason to hand the tools back (the empty-answer rescue decides).
 */
export function isTextCall(text: string): boolean {
  return stripMarkup(text).tags.some((tag) => tag !== TODO_WRITE && isCallTag(tag))
}

export function isEmptyAnswer(text: string): boolean {
  return stripEchoes(invisible(text)).trim() === ""
}

function resultText(output: unknown): string {
  if (typeof output === "string") return output
  const text = output && typeof output === "object" && "output" in output ? (output as { output: unknown }).output : undefined
  return typeof text === "string" ? text : ""
}

/**
 * Stop condition: the step wrote the answer and closed the todo list in the same step. Without
 * it the SDK runs one more request after todo_write, which comes back empty (29/10). A step
 * that opens a list ("Để mình lấy dữ liệu…" + todo_write with pending items) goes on.
 */
export function answeredAndClosedTodos({ steps }: { steps: StepResult<ToolSet>[] }): boolean {
  const step = steps.at(-1)
  // An echoed status line is no answer: the SDK runs the next step as it would anyway.
  if (!step || isEmptyAnswer(step.text) || step.toolCalls.length === 0) return false
  return step.toolCalls.every((call) => {
    if (call.toolName !== TODO_WRITE) return false
    // The registry wraps a tool's text as { output } (ToolResult).
    const ok = step.toolResults.some((r) => r.toolCallId === call.toolCallId && resultText(r.output).startsWith(TODO_PREFIX))
    const todos = (call.input as { todos?: Todo[] } | undefined)?.todos
    return ok && Array.isArray(todos) && !hasOpenTodos(todos)
  })
}
