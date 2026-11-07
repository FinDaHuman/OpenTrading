import { z } from "zod"
import { extractFromRef } from "../chart/extract"
import { readEnvelope } from "../envelope"
import { keepEvidence, recallResult, REF_PREFIX, rememberResult } from "../refs"
import { LOCAL_SOURCE, type ToolContext, type ToolDef } from "../types"
import { CalcError, dataLiterals, evaluate, FUNCTION_NAMES, type Quantity } from "./expression"
import { describeDims, parseUnit, sameDims } from "./units"

/**
 * `calculate`: the model's arithmetic, done by the harness. Models get sums, percentages and
 * unit conversions wrong (a price in nghìn đồng against an EPS in đồng is a 1000× error), and a
 * wrong figure reads as right. Here every value has a unit, the expression is parsed (never run
 * as code), a mismatch is an error, and the result gets a ref like a data result, so a computed
 * figure traces back to its inputs. `compute` stays for whole series by ref (mean of 8 quarters).
 */

const Value = z.union([
  z.object({
    value: z.number().describe("Số, đúng như trong kết quả tool (64.27, không phải 64,27)."),
    unit: z.string().optional().describe('Đơn vị của số: "nghìn đồng/cổ phiếu", "tỷ đồng", "cổ phiếu", "%", "lần". Bỏ trống = số thuần.'),
    ref: z.string().optional().describe("Ref của kết quả có số này, dạng r3: để trích nguồn."),
  }),
  z.object({
    from_call: z.string().min(1).describe("Ref của kết quả dữ liệu, dạng r3: lấy số thẳng từ đó, không gõ lại."),
    field: z.string().optional().describe("Trường số; mặc định là giá đóng cửa hoặc trường số đầu tiên."),
    from_symbol: z.string().optional().describe("Mã cần đọc khi kết quả có nhiều mã."),
    path: z.string().optional().describe("Đường dẫn tới mảng khi kết quả có nhiều mảng."),
    at: z.union([z.literal("last"), z.literal("first"), z.number().int()]).optional().describe('Phần tử: "last" (mặc định), "first", hoặc chỉ số (âm = đếm từ cuối).'),
    unit: z.string().optional().describe("Chỉ khi kết quả không ghi đơn vị của trường này."),
  }),
])

const Input = z.object({
  expression: z.string().min(1).describe("Biểu thức với tên trong values: price / eps, (rev_2025 / rev_2022) ^ (1/3) - 1, a + b. Hàm: " + FUNCTION_NAMES.join(", ") + "."),
  values: z.record(z.string(), Value).optional().describe("Tên → giá trị có đơn vị. Mọi số lấy từ dữ liệu đặt ở đây, không viết thẳng vào biểu thức."),
  unit: z.string().optional().describe('Đơn vị muốn nhận kết quả: "lần", "%", "tỷ đồng", "đồng/cổ phiếu". Lệch loại đơn vị thì báo lỗi.'),
  decimals: z.number().int().min(0).max(12).optional().describe("Số chữ số thập phân khi làm tròn; mặc định 6."),
})

type Input = z.infer<typeof Input>
type ValueSpec = z.infer<typeof Value>

interface Resolved extends Quantity {
  shown: { name: string; value: number; unit?: string; ref?: string; tool?: string; field?: string; symbol?: string; time?: string }
}

function pick<T>(list: T[], at: "last" | "first" | number | undefined, what: string): { item: T; index: number } {
  const n = list.length
  const index = at === undefined || at === "last" ? n - 1 : at === "first" ? 0 : at < 0 ? n + at : at
  if (index < 0 || index >= n) throw new CalcError(`${what}: không có phần tử ${String(at)} (chuỗi có ${n} phần tử).`)
  return { item: list[index]!, index }
}

function resolve(name: string, spec: ValueSpec): Resolved {
  if ("value" in spec) {
    const unit = parseUnit(spec.unit)
    return { value: spec.value * unit.factor, dims: unit.dims, shown: { name, value: spec.value, ...(spec.unit ? { unit: spec.unit } : {}), ...(spec.ref ? { ref: spec.ref } : {}) } }
  }
  // A figure this tool or compute already made: its `result` and `unit`, not an input inside it.
  const stored = recallResult(spec.from_call)
  if (stored && (stored.tool === "calculate" || stored.tool === "compute")) return computed(name, spec, stored.tool, stored.text)
  const found = extractFromRef(spec.from_call, { symbol: spec.from_symbol, field: spec.field, path: spec.path })
  if (!found.series?.length) throw new CalcError(`Kết quả ${spec.from_call} không có số để lấy cho "${name}".`)
  const { item, index } = pick(found.series, spec.at, `"${name}" (${spec.from_call})`)
  const published = found.field ? readEnvelope(recallResult(spec.from_call)?.text ?? "")?.units.get(found.field) : undefined
  const unitText = published ?? spec.unit
  if (published && spec.unit && !sameDims(parseUnit(published).dims, parseUnit(spec.unit).dims))
    throw new CalcError(`"${name}": kết quả ${spec.from_call} ghi đơn vị "${published}", không phải "${spec.unit}".`)
  const unit = parseUnit(unitText)
  return {
    value: item * unit.factor,
    dims: unit.dims,
    shown: {
      name,
      value: item,
      ...(unitText ? { unit: unitText } : {}),
      ref: found.ref,
      tool: found.tool,
      ...(found.field ? { field: found.field } : {}),
      ...(found.symbol ? { symbol: found.symbol } : {}),
      ...(found.times?.[index] ? { time: found.times[index] } : {}),
    },
  }
}

function computed(name: string, spec: Extract<ValueSpec, { from_call: string }>, tool: string, text: string): Resolved {
  let parsed: { result?: unknown; unit?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new CalcError(`Không đọc được kết quả ${spec.from_call}.`)
  }
  if (typeof parsed.result !== "number") throw new CalcError(`${spec.from_call} (${tool}) không ra một số; lấy từng giá trị bằng value kèm unit.`)
  const unitText = typeof parsed.unit === "string" && parsed.unit ? parsed.unit : spec.unit
  const unit = parseUnit(unitText)
  return { value: parsed.result * unit.factor, dims: unit.dims, shown: { name, value: parsed.result, ...(unitText ? { unit: unitText } : {}), ref: spec.from_call, tool } }
}

export interface CalcResult {
  expression: string
  result: number
  unit: string
  inputs: Resolved["shown"][]
  /** A value whose unit no one gave: the result may be off by its scale. */
  warnings?: string[]
}

export function calculate(input: Input): CalcResult {
  const resolved: Record<string, Resolved> = {}
  for (const [name, spec] of Object.entries(input.values ?? {})) resolved[name] = resolve(name, spec)
  // Digits typed into the expression are fine for constants (100, 1/3, 4 quarters); a figure
  // from data typed there loses its unit and its source.
  const literal = dataLiterals(input.expression)
  const warnings: string[] = []
  if (literal.length > 0) warnings.push(`Biểu thức có số viết thẳng (${literal.slice(0, 3).join(", ")}): số lấy từ dữ liệu nên đặt trong values kèm đơn vị và ref.`)
  for (const r of Object.values(resolved)) if (!r.shown.unit && "ref" in r.shown && r.shown.tool) warnings.push(`"${r.shown.name}" không rõ đơn vị: kiểm tra lại trước khi dùng.`)
  const q = evaluate(input.expression, resolved)
  const decimals = input.decimals ?? 6
  let value = q.value
  let unitText = describeDims(q.dims)
  if (input.unit !== undefined) {
    const want = parseUnit(input.unit)
    if (!sameDims(want.dims, q.dims))
      throw new CalcError(`Kết quả có đơn vị ${describeDims(q.dims) || "số thuần"}, không đổi được sang "${input.unit}" (${describeDims(want.dims) || "số thuần"}): lệch đơn vị.`)
    value = q.value / want.factor
    unitText = input.unit
  }
  return {
    expression: input.expression,
    result: Number(value.toFixed(decimals)),
    unit: unitText,
    inputs: Object.values(resolved).map((r) => r.shown),
    ...(warnings.length ? { warnings } : {}),
  }
}

export function calculateTool(): ToolDef<Input> {
  return {
    name: "calculate",
    description:
      "Máy tính có đơn vị: tính biểu thức (+ - * / ^, ngoặc, hàm) trên các giá trị đặt tên, mỗi giá trị kèm đơn vị, rồi đổi kết quả sang đơn vị cần. Lệch đơn vị (cộng giá với khối lượng, đổi % sang tỷ đồng) thì báo lỗi thay vì ra số sai. " +
      "Dùng khi: mọi con số phải tính ra (tỷ lệ, % thay đổi, CAGR, P/E, EV, giá trị vị thế, đổi tỷ ↔ nghìn tỷ, nghìn đồng ↔ đồng); không tự tính nhẩm. Lấy số thẳng từ ref bằng from_call khi có. Câu trả lời ghi số này kèm ref của phép tính. " +
      "Không dùng khi: số đã có sẵn trong kết quả tool; phép trên cả chuỗi theo ref (trung bình 8 quý, % thay đổi qua 63 phiên) thì dùng compute. " +
      'Ví dụ: {"expression":"price / eps","values":{"price":{"from_call":"r2","field":"close"},"eps":{"value":4520,"unit":"đồng/cổ phiếu","ref":"r5"}},"unit":"lần"}.',
    input: Input,
    readOnly: true,
    source: LOCAL_SOURCE,
    summarize: ({ expression }) => `calculate(${expression.length > 60 ? `${expression.slice(0, 57)}…` : expression})`,
    async execute(input, ctx: ToolContext) {
      let out: CalcResult
      try {
        out = calculate(input)
      } catch (error) {
        // A wrong expression or a unit mismatch is the model's to fix: say exactly what.
        if (error instanceof CalcError) throw new Error(`Không tính được: ${error.message}`)
        throw error
      }
      const text = JSON.stringify(out)
      const ref = rememberResult("calculate", text)
      keepEvidence({ ref, callId: ctx.callId, tool: "calculate", input, text })
      return `${REF_PREFIX}${ref}] ${text}`
    },
  }
}
