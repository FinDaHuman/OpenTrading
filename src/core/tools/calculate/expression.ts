import { describeDims, divDims, type Dims, mulDims, powDims, sameDims } from "./units"

/**
 * A small arithmetic language for `calculate`, parsed by hand: no `eval`, no code. Numbers,
 * named values, + - * / ^ (right-associative), unary minus, parentheses and a few functions.
 * Every value carries its dimensions, so a sum of a price and a volume fails instead of
 * returning a number.
 */

export interface Quantity {
  value: number
  dims: Dims
}

type Token = { kind: "num"; value: number } | { kind: "name"; name: string } | { kind: "op"; op: string }

export class CalcError extends Error {}

function tokenize(text: string): Token[] {
  const out: Token[] = []
  let i = 0
  /** Inside a function's brackets a comma separates arguments; outside, "1,5" is a typed number. */
  let depth = 0
  while (i < text.length) {
    const c = text[i]!
    if (/\s/.test(c)) {
      i++
      continue
    }
    // 1.5, .5, 2e9 — a decimal point only; "1,5" is a thousands-or-decimal guess we refuse.
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(i))
    if (num) {
      if (depth === 0 && text[i + num[0].length] === "," && /\d/.test(text[i + num[0].length + 1] ?? "")) throw new CalcError(`Số "${num[0]},…": dùng dấu chấm cho phần thập phân và không dùng dấu phân cách hàng nghìn.`)
      out.push({ kind: "num", value: Number(num[0]) })
      i += num[0].length
      continue
    }
    const name = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(text.slice(i))
    if (name) {
      out.push({ kind: "name", name: name[0] })
      i += name[0].length
      continue
    }
    if ("+-*/^(),".includes(c)) {
      if (c === "(") depth++
      if (c === ")") depth--
      out.push({ kind: "op", op: c })
      i++
      continue
    }
    if (c === "%") throw new CalcError(`Không dùng "%" trong biểu thức: viết /100, hoặc khai giá trị với unit "%".`)
    throw new CalcError(`Ký tự không hợp lệ "${c}" ở vị trí ${i + 1}.`)
  }
  return out
}

const plain = (q: Quantity, what: string) => {
  if (Object.keys(q.dims).length > 0) throw new CalcError(`${what} cần số không đơn vị, nhận ${describeDims(q.dims)}.`)
  return q.value
}

const finite = (value: number, what: string) => {
  if (!Number.isFinite(value)) throw new CalcError(`${what} cho kết quả không xác định (chia cho 0, hoặc ngoài miền).`)
  return value
}

type Fn = (args: Quantity[]) => Quantity

const one = (name: string, f: (x: number) => number): Fn => (args) => {
  if (args.length !== 1) throw new CalcError(`${name}() nhận đúng 1 đối số.`)
  return { value: finite(f(plain(args[0]!, `${name}()`)), `${name}()`), dims: {} }
}

const sameAll = (name: string, args: Quantity[]) => {
  if (args.length === 0) throw new CalcError(`${name}() cần ít nhất 1 đối số.`)
  for (const a of args) if (!sameDims(a.dims, args[0]!.dims)) throw new CalcError(`${name}() nhận các giá trị khác đơn vị: ${describeDims(args[0]!.dims) || "số"} và ${describeDims(a.dims) || "số"}.`)
  return args[0]!.dims
}

const FUNCTIONS: Record<string, Fn> = {
  sqrt: (args) => {
    if (args.length !== 1) throw new CalcError("sqrt() nhận đúng 1 đối số.")
    const x = args[0]!
    if (x.value < 0) throw new CalcError("sqrt() của số âm.")
    return { value: Math.sqrt(x.value), dims: powDims(x.dims, 0.5) }
  },
  abs: (args) => {
    if (args.length !== 1) throw new CalcError("abs() nhận đúng 1 đối số.")
    return { value: Math.abs(args[0]!.value), dims: args[0]!.dims }
  },
  min: (args) => ({ value: Math.min(...args.map((a) => a.value)), dims: sameAll("min", args) }),
  max: (args) => ({ value: Math.max(...args.map((a) => a.value)), dims: sameAll("max", args) }),
  sum: (args) => ({ value: args.reduce((s, a) => s + a.value, 0), dims: sameAll("sum", args) }),
  avg: (args) => ({ value: args.reduce((s, a) => s + a.value, 0) / args.length, dims: sameAll("avg", args) }),
  ln: one("ln", Math.log),
  log10: one("log10", Math.log10),
  exp: one("exp", Math.exp),
}

export const FUNCTION_NAMES = Object.keys(FUNCTIONS)

/** Numbers typed into `text` that look like data (4+ digits, or 2+ decimals), not constants like 100 or 1/3. */
export function dataLiterals(text: string): string[] {
  try {
    return tokenize(text).flatMap((t) => (t.kind === "num" && (Math.abs(t.value) >= 1000 || /\.\d{2,}/.test(String(t.value))) ? [String(t.value)] : []))
  } catch {
    return []
  }
}

/** Public formula constants only; financial operands must be source-bound variables. */
export const FORMULA_CONSTANTS = [0,1,2,3,4,12,100,252,365] as const
/** A formula constant, not a data figure: the listed constants, small counts (n of a mean, periods,
 *  quarters, days of a month) and powers of ten used to rescale units. */
export function isFormulaConstant(v:number):boolean {
  if((FORMULA_CONSTANTS as readonly number[]).includes(v))return true
  if(Number.isInteger(v)&&Math.abs(v)<=31)return true
  const k=Math.log10(Math.abs(v));return v!==0&&Number.isInteger(Math.round(k*1e9)/1e9)&&Math.abs(k)<=15
}
/** Strict list (shared benchmark calculator shim depends on it): only FORMULA_CONSTANTS. */
export function nonFormulaLiterals(text:string):string[] {
  return tokenize(text).flatMap(t=>t.kind === "num" && !(FORMULA_CONSTANTS as readonly number[]).includes(t.value) ? [String(t.value)] : [])
}
/** OpenTrading native calculator (2026-11-11): small counts and powers of ten are formula constants too. */
export function nonFormulaLiteralsRelaxed(text:string):string[] {
  return tokenize(text).flatMap(t=>t.kind === "num" && !isFormulaConstant(t.value) ? [String(t.value)] : [])
}

/** Variable names only: a name followed by '(' is a function call, not a source binding. */
export function expressionVariables(text:string):string[] {
 const tokens=tokenize(text)
 return [...new Set(tokens.flatMap((t,i)=>t.kind === "name" && !(tokens[i+1]?.kind === "op" && (tokens[i+1] as {op:string}).op === "(") ? [t.name] : []))]
}
export function checkSourceBindings(text:string,names:string[]) {
 const used=expressionVariables(text);const missing=used.filter(x=>!names.includes(x));const unused=names.filter(x=>!used.includes(x))
 if(missing.length||unused.length)throw new CalcError(`Expression/source bindings differ: missing=[${missing.join(",")}], unused=[${unused.join(",")}]. Supply exactly the variables used in expression.${missing.length?` Mỗi biến phải có trong "values", ví dụ {"expression":"${text.replace(/"/g,"'")}","values":{${missing.map(x=>`"${x}":{"from_call":"r2","field":"tên_trường"}`).join(",")}},"unit":"..."} hoặc {"${missing[0]}":{"value":123,"unit":"đồng"}}. Kết quả compute/calculate trước có thể dùng thẳng tên ref làm biến (vd "(r12 + r13) / 2"). Nếu không cần tính thêm: trả lời ngay từ số tool đã trả về.`:""}`)
}

/** Evaluate `text` with `values` (each already in base units). */
export function evaluate(text: string, values: Record<string, Quantity>): Quantity {
  const tokens = tokenize(text)
  if (tokens.length === 0) throw new CalcError("Biểu thức rỗng.")
  let pos = 0
  const peek = () => tokens[pos]
  const isOp = (op: string) => {
    const t = peek()
    return t?.kind === "op" && t.op === op
  }
  const expect = (op: string) => {
    if (!isOp(op)) throw new CalcError(`Thiếu "${op}" ở token ${pos + 1}.`)
    pos++
  }

  // expr := term (('+'|'-') term)*
  function expr(): Quantity {
    let left = term()
    while (isOp("+") || isOp("-")) {
      const op = (tokens[pos++] as { op: string }).op
      const right = term()
      if (!sameDims(left.dims, right.dims))
        throw new CalcError(`Không thể ${op === "+" ? "cộng" : "trừ"} ${describeDims(left.dims) || "số không đơn vị"} với ${describeDims(right.dims) || "số không đơn vị"}: lệch đơn vị.`)
      left = { value: op === "+" ? left.value + right.value : left.value - right.value, dims: left.dims }
    }
    return left
  }
  // term := power (('*'|'/') power)*
  function term(): Quantity {
    let left = power()
    while (isOp("*") || isOp("/")) {
      const op = (tokens[pos++] as { op: string }).op
      const right = power()
      if (op === "/") {
        if (right.value === 0) throw new CalcError("Chia cho 0.")
        left = { value: left.value / right.value, dims: divDims(left.dims, right.dims) }
      } else left = { value: left.value * right.value, dims: mulDims(left.dims, right.dims) }
    }
    return left
  }
  // power := unary ('^' power)?   (2^3^2 = 2^9)
  function power(): Quantity {
    const base = unary()
    if (!isOp("^")) return base
    pos++
    const exponent = plain(power(), "Số mũ")
    if (Object.keys(base.dims).length > 0 && !Number.isInteger(exponent)) throw new CalcError(`Mũ không nguyên của giá trị có đơn vị (${describeDims(base.dims)}).`)
    return { value: finite(base.value ** exponent, "Phép mũ"), dims: powDims(base.dims, exponent) }
  }
  function unary(): Quantity {
    if (isOp("-")) {
      pos++
      const q = unary()
      return { value: -q.value, dims: q.dims }
    }
    if (isOp("+")) {
      pos++
      return unary()
    }
    return primary()
  }
  function primary(): Quantity {
    const t = peek()
    if (!t) throw new CalcError("Biểu thức kết thúc giữa chừng.")
    if (t.kind === "num") {
      pos++
      return { value: t.value, dims: {} }
    }
    if (t.kind === "name") {
      pos++
      if (isOp("(")) {
        pos++
        const fn = FUNCTIONS[t.name.toLowerCase()]
        if (!fn) throw new CalcError(`Không có hàm ${t.name}(). Có: ${FUNCTION_NAMES.join(", ")}.`)
        const args: Quantity[] = []
        if (!isOp(")")) {
          args.push(expr())
          while (isOp(",")) {
            pos++
            args.push(expr())
          }
        }
        expect(")")
        return fn(args)
      }
      const v = values[t.name]
      if (!v) throw new CalcError(`Chưa khai giá trị "${t.name}" trong values. Có: ${Object.keys(values).join(", ") || "không có"}.`)
      return v
    }
    if (t.op === "(") {
      pos++
      const q = expr()
      expect(")")
      return q
    }
    throw new CalcError(`Không đọc được "${t.op}" ở token ${pos + 1}.`)
  }

  const result = expr()
  if (pos < tokens.length) throw new CalcError(`Thừa phần cuối biểu thức từ token ${pos + 1}.`)
  return { value: finite(result.value, "Biểu thức"), dims: result.dims }
}
