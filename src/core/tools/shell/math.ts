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
 *   prints 1 2 1 2 1 2) and `1..3` is a range, so neither is in the grammar. A bare expression may
 *   start with a label (issue #268: 12 of 21 commands that did not run were only that):
 *   `"g = $g"`, `"g = " + ($g*100) + " %"`, `"g={0:N2}" -f $g`.
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
 * - PowerShell strings: only a label, only first in a bare expression. Its text is a short list of
 *   characters, so no backtick, no `$(`, `${` or `$env:`, and none of the Unicode quotes PowerShell
 *   also ends a string at. A label is an operand of `+` and `-f` alone, never of `*` (`"a" * 1e9`
 *   repeats it), and never a value: not in a variable, in brackets or in a call.
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
  "_ args input this true false null host home pwd pid pshome psversiontable psculture psuiculture executioncontext error matches lastexitcode myinvocation psscriptroot pscommandpath psitem psboundparameters pscmdlet foreach switch sender event eventargs eventsubscriber profile shellid stacktrace nestedpromptlevel ofs env iswindows islinux ismacos iscoreclr psedition enabledexperimentalfeatures erroractionpreference progresspreference verbosepreference debugpreference warningpreference informationpreference confirmpreference whatifpreference errorview outputencoding formatenumerationlimit maximumhistorycount psdefaultparametervalues psmoduleautoloadingpreference psnativecommandargumentpassing psnativecommanduseerroractionpreference maximumaliascount maximumdrivecount maximumerrorcount maximumfunctioncount maximumvariablecount psemailserver pssessionoption pssessionapplicationname pssessionconfigurationname psstyle logcommandhealthevent logcommandlifecycleevent logengineevent logenginehealthevent logproviderhealthevent logproviderlifecycleevent transcript"
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
  | { kind: "format" }
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
    // A comment runs to the end of its line in both languages. Only where a token may start:
    // glued to one (`1#x`), PowerShell reads a single word, which it would run as a command.
    if (c === "#") {
      if (i > 0 && !/[\s;]/.test(text[i - 1]!)) return undefined
      const end = text.indexOf("\n", i)
      i = end < 0 ? text.length : end
      continue
    }
    const num = NUMBER.exec(rest)
    if (num) {
      if (num[1] !== undefined && Number(num[1]) > 308) return undefined
      // Past a double, a literal is a parse error in PowerShell.
      if (form === "powershell" && !Number.isFinite(Number(num[0]))) return undefined
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
        // `[math]::Round (1)` is a parse error.
        if (text[i] !== "(") return undefined
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
      // A label. A quote glued to a number or a word is one word to PowerShell, which runs it as a
      // command (`5"a"` runs `5a`); after one, `.x`, `[0]` or another quote carries the string on.
      if (c === '"') {
        const end = text.indexOf('"', i + 1)
        if (end < 0 || (i > 0 && !/[\s;+]/.test(text[i - 1]!))) return undefined
        out.push({ kind: "str", text: text.slice(i + 1, end) })
        i = end + 1
        if (i < text.length && !/[\s;+-]/.test(text[i]!)) return undefined
        continue
      }
      if (/^-f[ \t($]/i.test(rest)) {
        out.push({ kind: "format" })
        i += 2
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
/** A printf format: conversions, `%%`, `\n`, `\t` and plain text (no control character: the output reaches a terminal). */
const FORMAT = /^(?:%[-+ 0]*\d{0,2}(?:\.\d{1,2})?[fgdeEG]|%%|\\[nt]|[^%\\"'\x00-\x1f\x7f])*$/
/** A label in `print`: plain text. */
const LABEL = /^(?:\\[nt]|[^\\"'\x00-\x1f\x7f])*$/

/**
 * What a PowerShell label may hold as it is: part of ASCII, Latin letters with their marks, a few
 * signs. Not here: quotes of any kind (PowerShell ends a string at U+201C–U+201E too), `$`, a
 * backtick, a line end, control, invisible and direction-changing characters, and brackets and
 * braces (`"[math]::Round($x,3)"` and `"{0:N2}"` without -f would print themselves).
 */
const LABEL_TEXT = "[ %()*+,\\-./0-9:;=?A-Z^_a-z\\u00c0-\\u024f\\u0300-\\u036f\\u1e00-\\u1eff\\u20ab\\u00b0\\u00b1\\u00d7\\u00f7\\u2248]"
/**
 * `$name` in a label, up to a character PowerShell ends a name at: `$x:` is a drive, `$x?` and
 * `$ròng` are other variables. `.` only at the end of a sentence (`$x.Length` meant a member).
 */
const LABEL_VARIABLE = "\\$([A-Za-z_][A-Za-z0-9_]*)(?=$|[ %),\\-/;=*+^]|\\.(?:$| ))"
const PS_LABEL = new RegExp(`^(?:${LABEL_TEXT}|${LABEL_VARIABLE})*$`)
const PS_LABEL_NAMES = new RegExp(LABEL_VARIABLE, "g")
/** A -f format: plain text (no `$`) and `{0}`…`{9}` with a standard format; no alignment (`{0,999999999}` pads that far). */
const PS_FORMAT = new RegExp(`^(?:${LABEL_TEXT}|\\{\\d(?::[FNPEGfnpeg]\\d{0,2})?\\})*$`)

/**
 * program := stmt ((; | newline)+ stmt)*
 * stmt    := name (= | += …) expr | print item (, item)* | printf format (, expr)*
 *          | expr | label ((+ label) | (+ term))* | label -f primary (, primary)*            (PowerShell only)
 *            (no two terms in a row: after a label `+ $a + $b` joins digits, it does not add)
 * expr    := sum [cmp sum] [? expr : expr]        (the two optional parts only inside brackets, awk only)
 * sum     := term ((+|-) term)*;  term := unary ((*|/|%) unary)*;  unary := (+|-) unary | power
 * power   := primary [^ unary]                    (awk only)
 * primary := number | name | ( expr ) | fn ( expr (, expr)* )
 */
function parses(tokens: Token[], form: Form, why: (miss: ComputeMiss) => void = () => {}): boolean {
  // A text alone computes nothing, and would put any figure in the output unchecked.
  if (form === "powershell" && !tokens.some((t) => t.kind === "num")) return false
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
    if (t.kind === "id") {
      if (assigned.has(t.name)) return true
      why("unassigned")
      return false
    }
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
  /** A label's text, with the variables in it assigned. */
  const label = (text: string): boolean => {
    if (!PS_LABEL.test(text)) return false
    const names = [...text.matchAll(PS_LABEL_NAMES)].map((m) => m[1]!.toLowerCase())
    if (names.every((name) => assigned.has(name))) return true
    why("unassigned")
    return false
  }
  /** PowerShell `"text $x"`, `"text " + 1 + " text"`, `"{0:N2}" -f $x`: the statement's end included. */
  const labelled = (): boolean => {
    const first = tokens[at++]
    if (first?.kind !== "str") return false
    if (peek()?.kind === "format") {
      at++
      if (!PS_FORMAT.test(first.text)) return false
      const used = new Set([...first.text.matchAll(/\{(\d)/g)].map((m) => Number(m[1])))
      // -f binds tighter than every other operator here, so its values are primaries:
      // `"{0}" -f 5 * 3` repeats the text three times. Each value is printed, and no other is asked for.
      const values = items(primary, ends)
      return values > 0 && used.size === values && Math.max(...used) === values - 1
    }
    if (!label(first.text)) return false
    let number = false
    while (isOp("+")) {
      at++
      const t = peek()
      if (t?.kind === "str") {
        at++
        if (!label(t.text)) return false
        number = false
      } else {
        // `"Tong = " + $a + $b` prints the digits of both, one after the other.
        if (number) why("joined")
        if (number || !term()) return false
        number = true
      }
    }
    return ends()
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
    if (form !== "powershell") return false
    return t?.kind === "str" ? labelled() : expr()
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

/**
 * A line may end in LF or CRLF only. PowerShell also ends a statement, and a comment, at a lone
 * CR (tried on 5.1: `1<CR>2` prints 1 and 2), where this grammar would read on to the next LF:
 * `1 # note<CR>Remove-Item x` would hide a command in what we take for a comment. The same goes
 * for any other character a shell might read as a line end, and for control characters.
 */
const ODD_LINE_END = /\r(?!\n)|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u0085\u2028\u2029]/

/** One program in single quotes and nothing else: no option, no input file, no second block. */
const AWK = /^awk[ \t]+'BEGIN\s*\{([^'{}]*)\}'$/

/**
 * The command only computes numbers, in the form the shell that will run it understands.
 * Anything else (a pipe, a file, another function, a loop, a variable never assigned) is not one.
 */
export function mathOnlyCommand(command: string, shell: Pick<ShellInfo, "kind">): boolean {
  const text = command.trim()
  if (text === "" || text.length > MATH_MAX_CHARS || ODD_LINE_END.test(command)) return false
  // trim() also drops a byte order mark and Unicode spaces, but the command runs as it was written:
  // PowerShell reads `<BOM>3/2` as one word and runs the file of that path.
  const at = command.indexOf(text)
  if (/[^ \t\r\n]/.test(command.slice(0, at) + command.slice(at + text.length))) return false
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
  return spacedOperators(command.trim()).replace(/^awk[ \t]+/, `awk -v OFMT=${AWK_NUMBER_FORMAT} -v CONVFMT=${AWK_NUMBER_FORMAT} `)
}

/**
 * The awk program with a space around each binary + and - that follows a number or `)`. The awk
 * of macOS (onetrue awk) reads a run like `12000000+12000001+…` as one number token and dies past
 * about 108 characters ("pushed back too much"), while the same sum with spaces runs (measured
 * with original-awk, #372). The spaces change nothing for awk. Strings (the printf format, a label)
 * are left as they are, and so is an exponent's sign (`1e+5`: the sign follows a letter).
 */
export function spacedOperators(command: string): string {
  const open = command.indexOf("'")
  const close = command.lastIndexOf("'")
  if (open < 0 || close <= open) return command
  const program = command
    .slice(open + 1, close)
    .split(/("[^"]*")/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/([0-9.)])\s*([+-])\s*/g, "$1 $2 ")))
    .join("")
  return command.slice(0, open + 1) + program + command.slice(close)
}

/** Only numbers, operators, brackets, commas and a few function names: an expression, whatever its form. */
const LOOKS_NUMERIC = /^[\d\s.,+\-*/%^()]+$/
const ECHO_ARITH = /^(?:echo\s+\$\(\((.*)\)\)|expr\s+(.*)|echo\s+["']?(.*?)["']?\s*\|\s*bc(?:\s+-l)?)$/i

const numeric = (text: string | undefined) => {
  const bare = (text ?? "")
    .replace(/\[math\]::[a-z0-9]+|\bmath\.[a-z0-9]+|\b(?:round|abs|min|max|pow|sqrt|log|exp|int)\b/gi, "")
    .replace(/(\d)e([+-]?\d)/gi, "$1$2")
  return LOOKS_NUMERIC.test(bare) && /\d/.test(bare)
}

/**
 * Why a command that computes numbers is not in the grammar:
 * - "series": it walks a list of numbers with an array or a loop (`split` + `for`, `@(…)` +
 *   `foreach`, `Measure-Object`). Seen 14/11 with gemini-3.1-flash-lite: 6 of 24 commands.
 * - "interpreter": python or node (issue #268: 17 of 51 denied commands).
 * - "form": arithmetic the shell would run, written another way (`1,2*3`, `echo $((1+2))`).
 * PowerShell only, in the order they are looked for:
 * - "brackets": an opening bracket without its closing one (`[math]::Max($a,$b]`).
 * - "write": Write-Output or Write-Host around the value.
 * - "subexpression": `$(…)` in a string.
 * - "joined": two numbers in a row after a label. "unassigned": a variable read before it has a value.
 * - "label": a string the grammar does not take in another way (its text, its format, its place).
 */
export type ComputeMiss = "series" | "interpreter" | "form" | "brackets" | "write" | "subexpression" | "joined" | "unassigned" | "label"

/** A python or node one-liner or heredoc script; the code is group 1 of whichever matched. */
const PYTHON_FORMS = [
  /^(?:python3?|py)\s+-c\s+"([^"]*)"$/i,
  /^(?:python3?|py)\s+-c\s+'([^']*)'$/i,
  /^(?:python3?|py)\s+(?:-\s+)?<<-?\s*['"]?(\w+)['"]?\r?\n([\s\S]*?)\r?\n\1$/i,
  /^cat\s*>\s*(\S+\.py)\s*<<-?\s*['"]?(\w+)['"]?\r?\n([\s\S]*?)\r?\n\2\s*(?:\r?\n|;|&&)\s*(?:python3?|py)\s+\1$/i,
]
const NODE_FORMS = [/^node\s+-e\s+"([^"]*)"$/i, /^node\s+-e\s+'([^']*)'$/i]
/** Anything but printing numbers: another module, files, the system, code built at run time. */
const PYTHON_OTHER = /\b(?:import|from)\s+(?!math\b|statistics\b)|\bopen\s*\(|__|\b(?:os|sys|subprocess|socket|shutil|pathlib|requests|urllib|exec|eval|compile|input|globals|locals|getattr|setattr|with)\b/
const NODE_OTHER = /\b(?:require|import|process|child_process|fetch|eval|Function|globalThis|Bun|Deno)\b|\bfs\b/
/** awk beyond printing numbers: a program, a file, a pipe. */
const AWK_OTHER = /\b(?:system|getline|close|fflush|ENVIRON|ARGV|PROCINFO)\b|(?:^|[^|])\|(?:[^|]|$)|>>/
const AWK_PROGRAM = /^awk[ \t]+(?:-v[ \t]+\w+=[\w.+-]+[ \t]+)*'\s*BEGIN\s*\{([^']*)\}\s*'$/
/** An array or a loop in awk. */
const SERIES = /\bfor(?:each)?\s*\(|\bwhile\s*\(|\bsplit\s*\(|\[\s*[\w$-]/i

/** `>` outside brackets on a print line is a redirect to a file, not a comparison. */
function awkRedirects(body: string): boolean {
  return body.split(/[;\n{}]/).some((statement) => {
    if (!/^\s*printf?\b/.test(statement)) return false
    let flat = statement.replace(/"[^"]*"/g, '""')
    for (let last = ""; last !== flat; ) {
      last = flat
      flat = flat.replace(/\([^()]*\)/g, "")
    }
    return flat.includes(">")
  })
}

/**
 * What a PowerShell script may hold and still be nothing but arithmetic on numbers: when every
 * piece below is taken out, nothing is left. Only ever used to answer with the accepted form.
 */
const POWERSHELL_PIECES = [
  // A list of numbers built with .NET (seen 15/11: `New-Object System.Collections.Generic.List[double]`,
  // then `.Add($r)`). Only these two types: New-Object of anything else may do anything.
  /\bNew-Object\s+(?:System\.Collections\.Generic\.List(?=\[)|System\.Collections\.ArrayList\b)/gi,
  /\[math\]::[a-z0-9]+/gi,
  /\[array\]::IndexOf\b/gi,
  /\[(?:double|single|float|decimal|int|int32|int64|long)(?:\[\])?\]/gi,
  /\$(?:_|[a-z_]\w*)(?![\w:])/gi,
  /\.(?:Count|Length|Sum|Average|Maximum|Minimum|ToString|Add)\b/gi,
  /\b(?:Measure-Object|ForEach-Object|Write-Output|Write-Host)\b/gi,
  /-(?:Sum|Average|Maximum|Minimum|lt|le|gt|ge|eq|ne|and|or|not|f)(?![a-z_])/gi,
  /\b(?:foreach|for|in|if|else|elseif|while)\b/gi,
  /\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi,
  /[\s+\-*/%=<>!()[\]{}@,;|.]/g,
]

/** A string that is only a label or a format: text and `$name`, no drive (`$env:X`), no `${…}`, no backtick. A name is read whole, so there is nothing to backtrack into. */
const PS_TEXT = /^(?:[\p{L}\p{M}\p{N}\s{}[\]:.,;%#=()\-+/*^?!|<>_~×÷±≈₫°]|\$[A-Za-z_]\w*(?!\w|:[\w\\]))*$/u

/**
 * A PowerShell script with its comments and strings taken out (`""` is left of a string, or the code of
 * its `$(…)`); undefined when a string holds anything but a label, a format or such code.
 */
function powershellCode(text: string): { code: string; strings: boolean; subexpressions: boolean } | undefined {
  let ok = true
  let strings = false
  let subexpressions = false
  const code = text.replace(/"[^"\r\n]*"|'[^'\r\n]*'|#[^\n]*/g, (part) => {
    if (part[0] === "#") return " "
    strings = true
    let inner = ""
    let rest = part.slice(1, -1)
    for (let start = part[0] === '"' ? rest.indexOf("$(") : -1; start >= 0; start = rest.indexOf("$(")) {
      let depth = 1
      let end = start + 2
      while (end < rest.length && depth > 0) {
        if (rest[end] === "(") depth++
        else if (rest[end] === ")") depth--
        end++
      }
      if (depth > 0) {
        ok = false
        break
      }
      subexpressions = true
      inner += `(${rest.slice(start + 2, end - 1)})`
      rest = `${rest.slice(0, start)} ${rest.slice(end)}`
    }
    if (!PS_TEXT.test(rest)) ok = false
    return ` ""${inner} `
  })
  return ok ? { code, strings, subexpressions } : undefined
}

function bracketsMatch(code: string): boolean {
  const open: string[] = []
  for (const c of code) {
    if ("([{".includes(c)) open.push(c)
    else if (")]}".includes(c) && open.pop() !== "([{"[")]}".indexOf(c)]) return false
  }
  return open.length === 0
}

/** An array or a loop in PowerShell code (strings taken out). A `[` starts an index only after a variable or a bracket: `[math]` is no array. */
const PS_SERIES = /\bfor(?:each)?\s*\(|\bwhile\s*\(|@\(|(?:\$\w+|[)\]])\[|\[\w+\[\]\]|=\s*-?[\d.]+\s*,|Measure-Object|ForEach-Object|New-Object/i

/** Why a PowerShell command that computes numbers misses the grammar; undefined when it may do anything else. */
function powershellMiss(text: string): ComputeMiss | undefined {
  const script = powershellCode(text)
  if (!script) return undefined
  const { code, strings, subexpressions } = script
  let left = code.replace(/""/g, " ")
  for (const piece of POWERSHELL_PIECES) left = left.replace(piece, " ")
  if (left.trim() !== "" || !/\d/.test(code) || !/[+\-*/%]|\[math\]/i.test(code)) return undefined
  if (!bracketsMatch(code)) return "brackets"
  if (PS_SERIES.test(code)) return "series"
  if (/\bWrite-(?:Output|Host)\b/i.test(code)) return "write"
  if (subexpressions) return "subexpression"
  let miss: ComputeMiss | undefined
  const tokens = tokenize(text, "powershell")
  if (tokens) parses(tokens, "powershell", (why) => (miss ??= why))
  return miss ?? (strings ? "label" : "form")
}

/**
 * A command that is clearly an attempt at arithmetic in a form the grammar does not take
 * (`python -c "print(1.2*3)"`, `1,2*3`, awk with `split` and a loop, a PowerShell array). It
 * gets a tool error with the accepted form instead of the approval path: a headless denial
 * tells the model to stop and never rewrite the command, and it then computes in its head
 * (issue #268; 14/11 run R0: 5 of 7 such answers were wrong).
 *
 * This never lets a command run. A wrong "yes" only costs the user one approval prompt they
 * might have wanted, so the checks err towards saying no when a command does more than print
 * numbers (another module, a file, a pipe, the environment).
 */
export function computeIntent(command: string, shell: Pick<ShellInfo, "kind">): ComputeMiss | undefined {
  const text = command.trim()
  if (text === "" || text.length > 4 * MATH_MAX_CHARS || mathOnlyCommand(text, shell)) return undefined
  for (const form of PYTHON_FORMS) {
    const code = form.exec(text)?.at(-1)
    if (code !== undefined) return /\bprint\s*\(/.test(code) && /\d/.test(code) && !PYTHON_OTHER.test(code) ? "interpreter" : undefined
  }
  for (const form of NODE_FORMS) {
    const code = form.exec(text)?.[1]
    if (code !== undefined) return /console\.log\s*\(/.test(code) && /\d/.test(code) && !NODE_OTHER.test(code) ? "interpreter" : undefined
  }
  const awk = AWK_PROGRAM.exec(text)
  if (awk) {
    const body = awk[1]!
    if (AWK_OTHER.test(body.replace(/"[^"]*"/g, '""')) || awkRedirects(body) || !/\bprintf?\b/.test(body)) return undefined
    return SERIES.test(body) ? "series" : "form"
  }
  if (!/[\r\n]/.test(text)) {
    const echo = ECHO_ARITH.exec(text)
    if (echo) return numeric(echo[1] ?? echo[2] ?? echo[3]) ? "form" : undefined
    if (/[+\-*/%^]/.test(text) && numeric(text)) return "form"
  }
  return shell.kind === "pwsh" || shell.kind === "powershell" ? powershellMiss(text) : undefined
}

/** The command is arithmetic in a form the grammar does not take (see computeIntent). */
export const mathNearMiss = (command: string, shell: Pick<ShellInfo, "kind">): boolean => computeIntent(command, shell) !== undefined

/** What to tell the model about its command, before the accepted form (mathHint). */
export function rewriteAdvice(miss: ComputeMiss, shell: Pick<ShellInfo, "kind">): string {
  const ps = shell.kind === "pwsh" || shell.kind === "powershell"
  if (miss === "series") return "The command uses arrays or loops. Write each number of the series into the expression (an average is (a+b+c)/3) and assign each intermediate step to a variable."
  if (miss === "interpreter") return `The command uses Python or Node. Rewrite that calculation as ${ps ? "a PowerShell expression" : "awk"} in the form below.`
  if (miss === "brackets") return "The brackets do not match: a ( or [ is closed by another bracket or not at all."
  if (miss === "write") return "The command uses Write-Output or Write-Host. Drop it: an expression on its own prints its value."
  if (miss === "subexpression") return 'The command has $(…) in a string. Assign the value to a variable first, or write "label " + (expression).'
  if (miss === "joined") return 'After a label, + $a + $b joins the digits of both numbers instead of adding them. Put the sum in brackets: "label " + ($a + $b).'
  if (miss === "unassigned") return "The command reads a variable before any statement assigned it."
  if (miss === "label") return 'A string is taken only as a label, first in a statement that prints: "g = $g", "g % = " + ($g*100), "g={0:N2}" -f $g (formats N, F, P, E, G). Double quotes; no string in a variable, in brackets or in a call; in the text no quotes, backticks, [ ] or other symbols, and no : right after a $name.'
  return ""
}

/** The arithmetic form for this machine's shell, for the tool description. */
export function mathHint(shell: Pick<ShellInfo, "kind">): string {
  return shell.kind === "pwsh" || shell.kind === "powershell"
    ? "Numbers: a command made only of arithmetic, e.g. `$g = 128.4/112 - 1; \"g = $g\"; \"g % = \" + ($g*100); [math]::Pow(1 + $g, 3)` (statements separated by ; or newlines; a $name must be assigned before use; a bare expression prints its value, with a label as shown or as \"g={0:N2}\" -f $g, no $(…) in it; functions only [math]::Round/Abs/Sqrt/Pow/Log/Log10/Exp/Max/Min/Floor/Ceiling/Truncate; no arrays, no loops: write a series out, (a+b+c)/3) runs at once, with no approval from the user. Keep all digits in intermediate steps; round only the final result."
    : "Numbers: a command of the form `awk 'BEGIN{ g = 128.4/112 - 1; printf \"%.15g %.15g\\n\", g*100, (1+g)^3 }'` (statements separated by ; or newlines; variables must be assigned before use; print with print or printf; functions only sqrt/log/exp/int; put comparisons and ?: in parentheses; no arrays, split or loops: write a series out, (a+b+c)/3) runs at once, with no approval from the user. Keep all digits in intermediate steps; round only the final result."
}
