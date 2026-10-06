import type { ModelMessage } from "ai"
import { LOADED_PREFIX } from "./tools/search"

/**
 * The user message that opens a compacted history. Besides telling the model what happened,
 * it carries what the harness derives from history — loaded deferred tools, loaded skills,
 * the open todo list — since the messages they came from were summarized away.
 * Kept free of other core imports: loaded.ts and todos.ts read it.
 */

export const COMPACT_TAG = "tom_tat_hoi_thoai"
const TODOS_TAG = "viec_can_lam_luu"
const SKILLS_PREFIX = "Skill đã nạp: "

const COMPACT_HEADER =
  "Phần đầu cuộc hội thoại đã được nén thành bản tóm tắt ở tin nhắn ngay sau. Số liệu trong tóm tắt giữ nguyên nguồn và thời điểm; cần số mới hơn hoặc chi tiết đã lược thì gọi lại tool."

interface CarriedTodo {
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
}

const markerText = (m: ModelMessage) =>
  m.role !== "user" ? "" : typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? p.text : "")).join("\n")

export const isCompactMarker = (m: ModelMessage) => m.role === "user" && markerText(m).includes(`<${COMPACT_TAG}>`)

/** What the harness wrote into a compact marker. */
export function compactCarry(m: ModelMessage): { tools: string[]; todos?: unknown } {
  const text = markerText(m)
  const line = text.split("\n").find((l) => l.startsWith(LOADED_PREFIX))
  const tools = line
    ? line
        .slice(LOADED_PREFIX.length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  const json = new RegExp(`<${TODOS_TAG}>([\\s\\S]*?)</${TODOS_TAG}>`).exec(text)?.[1]
  let todos: unknown
  if (json) {
    try {
      todos = JSON.parse(json)
    } catch {
      todos = undefined
    }
  }
  return { tools, todos }
}

export function compactPair(summary: string, carry: { tools: string[]; skills: string[]; todos: CarriedTodo[] }): ModelMessage[] {
  const lines = ["<nhac_nho>", `<${COMPACT_TAG}>`, COMPACT_HEADER]
  if (carry.tools.length > 0) lines.push(`${LOADED_PREFIX}${carry.tools.join(", ")}`)
  if (carry.skills.length > 0) lines.push(`${SKILLS_PREFIX}${carry.skills.join(", ")} — gọi lại load_skill nếu cần hướng dẫn chi tiết.`)
  if (carry.todos.length > 0) lines.push(`<${TODOS_TAG}>${JSON.stringify(carry.todos)}</${TODOS_TAG}>`)
  lines.push(`</${COMPACT_TAG}>`, "</nhac_nho>")
  return [
    { role: "user", content: lines.join("\n") },
    { role: "assistant", content: summary.trim() },
  ]
}
