import type { ShellInfo } from "./run"

/**
 * A shell command that only does arithmetic, by an exact grammar (not a character filter):
 * such a command runs without a prompt in every permission mode, headless and in evals, so
 * the model computes figures with the shell instead of doing mental arithmetic.
 *
 * Two forms, each tied to the shell `run.ts` really starts:
 * - PowerShell (Windows): bare expressions, `;` between several, functions only as
 *   `[math]::Name(…)`. A comma outside a call builds an array in PowerShell (`1,2*3` prints
 *   1 2 1 2 1 2) and `1..3` is a range, so neither is in the grammar.
 * - POSIX shells: `awk 'BEGIN{printf "%.2f\n", e1, e2}'` (printf: `print` keeps only six
 *   significant digits). A bare `1/2` would run a file under bash, `(…)` a subshell.
 * python -c and node -e are left out: `^` is XOR there and Python integers have no bound
 * (`9**9**9**9` never finishes).
 */

export const MATH_MAX_CHARS = 500
export const MATH_MAX_EXPRESSIONS = 20

type Form = "powershell" | "awk"

const FUNCTIONS: Record<Form, Set<string>> = {
  powershell: new Set(["round", "abs", "sqrt", "pow", "log", "log10", "exp", "max", "min", "floor", "ceiling", "truncate"]),
  awk: new Set(["sqrt", "log", "exp", "int"]),
}

const OPERATORS: Record<Form, string> = { powershell: "+-*/%", awk: "+-*/%^" }

type Token = { kind: "num" } | { kind: "op"; op: string } | { kind: "fn" } | { kind: "open" } | { kind: "close" } | { kind: "comma" }

/** Numbers with a decimal point and an exponent of at most 308; nothing else (no hex, no 1kb, no 1d). */
const NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?(\d{1,3}))?/

function tokenize(text: string, form: Form): Token[] | undefined {
  const out: Token[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (c === " " || c === "\t") {
      i++
      continue
    }
    const num = NUMBER.exec(text.slice(i))
    if (num) {
      if (num[1] !== undefined && Number(num[1]) > 308) return undefined
      i += num[0].length
      // `1.2.3`, `1..3`, `2e5x`: a number must end at an operator, a bracket, a comma or a space.
      if (i < text.length && /[\w.]/.test(text[i]!)) return undefined
      out.push({ kind: "num" })
      continue
    }
    if (form === "powershell") {
      const fn = /^\[math\]::([a-z0-9]+)/i.exec(text.slice(i))
      if (fn) {
        if (!FUNCTIONS.powershell.has(fn[1]!.toLowerCase())) return undefined
        i += fn[0].length
        out.push({ kind: "fn" })
        continue
      }
    } else {
      const fn = /^([a-z]+[a-z0-9]*)/.exec(text.slice(i))
      if (fn) {
        if (!FUNCTIONS.awk.has(fn[1]!)) return undefined
        i += fn[0].length
        out.push({ kind: "fn" })
        continue
      }
    }
    // `++` and `--` are increment/decrement in both shells (a parse error on a number): `1 - -2` is fine.
    if ((c === "+" || c === "-") && text[i + 1] === c) return undefined
    if (OPERATORS[form].includes(c)) out.push({ kind: "op", op: c })
    else if (c === "(") out.push({ kind: "open" })
    else if (c === ")") out.push({ kind: "close" })
    else if (c === ",") out.push({ kind: "comma" })
    else return undefined
    i++
  }
  return out
}

/** expr := term (+|- term)*; term := unary (*|/|% unary)*; unary := (+|-) unary | power;
 *  power := primary (^ unary)?; primary := num | ( expr ) | fn ( expr (, expr)* ). */
function parses(tokens: Token[], form: Form): boolean {
  let at = 0
  let depth = 0
  const peek = () => tokens[at]
  const isOp = (ops: string) => {
    const t = peek()
    return t?.kind === "op" && ops.includes(t.op)
  }
  const primary = (): boolean => {
    const t = tokens[at++]
    if (!t) return false
    if (t.kind === "num") return true
    if (t.kind === "open") {
      if (++depth > 32 || !expr()) return false
      depth--
      return tokens[at++]?.kind === "close"
    }
    if (t.kind === "fn") {
      if (tokens[at++]?.kind !== "open" || ++depth > 32 || !expr()) return false
      while (peek()?.kind === "comma") {
        at++
        if (!expr()) return false
      }
      depth--
      return tokens[at++]?.kind === "close"
    }
    return false
  }
  const power = (): boolean => {
    if (!primary()) return false
    if (form === "awk" && isOp("^")) {
      at++
      return unary()
    }
    return true
  }
  const unary = (): boolean => {
    if (isOp("+-")) {
      at++
      return unary()
    }
    return power()
  }
  const term = (): boolean => {
    if (!unary()) return false
    while (isOp("*/%")) {
      at++
      if (!unary()) return false
    }
    return true
  }
  const expr = (): boolean => {
    if (!term()) return false
    while (isOp("+-")) {
      at++
      if (!term()) return false
    }
    return true
  }
  return expr() && at === tokens.length
}

function expression(text: string, form: Form): boolean {
  const tokens = tokenize(text, form)
  return !!tokens && tokens.length > 0 && parses(tokens, form)
}

/** Split on commas that are not inside brackets (the arguments of awk's printf). */
function topLevelCommas(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++
    else if (text[i] === ")") depth--
    else if (text[i] === "," && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** printf format: plain text and number conversions only (`%.2f`, `%d`, `%g`), ending in \n. */
const FORMAT = /^((?:%(?:\.\d{1,2})?[fgde]|%%|[ ,;:|=\-\w])*)\\n$/
const AWK = /^awk\s+'BEGIN\s*\{\s*printf\s+"([^"']*)"\s*,([^'{}]*)\}'$/

function powershellMath(command: string): boolean {
  const parts = command.split(";").map((s) => s.trim())
  if (parts.at(-1) === "") parts.pop()
  return parts.length > 0 && parts.length <= MATH_MAX_EXPRESSIONS && parts.every((p) => expression(p, "powershell"))
}

function awkMath(command: string): boolean {
  const m = AWK.exec(command)
  if (!m) return false
  const format = FORMAT.exec(m[1]!)
  if (!format) return false
  const args = topLevelCommas(m[2]!.trim().replace(/;$/, ""))
  const conversions = (format[1]!.match(/%(?:\.\d{1,2})?[fgde]/g) ?? []).length
  return args.length <= MATH_MAX_EXPRESSIONS && args.length === conversions && args.every((a) => expression(a.trim(), "awk"))
}

/**
 * The command only computes numbers, in the form the shell that will run it understands.
 * Anything else (a variable, a pipe, a file, another function, a second line) is not one.
 */
export function mathOnlyCommand(command: string, shell: Pick<ShellInfo, "kind">): boolean {
  const text = command.trim()
  if (text === "" || text.length > MATH_MAX_CHARS || /[\r\n]/.test(text)) return false
  return shell.kind === "pwsh" || shell.kind === "powershell" ? powershellMath(text) : awkMath(text)
}

/** Only numbers, operators, brackets, commas and a few function names: an expression, whatever its form. */
const LOOKS_NUMERIC = /^[\d\s.,+\-*/%^()]+$/
const NUMERIC_CALL = /^(?:python3?|py)\s+-c\s+["']print\((.*)\)["']$|^node\s+-e\s+["']console\.log\((.*)\)["']$/i
const ECHO_ARITH = /^(?:echo\s+\$\(\((.*)\)\)|expr\s+(.*)|echo\s+["']?(.*?)["']?\s*\|\s*bc(?:\s+-l)?)$/i
const AWK_PRINT = /^awk\s+'BEGIN\s*\{\s*print\s+([^'{}]*)\}'$/

const numeric = (text: string | undefined) => {
  const bare = (text ?? "")
    .replace(/\[math\]::[a-z0-9]+|\bmath\.[a-z0-9]+|\b(?:round|abs|min|max|pow|sqrt|log|exp|int)\b/gi, "")
    .replace(/(\d)e([+-]?\d)/gi, "$1$2")
  return LOOKS_NUMERIC.test(bare) && /\d/.test(bare)
}

/**
 * A command that is clearly an attempt at arithmetic in a form the grammar does not take
 * (`python -c "print(1.2*3)"`, `1,2*3`, `awk 'BEGIN{print 1/3}'`, `echo $((1+2))`). It gets
 * a tool error with the accepted form instead of the approval path: a headless denial tells
 * the model to stop and never rewrite the command, the loop calculate used to fall into.
 */
export function mathNearMiss(command: string, shell: Pick<ShellInfo, "kind">): boolean {
  const text = command.trim()
  if (text === "" || /[\r\n]/.test(text) || mathOnlyCommand(text, shell)) return false
  const call = NUMERIC_CALL.exec(text)
  if (call) return numeric(call[1] ?? call[2]) && !/import|__/.test(text)
  const echo = ECHO_ARITH.exec(text)
  if (echo) return numeric(echo[1] ?? echo[2] ?? echo[3])
  const awk = AWK_PRINT.exec(text)
  if (awk) return numeric(awk[1])
  return /[+\-*/%^]/.test(text) && numeric(text)
}

/** The arithmetic form for this machine's shell, for the tool description. */
export function mathHint(shell: Pick<ShellInfo, "kind">): string {
  return shell.kind === "pwsh" || shell.kind === "powershell"
    ? "Tính số: lệnh chỉ gồm biểu thức số, ví dụ `(128.4/112-1)*100; [math]::Round(31250/4520, 2); [math]::Pow(1.08, 3)` (nhiều phép ngăn bằng ;, hàm chỉ [math]::Round/Abs/Sqrt/Pow/Log/Log10/Exp/Max/Min/Floor/Ceiling/Truncate, không biến, không dấu phẩy ngoài ngoặc hàm) chạy ngay, không cần người dùng duyệt."
    : "Tính số: lệnh dạng `awk 'BEGIN{printf \"%.2f %.2f\\n\", (128.4/112-1)*100, 1.08^3}'` (mỗi biểu thức một %.Nf, hàm chỉ sqrt/log/exp/int, không biến) chạy ngay, không cần người dùng duyệt."
}
