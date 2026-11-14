import { sourceNumbers, valueTracesTo } from "../../src/core/loop/figures"
import type { Attempt, Trace } from "./read-trace"
import { RAN, SHELL_ROUTES, SHELL_TOOL, type ShellRoute } from "./shell-route"

/**
 * How the model's arithmetic went through `shell` in one trace: the numbers issue #268 asked for
 * before a change to the tool merges. Read offline from the trace; no model, no key.
 */
export interface ShellMetrics {
  /** Questions answered (cut-off runs are left out). */
  attempts: number
  commands: number
  routes: Record<ShellRoute, number>
  /** Attempts that called shell at all, where at least one command ran, and where none did. */
  attempts_with_shell: number
  attempts_with_run: number
  attempts_all_refused: number
  /** Answers that say "tự tính": the model did the arithmetic in its head. */
  self_computed: number
  requests_per_attempt: number
  /** Run time of the commands that ran, from the tool's own first line. */
  exec_ms: { n: number; mean: number; p50: number; max: number }
  operands: { total: number; traced: number; untraced: Untraced[] }
}

export interface Untraced {
  q: string
  rep: number
  value: string
  command: string
}

/** Wrote the arithmetic itself (prompts/tools.md tells it to say so). */
const SELF_COMPUTED = /tự tính/iu

/**
 * Numbers nobody has to fetch: small counts, percent and unit factors, trading days in a year.
 * A typed operand outside this list should be somewhere in what the model read.
 */
const CONSTANTS = new Set([0, 1, 2, 3, 4, 10, 12, 100, 250, 252, 365])
const isConstant = (value: number) => CONSTANTS.has(value) || (value >= 1000 && Number.isInteger(Math.log10(value)))

/** A number literal that is not part of a name (`log10`, `$x2`) or of a format (`%.2f` is inside quotes). */
const LITERAL = /(?<![\w.$])\d+(?:\.\d+)?(?:[eE][+-]?\d{1,3})?(?![\w.])/g

/** The numbers typed into an arithmetic command, with the decimals they were written with. */
export function operandsOf(command: string): { text: string; value: number; decimals: number }[] {
  // A printf format is not an operand ("%.2f"); other quoted text may be the code (python -c "…").
  const code = command.replace(/"[^"]*%[^"]*"/g, '""')
  return [...code.matchAll(LITERAL)].map((m) => {
    const text = m[0]
    const mantissa = text.split(/[eE]/)[0]!
    return { text, value: Number(text), decimals: mantissa.includes(".") ? mantissa.length - mantissa.indexOf(".") - 1 : 0 }
  })
}

const commandOf = (input: unknown) => (input && typeof input === "object" && typeof (input as { command?: unknown }).command === "string" ? (input as { command: string }).command : "")

function attemptOperands(attempt: Attempt) {
  // What the model had read when it wrote each command: the question, then every earlier result
  // (a shell result too, so an intermediate value carried into the next command is traced).
  const known = sourceNumbers(attempt.question.question)
  const inputs = new Map<string, string>()
  let total = 0
  let traced = 0
  const untraced: Untraced[] = []
  for (const event of attempt.timeline) {
    if (event.type === "tool_call") {
      if (event.tool === SHELL_TOOL) inputs.set(event.call_id, commandOf(event.input))
      continue
    }
    const command = inputs.get(event.call_id)
    // Only commands that were arithmetic for sure: one that ran as such, or was refused as such.
    if (command !== undefined && (event.shell?.route === "math" || event.shell?.route === "near-miss")) {
      for (const operand of operandsOf(command)) {
        if (isConstant(operand.value)) continue
        total++
        if (valueTracesTo(operand.value, 0.5 * 10 ** -operand.decimals + 1e-9, known)) traced++
        else untraced.push({ q: attempt.q, rep: attempt.rep, value: operand.text, command })
      }
    }
    for (const n of sourceNumbers(event.visible)) known.add(n)
  }
  return { total, traced, untraced }
}

export function shellMetrics(trace: Trace): ShellMetrics {
  const routes = Object.fromEntries(SHELL_ROUTES.map((r) => [r, 0])) as Record<ShellRoute, number>
  const answered = trace.attempts.filter((a) => a.answer && a.answer.abort !== "cap")
  const times: number[] = []
  const operands = { total: 0, traced: 0, untraced: [] as Untraced[] }
  let withShell = 0
  let withRun = 0
  let selfComputed = 0
  let requests = 0
  for (const attempt of answered) {
    const shell = attempt.results.flatMap((r) => (r.shell ? [r.shell] : []))
    for (const call of shell) {
      routes[call.route]++
      if (call.exec_ms !== undefined) times.push(call.exec_ms)
    }
    if (shell.length > 0) withShell++
    if (shell.some((call) => RAN.has(call.route))) withRun++
    if (SELF_COMPUTED.test(attempt.answer!.text)) selfComputed++
    requests += attempt.answer!.requests ?? attempt.answer!.model_steps
    const found = attemptOperands(attempt)
    operands.total += found.total
    operands.traced += found.traced
    operands.untraced.push(...found.untraced)
  }
  times.sort((a, b) => a - b)
  return {
    attempts: answered.length,
    commands: Object.values(routes).reduce((a, b) => a + b, 0),
    routes,
    attempts_with_shell: withShell,
    attempts_with_run: withRun,
    attempts_all_refused: withShell - withRun,
    self_computed: selfComputed,
    requests_per_attempt: answered.length ? requests / answered.length : 0,
    exec_ms: {
      n: times.length,
      mean: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0,
      p50: times[Math.floor((times.length - 1) / 2)] ?? 0,
      max: times.at(-1) ?? 0,
    },
    operands,
  }
}
