import type { ModelMessage } from "ai"

/**
 * Tool errors as the model and the user read them. The AI SDK builds them with
 * `Error.toString()`, so they reach both as "AI_ToolCallRepairError: Error repairing tool
 * call: Error: …" and "AI_InvalidToolInputError: … Value: {the whole input} … [zod JSON]".
 * Like Claude Code (formatZodValidationError) and opencode, keep only what helps the next
 * call: one line per wrong parameter, never the input echoed back.
 */

/** Same cap as a thrown tool error (wrap.ts MAX_ERROR_CHARS). */
const MAX_CHARS = 2000

const PREFIX = /^(?:AI_\w+Error: |Error repairing tool call: |\w*Error: )/

interface Issue {
  code?: string
  path?: (string | number)[]
  message?: string
  origin?: string
  minimum?: number | string
  maximum?: number | string
  inclusive?: boolean
  expected?: string
  values?: unknown[]
  keys?: string[]
}

const TYPES: Record<string, string> = {
  string: "chuỗi",
  number: "số",
  int: "số nguyên",
  boolean: "true/false",
  array: "mảng",
  object: "object",
}

function where(path: Issue["path"]) {
  if (!path || path.length === 0) return ""
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? p : `.${p}`)).join("")
}

function describeIssue(issue: Issue): string {
  const field = where(issue.path)
  const at = field ? `${field}: ` : ""
  switch (issue.code) {
    case "too_small":
    case "too_big": {
      const small = issue.code === "too_small"
      const bound = small ? issue.minimum : issue.maximum
      if (issue.origin === "array") return `${at}cần ${small ? "ít nhất" : "tối đa"} ${bound} phần tử`
      if (issue.origin === "string") return `${at}cần ${small ? "ít nhất" : "tối đa"} ${bound} ký tự`
      return `${at}phải ${small ? (issue.inclusive === false ? ">" : "≥") : issue.inclusive === false ? "<" : "≤"} ${bound}`
    }
    case "invalid_type":
      if (/received undefined/.test(issue.message ?? "")) return `${at}thiếu (bắt buộc)`
      return `${at}phải là ${TYPES[issue.expected ?? ""] ?? issue.expected ?? "kiểu khác"}`
    case "invalid_value":
      return `${at}phải là một trong: ${(issue.values ?? []).map((v) => JSON.stringify(v)).join(", ")}`
    case "unrecognized_keys":
      return `${at}không có tham số ${(issue.keys ?? []).join(", ")}`
    default:
      return `${at}${issue.message ?? "không hợp lệ"}`
  }
}

/** The zod issues the SDK printed after "Error message: ", if they parse. */
function issuesOf(text: string): Issue[] | undefined {
  const at = text.lastIndexOf("Error message: ")
  if (at < 0) return undefined
  try {
    const parsed = JSON.parse(text.slice(at + "Error message: ".length))
    return Array.isArray(parsed) && parsed.every((i) => i && typeof i === "object") ? (parsed as Issue[]) : undefined
  } catch {
    return undefined
  }
}

function invalidInput(tool: string, rest: string): string {
  const issues = issuesOf(rest)
  if (issues && issues.length > 0) {
    return [`Tham số không hợp lệ cho ${tool}:`, ...issues.slice(0, 10).map((i) => `- ${describeIssue(i)}`), "Sửa tham số rồi gọi lại."].join("\n")
  }
  if (/JSON/i.test(rest)) return `Tham số của ${tool} không phải JSON hợp lệ. Sửa tham số rồi gọi lại.`
  return `Tham số không hợp lệ cho ${tool}: ${stripPrefixes(rest).slice(0, 300)}`
}

function stripPrefixes(text: string) {
  let out = text.trim()
  for (let m = PREFIX.exec(out); m; m = PREFIX.exec(out)) out = out.slice(m[0].length)
  return out
}

/** A tool error (an Error or the SDK's string) as one clean message. */
export function toolErrorText(error: unknown): string {
  const raw = typeof error === "string" ? error : error instanceof Error ? error.message : String(error)
  const text = stripPrefixes(raw)
  const invalid = /^Invalid input for tool ([^:\s]+): ([\s\S]*)$/.exec(text)
  if (invalid) return invalidInput(invalid[1]!, invalid[2]!).slice(0, MAX_CHARS)
  const missing = /^Model tried to call unavailable tool '([^']+)'/.exec(text)
  if (missing) return `Không có tool "${missing[1]}".`
  return text.slice(0, MAX_CHARS)
}

/**
 * The same messages with every `error-text` tool result cleaned, so the model never reads the
 * SDK's raw strings (in later steps, and in saved history for later turns). Unchanged
 * messages are returned as they are.
 */
export function cleanToolErrors(messages: ModelMessage[]): ModelMessage[] {
  let changed = false
  const out = messages.map((message) => {
    if (message.role !== "tool" || !Array.isArray(message.content)) return message
    let touched = false
    const content = message.content.map((part) => {
      if (part.type !== "tool-result" || part.output.type !== "error-text") return part
      const value = toolErrorText(part.output.value)
      if (value === part.output.value) return part
      touched = true
      return { ...part, output: { ...part.output, value } }
    })
    if (!touched) return message
    changed = true
    return { ...message, content } as ModelMessage
  })
  return changed ? out : messages
}
