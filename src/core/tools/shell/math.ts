import type { ShellInfo } from "./run"

/**
 * A shell command that only does arithmetic, by an exact grammar (not a character filter):
 * such a command runs without a prompt in every permission mode, headless and in evals, so
 * the model computes figures with the shell instead of doing mental arithmetic.
 *
 * Two forms, each tied to the shell `run.ts` really starts. Both are a list of statements
 * (`;` or a line break between them) over numbers, variables assigned earlier in the same
 * command, brackets and a short list of math functions:
 * - PowerShell (Windows): `$x = expr` and bare expressions (each prints its value), functions
 *   only as `[math]::Name(…)`. A comma outside a call builds an array in PowerShell (`1,2*3`
 *   prints 1 2 1 2 1 2) and `1..3` is a range, so neither is in the grammar.
 * - POSIX shells: `awk 'BEGIN{ x = expr; printf "%.4f\n", x }'`, with `print` and `printf`.
 *   A bare `1/2` would run a file under bash, `(…)` a subshell.
 * python -c and node -e are left out: `^` is XOR there and Python integers have no bound
 * (`9**9**9**9` never finishes).
 *
 * What keeps it arithmetic (each has a test in test/shell-math.test.ts):
 * - No loop and no function definition, so a command ends; no pipe, redirect or file.
 * - awk: the only strings are a printf format and a label in `print`; `<` and `>` compare only
 *   inside brackets (`print a > b` would write a file named by b); a name followed by `(` must
 *   be a listed function; awk's own names (`getline`, `system`, `ENVIRON`…) are not variables.
 * - PowerShell: a variable is `$name` and nothing more (no member, index, scope or call), and
 *   never one of PowerShell's own.
 * - A variable is read only after this command assigned it: a mistyped name would otherwise
 *   compute silently with 0 (awk) or $null (PowerShell).
 */

export const MATH_MAX_CHARS = 8000
/** Statements in a command, and values in one print. */
export const MATH_MAX_STATEMENTS = 60

type Form = "powershell" | "awk"

const FUNCTIONS: Record<Form, Set<string>> = {
  powershell: new Set(["round", "abs", "sqrt", "pow", "log", "log10", "exp", "max", "min", "floor", "ceiling", "truncate"]),
  awk: new Set(["sqrt", "log", "exp", "int"]),
}

/** awk's keywords, builtin functions and variables: never a variable of an arithmetic command. */
const AWK_RESERVED = new Set(
  "BEGIN END BEGINFILE ENDFILE function func if else while for do break continue next nextfile exit return delete in getline print printf system close fflush length substr index split sub gsub gensub match sprintf tolower toupper rand srand strftime systime mktime and or xor compl lshift rshift sin cos atan2 ENVIRON ARGV ARGC ARGIND FS OFS RS ORS NR NF FNR FILENAME SUBSEP RSTART RLENGTH RT CONVFMT OFMT PROCINFO IGNORECASE FIELDWIDTHS FPAT BINMODE ERRNO LINT TEXTDOMAIN SYMTAB FUNCTAB"
    .split(" ")
    .concat([...FUNCTIONS.awk]),
)

/** PowerShell's automatic and preference variables (lower case): reading one leaks state, writing one changes the session. */
const POWERSHELL_RESERVED = new Set(
  "_ args input this true false null host home pwd pid pshome psversiontable psculture psuiculture executioncontext error matches lastexitcode myinvocation psscriptroot pscommandpath psitem psboundparameters pscmdlet foreach switch sender event eventargs eventsubscriber profile shellid stacktrace nestedpromptlevel ofs env iswindows islinux ismacos iscoreclr psedition enabledexperimentalfeatures erroractionpreference progresspreference verbosepreference debugpreference warningpreference informationpreference confirmpreference whatifpreference errorview outputencoding formatenumerationlimit maximumhistorycount psdefaultparametervalues psmoduleautoloadingpreference psnativecommandargumentpassing psnativecommanduseerroractionpreference psemailserver pssessionoption pssessionapplicationname pssessionconfigurationname psstyle logcommandhealthevent logcommandlifecycleevent logengineevent logenginehealthevent logproviderhealthevent logproviderlifecycleevent transcript"
    .split(" "),
)

type Token =
  | { kind: "num" }
  | { kind: "op"; op: string }
  | { kind: "cmp" }
  | { kind: "question" }
  | { kind: "colon" }
  | { kind: "assign"; plain: boolean }
  | { kind: "fn" }
  | { kind: "id"; name: string }
  | { kind: "print" }
  | { kind: "printf" }
  | { kind: "str"; text: string }
  | { kind: "open" }
  | { kind: "close" }
  | { kind: "comma" }
  | { kind: "sep" }

/** Numbers with a decimal point and an exponent of at most 308; nothing else (no hex, no 1kb, no 1d). */
const NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?(\d{1,3}))?/
const NAME = /^[A-Za-z_][A-Za-z0-9_]*/
const OPERATORS: Record<Form, string> = { powershell: "+-*/%", awk: "+-*/%^" }

function tokenize(text: string, form: Form): Token[] | undefined {
  const out: Token[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    const rest = text.slice(i)
    if (c === " " || c === "\t" || c === "\r") {
      i++
      continue
    }
    if (c === "\n" || c === ";") {
      out.push({ kind: "sep" })
      i++
      continue
    }
    // A comment runs to the end of its line in both languages.
    if (c === "#") {
      const end = text.indexOf("\n", i)
      i = end < 0 ? text.length : end
      continue
    }
    const num = NUMBER.exec(rest)
    if (num) {
      if (num[1] !== undefined && Number(num[1]) > 308) return undefined
      i += num[0].length
      // `1.2.3`, `1..3`, `2e5x`: a number must end at an operator, a bracket, a comma or a space.
      if (i < text.length && /[\w.]/.test(text[i]!)) return undefined
      out.push({ kind: "num" })
      continue
    }
    if (form === "powershell") {
      const fn = /^\[math\]::([a-z0-9]+)/i.exec(rest)
      if (fn) {
        if (!FUNCTIONS.powershell.has(fn[1]!.toLowerCase())) return undefined
        i += fn[0].length
        out.push({ kind: "fn" })
        continue
      }
      if (c === "$") {
        const name = NAME.exec(rest.slice(1))
        if (!name || POWERSHELL_RESERVED.has(name[0].toLowerCase())) return undefined
        i += 1 + name[0].length
        // `$x.Member`, `$x[0]`, `$env:PATH`, `$x::Static`, `$f(…)`: a variable and nothing more.
        if (i < text.length && /[.[:(]/.test(text[i]!)) return undefined
        // Names differ only by case in PowerShell.
        out.push({ kind: "id", name: name[0].toLowerCase() })
        continue
      }
    } else {
      const name = NAME.exec(rest)
      if (name) {
        i += name[0].length
        if (name[0] === "print" || name[0] === "printf") {
          out.push({ kind: name[0] })
          continue
        }
        // A name before `(` is a call: only the listed functions.
        if (/^[ \t]*\(/.test(text.slice(i))) {
          if (!FUNCTIONS.awk.has(name[0])) return undefined
          out.push({ kind: "fn" })
          continue
        }
        if (AWK_RESERVED.has(name[0])) return undefined
        out.push({ kind: "id", name: name[0] })
        continue
      }
      if (c === '"') {
        const end = text.indexOf('"', i + 1)
        if (end < 0) return undefined
        out.push({ kind: "str", text: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
      const cmp = /^(?:[<>]=?|==|!=)/.exec(rest)
      if (cmp) {
        out.push({ kind: "cmp" })
        i += cmp[0].length
        continue
      }
      if (c === "?" || c === ":") {
        out.push({ kind: c === "?" ? "question" : "colon" })
        i++
        continue
      }
    }
    // `++` and `--` are increment/decrement in both shells (a parse error on a number): `1 - -2` is fine.
    if ((c === "+" || c === "-") && text[i + 1] === c) return undefined
    if (c === "=" || (OPERATORS[form].includes(c) && text[i + 1] === "=")) {
      out.push({ kind: "assign", plain: c === "=" })
      i += c === "=" ? 1 : 2
      continue
    }
    if (OPERATORS[form].includes(c)) out.push({ kind: "op", op: c })
    else if (c === "(") out.push({ kind: "open" })
    else if (c === ")") out.push({ kind: "close" })
    else if (c === ",") out.push({ kind: "comma" })
    else return undefined
    i++
  }
  return out
}

/** A number conversion of printf: flags, a width and a precision of at most two digits, no `*`, no `%s`. */
const CONVERSION = /%[-+ 0]*\d{0,2}(?:\.\d{1,2})?[fgdeEG]/g
/** A printf format: conversions, `%%`, `\n`, `\t` and plain text. */
const FORMAT = /^(?:%[-+ 0]*\d{0,2}(?:\.\d{1,2})?[fgdeEG]|%%|\\[nt]|[^%\\"'\r\n])*$/
/** A label in `print`: plain text. */
const LABEL = /^(?:\\[nt]|[^\\"'\r\n])*$/

/**
 * program := stmt ((; | newline)+ stmt)*
 * stmt    := name (= | += …) expr | print item (, item)* | printf format (, expr)* | expr   (PowerShell only)
 * expr    := sum [cmp sum] [? expr : expr]        (the two optional parts only inside brackets, awk only)
 * sum     := term ((+|-) term)*;  term := unary ((*|/|%) unary)*;  unary := (+|-) unary | power
 * power   := primary [^ unary]                    (awk only)
 * primary := number | name | ( expr ) | fn ( expr (, expr)* )
 */
function parses(tokens: Token[], form: Form): boolean {
  let at = 0
  let depth = 0
  const assigned = new Set<string>()
  const peek = () => tokens[at]
  const isOp = (ops: string) => {
    const t = peek()
    return t?.kind === "op" && ops.includes(t.op)
  }
  const primary = (): boolean => {
    const t = tokens[at++]
    if (!t) return false
    if (t.kind === "num") return true
    if (t.kind === "id") return assigned.has(t.name)
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
  const sum = (): boolean => {
    if (!term()) return false
    while (isOp("+-")) {
      at++
      if (!term()) return false
    }
    return true
  }
  const expr = (): boolean => {
    if (!sum()) return false
    // Outside brackets `>` after print is a redirect to a file: a comparison needs brackets.
    if (depth === 0) return true
    if (peek()?.kind === "cmp") {
      at++
      if (!sum()) return false
    }
    if (peek()?.kind === "question") {
      at++
      if (!expr() || tokens[at++]?.kind !== "colon") return false
      return expr()
    }
    return true
  }
  const ends = () => peek() === undefined || peek()!.kind === "sep"
  /** `item (, item)*` up to `stop`; returns how many, or -1. */
  const items = (item: () => boolean, stop: () => boolean): number => {
    let n = 0
    for (;;) {
      if (!item() || ++n > MATH_MAX_STATEMENTS) return -1
      if (stop()) return n
      if (tokens[at++]?.kind !== "comma") return -1
    }
  }
  const printItem = () => {
    const t = peek()
    if (t?.kind === "str") {
      at++
      return LABEL.test(t.text)
    }
    return expr()
  }
  /** `print a, b` or `print(a, b)`: the bracketed list is tried when the plain one does not parse. */
  const print = (): boolean => {
    const start = at
    if (items(printItem, ends) > 0) return true
    at = start
    depth = 0
    if (tokens[at++]?.kind !== "open") return false
    if (items(printItem, () => peek()?.kind === "close") < 0) return false
    at++
    return ends()
  }
  /** `printf "fmt", a, b` or `printf("fmt", a, b)`: as many values as the format has conversions. */
  const printf = (): boolean => {
    const bracket = peek()?.kind === "open"
    if (bracket) at++
    const format = tokens[at++]
    if (format?.kind !== "str" || !FORMAT.test(format.text)) return false
    const conversions = (format.text.replace(/%%/g, "").match(CONVERSION) ?? []).length
    const done = () => (bracket ? peek()?.kind === "close" : ends())
    let values = 0
    if (!done()) {
      if (tokens[at++]?.kind !== "comma") return false
      values = items(expr, done)
      if (values < 0) return false
    }
    if (bracket) at++
    return values === conversions && ends()
  }
  const statement = (): boolean => {
    const t = peek()
    if (t?.kind === "print" || t?.kind === "printf") {
      at++
      return t.kind === "print" ? print() : printf()
    }
    const next = tokens[at + 1]
    if (t?.kind === "id" && next?.kind === "assign") {
      // `x += 1` reads x first.
      if (!next.plain && !assigned.has(t.name)) return false
      at += 2
      if (!expr()) return false
      assigned.add(t.name)
      return true
    }
    // A bare expression prints its value in PowerShell; in awk it does nothing.
    return form === "powershell" && expr()
  }
  let statements = 0
  for (;;) {
    while (peek()?.kind === "sep") at++
    if (peek() === undefined) return statements > 0
    if (++statements > MATH_MAX_STATEMENTS || !statement() || !ends()) return false
  }
}

function program(text: string, form: Form): boolean {
  const tokens = tokenize(text, form)
  return !!tokens && parses(tokens, form)
}

/** One program in single quotes and nothing else: no option, no input file, no second block. */
const AWK = /^awk[ \t]+'BEGIN\s*\{([^'{}]*)\}'$/

/**
 * The command only computes numbers, in the form the shell that will run it understands.
 * Anything else (a pipe, a file, another function, a loop, a variable never assigned) is not one.
 */
export function mathOnlyCommand(command: string, shell: Pick<ShellInfo, "kind">): boolean {
  const text = command.trim()
  if (text === "" || text.length > MATH_MAX_CHARS) return false
  if (shell.kind === "pwsh" || shell.kind === "powershell") return program(text, "powershell")
  const awk = AWK.exec(text)
  return !!awk && program(awk[1]!, "awk")
}

/** How awk prints a number that is not an integer under `print`: the default keeps six digits. */
export const AWK_NUMBER_FORMAT = "%.15g"

/**
 * The awk command as it is run: `print` keeps a value's digits (awk's default OFMT is `%.6g`,
 * so `print 2.5e12/3` showed 8.33333e+11). Only for a command mathOnlyCommand accepted.
 */
export function awkWithPrecision(command: string): string {
  return command.trim().replace(/^awk[ \t]+/, `awk -v OFMT=${AWK_NUMBER_FORMAT} -v CONVFMT=${AWK_NUMBER_FORMAT} `)
}

/** Only numbers, operators, brackets, commas and a few function names: an expression, whatever its form. */
const LOOKS_NUMERIC = /^[\d\s.,+\-*/%^()]+$/
const NUMERIC_CALL = /^(?:python3?|py)\s+-c\s+["']print\((.*)\)["']$|^node\s+-e\s+["']console\.log\((.*)\)["']$/i
const ECHO_ARITH = /^(?:echo\s+\$\(\((.*)\)\)|expr\s+(.*)|echo\s+["']?(.*?)["']?\s*\|\s*bc(?:\s+-l)?)$/i

const numeric = (text: string | undefined) => {
  const bare = (text ?? "")
    .replace(/\[math\]::[a-z0-9]+|\bmath\.[a-z0-9]+|\b(?:round|abs|min|max|pow|sqrt|log|exp|int)\b/gi, "")
    .replace(/(\d)e([+-]?\d)/gi, "$1$2")
  return LOOKS_NUMERIC.test(bare) && /\d/.test(bare)
}

/**
 * A command that is clearly an attempt at arithmetic in a form the grammar does not take
 * (`python -c "print(1.2*3)"`, `1,2*3`, `echo $((1+2))`). It gets a tool error with the accepted
 * form instead of the approval path: a headless denial tells the model to stop and never
 * rewrite the command, the loop calculate used to fall into.
 */
export function mathNearMiss(command: string, shell: Pick<ShellInfo, "kind">): boolean {
  const text = command.trim()
  if (text === "" || /[\r\n]/.test(text) || mathOnlyCommand(text, shell)) return false
  const call = NUMERIC_CALL.exec(text)
  if (call) return numeric(call[1] ?? call[2]) && !/import|__/.test(text)
  const echo = ECHO_ARITH.exec(text)
  if (echo) return numeric(echo[1] ?? echo[2] ?? echo[3])
  return /[+\-*/%^]/.test(text) && numeric(text)
}

/** The arithmetic form for this machine's shell, for the tool description. */
export function mathHint(shell: Pick<ShellInfo, "kind">): string {
  return shell.kind === "pwsh" || shell.kind === "powershell"
    ? "Tính số: lệnh chỉ gồm phép tính, ví dụ `$g = 128.4/112 - 1; $g*100; [math]::Pow(1 + $g, 3)` (mỗi câu lệnh cách nhau bằng ; hoặc xuống dòng; biến $ten phải gán trước khi dùng; biểu thức trần in ra giá trị; hàm chỉ [math]::Round/Abs/Sqrt/Pow/Log/Log10/Exp/Max/Min/Floor/Ceiling/Truncate; không mảng, không vòng lặp: chuỗi số thì viết thẳng (a+b+c)/3) chạy ngay, không cần người dùng duyệt. Giữ đủ chữ số ở bước trung gian, chỉ làm tròn ở kết quả cuối."
    : "Tính số: lệnh dạng `awk 'BEGIN{ g = 128.4/112 - 1; printf \"%.10g %.10g\\n\", g*100, (1+g)^3 }'` (mỗi câu lệnh cách nhau bằng ; hoặc xuống dòng; biến phải gán trước khi dùng; in bằng print hoặc printf; hàm chỉ sqrt/log/exp/int; so sánh và ?: đặt trong ngoặc; không mảng, split hay vòng lặp: chuỗi số thì viết thẳng (a+b+c)/3) chạy ngay, không cần người dùng duyệt. Giữ đủ chữ số ở bước trung gian, chỉ làm tròn ở kết quả cuối."
}
