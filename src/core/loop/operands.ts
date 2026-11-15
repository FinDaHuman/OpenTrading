import type { ModelMessage } from "ai"
import { sourceNumbers, valueTracesTo } from "./figures"

/**
 * The numbers a model typed into an arithmetic command, checked against what it had read: the
 * question, earlier tool results, earlier command output. Issue #278 N2: with `calculate` gone the
 * operands are retyped, so a dropped zero (`21500000` for `215000000`, 15/11 run) computes a wrong
 * answer from a command that ran fine. The eval's shell-metrics measures it; the loop sends a
 * one-step note after such a command (never blocks it).
 */

/**
 * Numbers nobody has to fetch: small counts, percent and unit factors, trading days in a year.
 * A typed operand outside this list should be somewhere in what the model read.
 */
const CONSTANTS = new Set([0, 1, 2, 3, 4, 10, 12, 100, 250, 252, 365])
export const isConstant = (value: number) => CONSTANTS.has(value) || (value >= 1000 && Number.isInteger(Math.log10(value)))

/**
 * Scales an operand may differ from its source by: a unit change (đồng, nghìn, triệu, tỷ), and a
 * percent typed as a fraction (40% as 0.40). Not ×100: with it `21500000` traced to `215000` (a
 * reading of `215.000.000`), so a dropped zero passed for a copied figure (15/11 run).
 */
export const OPERAND_SCALES = [1, 0.01, 1e3, 1e-3, 1e6, 1e-6, 1e9, 1e-9]

/** A number literal that is not part of a name (`log10`, `$x2`) or of a format (`%.2f` is inside quotes). */
const LITERAL = /(?<![\w.$])\d+(?:\.\d+)?(?:[eE][+-]?\d{1,3})?(?![\w.])/g
/** An array index (`data[6]`, `$prices[$i-1]`): a position, not a figure. */
const INDEX = /([A-Za-z_]\w*)\s*\[[^\]\n]*\]/g

/** The numbers typed into an arithmetic command, with the decimals they were written with. */
export function operandsOf(command: string): { text: string; value: number; decimals: number }[] {
  // A printf format is not an operand ("%.2f"); other quoted text may be the code (python -c "…").
  const code = command.replace(/"[^"]*%[^"]*"/g, '""').replace(INDEX, "$1")
  return [...code.matchAll(LITERAL)].map((m) => {
    const text = m[0]
    const mantissa = text.split(/[eE]/)[0]!
    return { text, value: Number(text), decimals: mantissa.includes(".") ? mantissa.length - mantissa.indexOf(".") - 1 : 0 }
  })
}

/** An operand found in `known`: a decimal may be the source rounded as typed; an integer must be the number itself. */
export function operandTraces(operand: { value: number; decimals: number }, known: Set<number>) {
  if (isConstant(operand.value)) return true
  const near = operand.decimals > 0 ? 0.5 * 10 ** -operand.decimals + 1e-9 : 1e-9
  return valueTracesTo(operand.value, near, known, OPERAND_SCALES)
}

/** The shell's own first line (`[mã thoát 0 · 0.2s · /w]`): exit code, seconds, folder digits are no data. */
export const withoutShellStatus = (text: string) => text.replace(/^\[[^\n]*\]\n?/, "")

/** A tool result's text as the model read it. */
function outputText(output: unknown): string {
  if (typeof output === "string") return output
  if (!output || typeof output !== "object") return ""
  const { value } = output as { value?: unknown }
  if (typeof value === "string") return value
  if (value !== undefined) return JSON.stringify(value)
  const inner = (output as { output?: unknown }).output
  return typeof inner === "string" ? inner : ""
}

const textOf = (message: ModelMessage) =>
  typeof message.content === "string" ? message.content : message.content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n")

/**
 * Operands of the arithmetic commands in the last assistant step that ran and that nothing the
 * model read before holds: the messages before that step, and `sources` (what the user gave the
 * harness outside the messages: the investor profile, the constraints, the memory index; not the
 * whole system prompt, whose examples hold numbers of their own). `isArithmetic` says which shell commands count (the
 * grammar of the shell that ran them). At most `max`, each once.
 */
export function untracedOperands(messages: readonly ModelMessage[], isArithmetic: (command: string) => boolean, sources = "", max = 5): string[] {
  const at = messages.findLastIndex((m) => m.role === "assistant")
  if (at < 0) return []
  const step = messages[at]!
  if (typeof step.content === "string") return []
  const calls = step.content.flatMap((p) => (p.type === "tool-call" && p.toolName === "shell" ? [p] : []))
  if (calls.length === 0) return []
  // What the user told the harness rides outside the messages (profile, constraints, memory
  // index). The caller passes them.
  const known = sourceNumbers(sources)
  for (const message of messages.slice(0, at)) {
    // An earlier answer's figures count too: a follow-up computes on them.
    if (message.role === "user" || message.role === "system" || message.role === "assistant") for (const n of sourceNumbers(textOf(message))) known.add(n)
    if (message.role !== "tool") continue
    for (const part of message.content) {
      if (part.type !== "tool-result") continue
      const text = outputText(part.output)
      for (const n of sourceNumbers(part.toolName === "shell" ? withoutShellStatus(text) : text)) known.add(n)
    }
  }
  const results = messages.slice(at + 1).filter((m) => m.role === "tool")
  const ran = (id: string) =>
    results.some((m) => typeof m.content !== "string" && m.content.some((p) => p.type === "tool-result" && p.toolCallId === id && /^\[mã thoát 0 /.test(outputText(p.output))))
  const out: string[] = []
  for (const call of calls) {
    const command = (call.input as { command?: unknown } | undefined)?.command
    if (typeof command !== "string" || !isArithmetic(command) || !ran(call.toolCallId)) continue
    for (const operand of operandsOf(command)) {
      if (out.length >= max) return out
      if (!out.includes(operand.text) && !operandTraces(operand, known)) out.push(operand.text)
    }
  }
  return out
}

/** The one-step note after such a command: the command ran, the model decides. */
export function operandNote(values: readonly string[]): string {
  return `<nhac_nho>\nSố ${values.join(", ")} trong lệnh tính vừa rồi không thấy trong dữ liệu đã có (câu hỏi, kết quả tool, output lệnh trước). Nếu đó là số chép lại thì đối chiếu với nguồn rồi chạy lại lệnh trước khi dùng kết quả; nếu là hằng số hay số bạn tự đặt thì bỏ qua nhắc này.\n</nhac_nho>`
}
