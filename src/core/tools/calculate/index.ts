import { financialValue, sourceProof, alignOrRelax, DerivationError, relaxableDerivation, type FinancialLeaf } from "../financial-source"
import { z } from "zod"
import { extractFromRef } from "../chart/extract"
import { readEnvelope } from "../envelope"
import { keepEvidence, recallResult, REF_PREFIX, rememberResult } from "../refs"
import { LOCAL_SOURCE, type ToolContext, type ToolDef } from "../types"
import { CalcError, dataLiterals, expressionVariables, nonFormulaLiterals, nonFormulaLiteralsRelaxed, checkSourceBindings, evaluate, FUNCTION_NAMES, type Quantity } from "./expression"
import { describeDims, parseUnit, sameDims, samePerShare } from "./units"

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
  alignment: z.enum(["same_period", "time_series", "cross_entity_same_period"]).optional().describe("Financial alignment: default same entity/period/scope; time_series permits different periods of one metric; cross_entity_same_period permits aggregation/comparison of entities at one date."),
  expression: z.string().min(1).describe("Biểu thức với tên trong values: price / eps, (rev_2025 / rev_2022) ^ (1/3) - 1, a + b. Hàm: " + FUNCTION_NAMES.join(", ") + "."),
  values: z.record(z.string(), Value).optional().describe("Tên → giá trị có đơn vị. Supply exactly the variables used in expression; no unused bindings. Mọi số lấy từ dữ liệu đặt ở đây, không viết thẳng vào biểu thức."),
  unit: z.string().optional().describe('Đơn vị muốn nhận kết quả (unit-aware: expression a/b-1 with unit % already scales by 100; do not also multiply expression by 100): "lần", "%", "tỷ đồng", "đồng/cổ phiếu". Lệch loại đơn vị thì báo lỗi.'),
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

function resolve(name: string, spec: ValueSpec, grounded = false, lineage: FinancialLeaf[] = [], lenient = false): Resolved {
  if (grounded && lenient && "value" in spec) {
    const unit = parseUnit(spec.unit)
    return { value: spec.value * unit.factor, dims: unit.dims, shown: { name, value: spec.value, ...(spec.unit ? { unit: spec.unit } : {}), ...(spec.ref ? { ref: spec.ref } : {}) } }
  }
  if (grounded) {
    if ("value" in spec) throw new DerivationError("Financial operands must use from_call and an actual numeric leaf; typed value/ref is not source proof. Put formula constants in expression.");
    const leaf = {...financialValue(spec, lenient), name}; lineage.push(leaf);
    if(!leaf.unit && !lenient) throw new DerivationError(`Source ${spec.from_call} has no published unit; provide unit only when metadata omits it.`);
    const unit=parseUnit(leaf.unit);return {value:leaf.value*unit.factor,dims:unit.dims,shown:{name,value:leaf.value,unit:leaf.unit,ref:leaf.ref,tool:recallResult(leaf.ref)?.tool,field:leaf.metric,symbol:leaf.entity,time:leaf.period}}
  }
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
  if (published && spec.unit && !sameDims(parseUnit(published).dims, parseUnit(spec.unit).dims) && !samePerShare(parseUnit(published).dims, parseUnit(spec.unit).dims))
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

/** Alignment the inputs imply when the caller did not declare one: several entities → a cross-entity
 *  aggregate/comparison of one period; one entity over several periods → a time series. */
function inferAlignment(inputs: FinancialLeaf[]): "same_period" | "time_series" | "cross_entity_same_period" | undefined {
  const entities = new Set(inputs.map((x) => x.entity).filter(Boolean))
  const periods = new Set(inputs.map((x) => x.period).filter(Boolean))
  if (entities.size > 1) return "cross_entity_same_period"
  if (periods.size > 1) return "time_series"
  return undefined
}

export interface CalcResult {
  expression: string
  result: number
  unit: string
  inputs: Resolved["shown"][]
  /** A value whose unit no one gave: the result may be off by its scale. */
  warnings?: string[]
  /** The expression and the output unit both scaled by the same power of ten; applied once. */
  scale_fixed?: boolean
}

export function calculate(input: Input, grounded = false, lenient = false, relaxedUnits = false): CalcResult & Partial<ReturnType<typeof sourceProof>> {
  input = bindRefVariables(input)
  if(grounded)checkSourceBindings(input.expression,Object.keys(input.values??{}))
  const lineage: FinancialLeaf[] = []
  const resolved: Record<string, Resolved> = Object.create(null)
  for (const [name, spec] of Object.entries(input.values ?? {})) resolved[name] = resolve(name, spec, grounded, lineage, lenient)
  if(grounded) alignOrRelax(lineage, input.alignment ?? inferAlignment(lineage), lenient)
  // Digits typed into the expression are fine for constants (100, 1/3, 4 quarters); a figure
  // from data typed there loses its unit and its source.
  const literal = dataLiterals(input.expression)
  const warnings: string[] = []
  if(grounded && !lenient && (relaxedUnits ? nonFormulaLiteralsRelaxed : nonFormulaLiterals)(input.expression).length) throw new DerivationError("Financial figures must be retrieved via source refs, not embedded in expressions.")
  if(grounded && !lenient && !lineage.length) throw new DerivationError("Financial calculation requires at least one verified source operand.")
  if (literal.length > 0) warnings.push(`Biểu thức có số viết thẳng (${literal.slice(0, 3).join(", ")}): số lấy từ dữ liệu nên đặt trong values kèm đơn vị và ref.`)
  for (const r of Object.values(resolved)) if (!r.shown.unit && "ref" in r.shown && r.shown.tool) warnings.push(`"${r.shown.name}" không rõ đơn vị: kiểm tra lại trước khi dùng.`)
  const q = evaluate(input.expression, resolved)
  const decimals = input.decimals ?? 6
  let value = q.value
  let scaleFixed = false
  let unitText = describeDims(q.dims)
  if (input.unit !== undefined) {
    const want = parseUnit(input.unit)
    if (!sameDims(want.dims, q.dims) && !(relaxedUnits && samePerShare(want.dims, q.dims)))
      throw new CalcError(`Kết quả có đơn vị ${describeDims(q.dims) || "số thuần"}, không đổi được sang "${input.unit}" (${describeDims(want.dims) || "số thuần"}): lệch đơn vị.`)
    // Double scaling (pilot or15 fin-l5-profile-01): "cap / 1000000000" with unit "tỷ đồng", or "(a/b-1)*100"
    // with unit "%", states the same conversion twice. Both parts mean one intent, so the expression's own
    // scaling is kept and the unit conversion is skipped (never a silent 10^9 error); the result is labelled.
    const dup = want.factor !== 1 ? scaleLiterals(input.expression).find((s) => near(s, want.factor) || near(s, 1 / want.factor)) : undefined
    if (dup !== undefined) {
      scaleFixed = true
      value = q.value
      warnings.push(`Biểu thức đã tự nhân/chia ${dup} và đơn vị "${input.unit}" cũng quy đổi cùng hệ số: chỉ áp một lần (kết quả theo ${input.unit}).`)
    } else value = q.value / want.factor
    unitText = input.unit
    // Per-share-only label difference: keep the true dimension in the reported unit.
    if (!sameDims(want.dims, q.dims)) {
      const perShare = (q.dims["cổ phiếu"] ?? 0) === -1
      unitText = perShare ? `${input.unit.replace(/\s+$/, "")}/cổ phiếu` : input.unit.replace(/\s*\/\s*(cổ phiếu|cp|shares?)\s*$/i, "")
    }
  }
  return {
    expression: input.expression,
    result: Number(value.toFixed(decimals)),
    unit: unitText,
    inputs: Object.values(resolved).map((r) => r.shown),
    ...(warnings.length ? { warnings } : {}),
    ...(scaleFixed ? { scale_fixed: true } : {}),
    ...(grounded && !lenient && !scaleFixed ? sourceProof(lineage,input.expression,Number(value.toFixed(decimals)),unitText) : {}),
  }
}

/**
 * Pilot or15r: DeepSeek repeatedly dropped `values` on long calculate calls and looped until the request budget ran
 * out. A variable named like a ref (r38) that is not in `values` now binds to that earlier compute/calculate result
 * (its result and unit), so "(r38 + r39 + r40) / 3" needs no values object. Data refs still need field/path.
 */
export function bindRefVariables(input: Input): Input {
  const given = input.values ?? {}
  const refs = expressionVariables(input.expression).filter((v) => /^r\d+$/.test(v) && !(v in given))
  const bound = refs.filter((v) => { const stored = recallResult(v); return stored && (stored.tool === "compute" || stored.tool === "calculate") })
  if (!bound.length) return input
  return { ...input, values: { ...given, ...Object.fromEntries(bound.map((v) => [v, { from_call: v }])) } }
}

/** Powers of ten (>= 100) that multiply or divide the whole expression or a term: 1000000000, 1e9, 10^9, 100. */
export function scaleLiterals(expression: string): number[] {
  const out: number[] = []
  const num = String.raw`(10\s*\^\s*\d+|\d+(?:\.\d+)?(?:e\d+)?)`
  for (const m of expression.matchAll(new RegExp(String.raw`[*/]\s*` + num + "|" + num + String.raw`\s*\*`, "gi"))) {
    const raw = (m[1] ?? m[2] ?? "").replace(/\s+/g, "")
    const v = raw.includes("^") ? 10 ** Number(raw.split("^")[1]) : Number(raw)
    if (Number.isFinite(v) && v >= 100 && Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9) out.push(v)
  }
  return out
}

const near = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 1e-9

export function calculateTool(): ToolDef<Input> {
  return {
    name: "calculate",
    description:
      "Máy tính có đơn vị: tính biểu thức (+ - * / ^, ngoặc, hàm) trên các giá trị đặt tên, mỗi giá trị kèm đơn vị, rồi đổi kết quả sang đơn vị cần. Lệch đơn vị (cộng giá với khối lượng, đổi % sang tỷ đồng) thì báo lỗi thay vì ra số sai. " +
      "Dùng khi: mọi con số phải tính ra (tỷ lệ, % thay đổi, CAGR, P/E, EV, giá trị vị thế, đổi tỷ ↔ nghìn tỷ, nghìn đồng ↔ đồng); không tự tính nhẩm. Lấy số thẳng từ ref bằng from_call khi có. Câu trả lời ghi số này kèm ref của phép tính. " +
      "Không dùng khi: số đã có sẵn trong kết quả tool; phép trên cả chuỗi theo ref (trung bình 8 quý, % thay đổi qua 63 phiên) thì dùng compute. " +
      'Kết quả compute/calculate trước dùng thẳng tên ref làm biến, không cần values: {"expression":"(r38 + r39 + r40) / 3","unit":"%"}. ' +
      'Ví dụ: {"expression":"price / eps","values":{"price":{"from_call":"r2","field":"close"},"eps":{"from_call":"r5","field":"eps"}},"unit":"lần"}. Prefer from_call refs (field/path selects numeric leaves) so the result carries source proof; when the source lacks unit/period metadata or an operand is typed as value+unit, the result is still computed and labelled lineage: unverified.',
    input: Input,
    readOnly: true,
    source: LOCAL_SOURCE,
    summarize: ({ expression }) => `calculate(${expression.length > 60 ? `${expression.slice(0, 57)}…` : expression})`,
    async execute(input, ctx: ToolContext) {
      let out: CalcResult & { lineage?: string; lineage_note?: string }
      try {
        out = calculate(input, ctx.groundedFinancial, false, true)
      } catch (error) {
        // Grounded lineage could not be proven (unit/period metadata missing, typed operand, entity
        // mix): still compute from the stated values instead of dead-ending the turn. The result is
        // labelled unverified and carries no derived_result, so it is never recorded as source proof.
        if (ctx.groundedFinancial && error instanceof DerivationError && relaxableDerivation(error.message)) {
          try {
            out = { ...calculate(input, true, true, true), lineage: "unverified", lineage_note: `Không gắn được nguồn kiểm chứng (${error.message.slice(0, 200)}). Kết quả tính từ giá trị/đơn vị đã khai: dùng để trả lời, ghi rõ công thức và số đầu vào.` }
          } catch (fallback) {
            if (fallback instanceof CalcError) throw new Error(`Không tính được: ${fallback.message}`)
            throw fallback
          }
        } else if (error instanceof CalcError) {
          if (ctx.groundedFinancial) throw new DerivationError(`invalid_derivation: ${error.message}`)
          throw new Error(`Không tính được: ${error.message}`)
        } else throw error
      }
      if (out.scale_fixed && !out.lineage) out = { ...out, lineage: "unverified", lineage_note: "Quy đổi đơn vị trùng đã được gộp còn một lần; kết quả không mang source proof." }
      const text = JSON.stringify(out)
      const ref = rememberResult("calculate", text, {callId: ctx.callId, rawText: text, rawSha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"), visibleSha256: new Bun.CryptoHasher("sha256").update(text).digest("hex")})
      keepEvidence({ ref, callId: ctx.callId, tool: "calculate", input, text, rawText:text,rawSha256:new Bun.CryptoHasher("sha256").update(text).digest("hex"),visibleSha256:new Bun.CryptoHasher("sha256").update(text).digest("hex") })
      return `${REF_PREFIX}${ref}] ${text}`
    },
  }
}
