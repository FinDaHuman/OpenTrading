import {parseUnit,sameDims} from "./calculate/units"
import {financialLeaves,financialValue,validateAlignment,alignOrRelax,sourceProof,DerivationError,relaxableDerivation,type FinancialLeaf} from "./financial-source"
import { z } from "zod"
import { extractFromRef, type Extracted } from "./chart/extract"
import { readEnvelope } from "./envelope"
import { keepEvidence, recallResult, REF_PREFIX, rememberResult } from "./refs"
import { LOCAL_SOURCE, type ToolContext, type ToolDef } from "./types"

/**
 * Fixed arithmetic over results already fetched, for what a model gets wrong by hand: a return
 * over 63 of 126 candles, a multi-year mean. It reads numbers by ref, so it runs no code and the
 * model types no digits. Its own result gets a ref, so a computed figure traces back too.
 */

const OPS = ["pct_change", "mean", "sum", "ratio", "relative_strength", "rank", "share", "annualize"] as const

const Series = {
  from_call: z.string().min(1).describe("Ref của kết quả dữ liệu, dạng r3."),
  from_symbol: z.string().optional().describe("Mã cần đọc khi kết quả có nhiều mã."),
  field: z.string().optional().describe("Trường số; mặc định là giá đóng cửa hoặc trường số đầu tiên."),
  path: z.string().optional().describe("Đường dẫn tới mảng khi kết quả có nhiều mảng."),
}

const Single = z.object({
  op: z.enum(OPS),
  ...Series,
  other: z.object(Series).optional().describe("Chuỗi thứ hai, cho ratio và relative_strength."),
  periods: z.number().int().min(1).optional().describe("Số kỳ gần nhất. pct_change: so với N kỳ trước; mean, sum: N kỳ cuối. Mặc định cả chuỗi."),
  periods_done: z.number().int().min(1).optional().describe("annualize: số kỳ đã có trong năm."),
  periods_per_year: z.number().int().min(1).optional().describe("annualize: số kỳ trong một năm, ví dụ 4 quý."),
})

/** One call may run several ops (pilot or15: OT spent 2–3x requests computing step by step). Each gets its own ref. */
const Input = Single.partial({ op: true, from_call: true }).extend({
  batch: z.array(Single).min(1).max(20).optional().describe("Nhiều phép trong một lần gọi (tối đa 20), mỗi phép cùng dạng như một lời gọi compute; mỗi kết quả có ref riêng. Khi dùng batch thì bỏ op ở ngoài."),
})

type Input = z.infer<typeof Single>
type BatchInput = z.infer<typeof Input>
type Spec = Pick<Input, "from_call" | "from_symbol" | "field" | "path">

interface Read extends Extracted {
  series: number[]
  unit?: string
}

function read(spec: Spec): Read {
  const found = extractFromRef(spec.from_call, { symbol: spec.from_symbol, field: spec.field, path: spec.path })
  if (!found.series?.length) throw new Error(`Kết quả ${spec.from_call} không có chuỗi số để tính.`)
  const text = recallResult(spec.from_call)?.text ?? ""
  const unit = found.field ? readEnvelope(text)?.units.get(found.field) : undefined
  return { ...found, series: found.series, ...(unit ? { unit } : {}) }
}

/** Past what a price or a ratio needs, and short of float noise. */
const round = (value: number) => Number(value.toFixed(6))

function change(series: number[], periods: number | undefined) {
  const steps = periods ?? series.length - 1
  if (steps < 1 || steps >= series.length) throw new Error(`Cần hơn ${steps} kỳ, chuỗi có ${series.length} kỳ.`)
  const before = series.at(-1 - steps)!
  if (before === 0) throw new Error("Giá trị kỳ gốc bằng 0, không tính được % thay đổi.")
  return { value: (series.at(-1)! / before - 1) * 100, steps }
}

function lastPeriods(series: number[], periods: number | undefined) {
  if (periods !== undefined && periods > series.length) throw new Error(`Cần ${periods} kỳ, chuỗi có ${series.length} kỳ.`)
  return periods === undefined ? series : series.slice(-periods)
}

/**
 * Two returns compare only over the same window. Results fetched apart can end on different
 * days (one has today's candle, one came from cache), and positions alone would hide that.
 */
function sameWindow(a: Read, b: Read, steps: number) {
  if (!a.times?.length || !b.times?.length) return
  const window = (d: Read) => `${d.times!.at(-1 - steps)} → ${d.times!.at(-1)}`
  if (window(a) !== window(b)) throw new Error(`Hai chuỗi lệch ngày: ${a.ref} ${window(a)}, ${b.ref} ${window(b)}. Lấy lại để cùng ngày cuối.`)
}

const needOther = (input: Input) => {
  if (!input.other) throw new Error(`${input.op} cần chuỗi thứ hai ở other.`)
  return read(input.other)
}

const labelled = (data: Read) => {
  if (!data.labels?.length) throw new Error(`${data.ref} không có trường tên để xếp hạng hoặc tính tỷ trọng.`)
  return data.series.map((value, i) => ({ label: data.labels![i]!, value }))
}

/** Where a figure came from, for the answer's own citation. */
const inputOf = (data: Read, used = data.series.length) => ({
  ref: data.ref,
  tool: data.tool,
  ...(data.symbol ? { symbol: data.symbol } : {}),
  ...(data.field ? { field: data.field } : {}),
  ...(data.unit ? { unit: data.unit } : {}),
  points: used,
  ...(data.times?.length ? { from: data.times.at(-used), to: data.times.at(-1) } : {}),
})

function calculate(input: Input) {
  const data = read(input)
  switch (input.op) {
    case "pct_change": {
      const { value, steps } = change(data.series, input.periods)
      return { result: round(value), unit: "%", inputs: [inputOf(data, steps + 1)] }
    }
    case "mean":
    case "sum": {
      const values = lastPeriods(data.series, input.periods)
      const total = values.reduce((a, b) => a + b, 0)
      return { result: round(input.op === "sum" ? total : total / values.length), unit: data.unit, inputs: [inputOf(data, values.length)] }
    }
    case "ratio": {
      const other = needOther(input)
      if (data.unit && other.unit && data.unit !== other.unit) throw new Error(`Hai chuỗi khác đơn vị: "${data.unit}" và "${other.unit}". Đưa về cùng đơn vị trước.`)
      if (other.series.at(-1) === 0) throw new Error("Mẫu số bằng 0.")
      return { result: round(data.series.at(-1)! / other.series.at(-1)!), inputs: [inputOf(data, 1), inputOf(other, 1)] }
    }
    case "relative_strength": {
      const other = needOther(input)
      const mine = change(data.series, input.periods)
      const theirs = change(other.series, input.periods)
      sameWindow(data, other, mine.steps)
      return { result: round(mine.value - theirs.value), unit: "điểm %", inputs: [inputOf(data, mine.steps + 1), inputOf(other, theirs.steps + 1)] }
    }
    case "rank": {
      const rows = labelled(data).sort((a, b) => b.value - a.value)
      return { result: rows, unit: data.unit, inputs: [inputOf(data)] }
    }
    case "share": {
      const rows = labelled(data)
      const total = rows.reduce((sum, row) => sum + row.value, 0)
      if (total === 0) throw new Error("Tổng bằng 0, không tính được tỷ trọng.")
      return { result: rows.map((row) => ({ label: row.label, value: round((row.value / total) * 100) })), unit: "%", inputs: [inputOf(data)] }
    }
    case "annualize": {
      if (!input.periods_done || !input.periods_per_year) throw new Error("annualize cần periods_done và periods_per_year.")
      const values = lastPeriods(data.series, input.periods_done)
      return { result: round((values.reduce((a, b) => a + b, 0) * input.periods_per_year) / input.periods_done), unit: data.unit, inputs: [inputOf(data, values.length)] }
    }
  }
}

export function groundedCompute(input: Input, lenient = false) {
 const validate=(xs:FinancialLeaf[],a?:"same_period"|"time_series"|"cross_entity_same_period")=>alignOrRelax(xs,a,lenient)
 const sameSourceUnit=(values:FinancialLeaf[])=>{
  const first=parseUnit(values[0]?.unit)
  if(values.some(x=>(lenient?!!x.unit!==!!values[0]?.unit:!x.unit)||!sameDims(parseUnit(x.unit).dims,first.dims)||parseUnit(x.unit).factor!==first.factor))throw new DerivationError("Published source units differ inside the window; convert explicitly with calculate before computing growth/relative strength.")
 }
 const read=(spec:Spec)=>{
  let values=financialLeaves(spec.from_call)
  if(spec.path){const p=spec.path.startsWith("/")?spec.path:"/"+spec.path.replace(/\[(\d+)\]/g,"/$1").replace(/\./g,"/");values=values.filter(x=>x.path===p||x.path.startsWith(p+"/"))}
  if(spec.field)values=values.filter(x=>x.metric===spec.field||x.path.split("/").at(-1)===spec.field)
  if(spec.from_symbol)values=values.filter(x=>x.entity?.toUpperCase()===spec.from_symbol!.toUpperCase())
  if(!values.length)throw new DerivationError("No numeric leaves match the source selector.")
  if(!lenient&&values.some(x=>!x.unit))throw new DerivationError("Missing published financial unit; caller assumptions are not source proof.")
  if(new Set(values.map(x=>x.metric)).size>1)throw new DerivationError("Ambiguous metrics: specify field or exact path.")
  const key=(x:FinancialLeaf)=>Number(/\d{4}/.exec(x.period??"")?.[0]??0)*10+Number(/Q([1-4])/i.exec(x.period??"")?.[1]??0)
  return values.sort((a,b)=>key(a)-key(b)||String(a.period).localeCompare(String(b.period)))
 }
 let inputs=read(input);let result:unknown;let unit=inputs[0]!.unit
 if(input.op==="mean"||input.op==="sum"||input.op==="annualize"){
  const n=input.op==="annualize"?input.periods_done:input.periods;if(n!==undefined){if(n>inputs.length)throw new DerivationError("Insufficient periods.");inputs=inputs.slice(-n)}
  validate(inputs,"time_series")
  if(inputs.some(x=>x.unit!==unit))throw new DerivationError("Series units differ; convert with calculate.")
  let total=inputs.reduce((a,x)=>a+x.value,0);if(input.op==="mean")total/=inputs.length;result=total
  if(input.op==="annualize"){if(!input.periods_done||!input.periods_per_year)throw new DerivationError("annualize requires periods_done and periods_per_year.");result=(result as number)*input.periods_per_year/input.periods_done}
 }else if(input.op==="pct_change"){
  const n=input.periods??inputs.length-1;if(n<1||n>=inputs.length)throw new DerivationError("Insufficient periods for growth.");inputs=[inputs.at(-1-n)!,inputs.at(-1)!];validate(inputs,"time_series");sameSourceUnit(inputs);if(inputs[0]!.value===0)throw new DerivationError("Zero base.");result=(inputs[1]!.value/inputs[0]!.value-1)*100;unit="%"
 }else if(input.op==="ratio"){
  if(!input.other)throw new DerivationError("ratio requires other.");inputs=[inputs.at(-1)!,read(input.other).at(-1)!];validate(inputs);if(inputs[0]!.unit!==inputs[1]!.unit)throw new DerivationError("Ratio units differ; use calculate for scaling.");if(inputs[1]!.value===0)throw new DerivationError("Zero denominator.");result=inputs[0]!.value/inputs[1]!.value;unit="lần"
 }else if(input.op==="relative_strength"){
  if(!input.other)throw new DerivationError("relative_strength requires other.");const other=read(input.other);const steps=input.periods??inputs.length-1;const bsteps=input.periods??other.length-1
  if(steps<1||bsteps<1||steps>=inputs.length||bsteps>=other.length)throw new DerivationError("Insufficient periods.")
  const a=[inputs.at(-1-steps)!,inputs.at(-1)!],b=[other.at(-1-bsteps)!,other.at(-1)!];validate(a,"time_series");validate(b,"time_series");sameSourceUnit(a);sameSourceUnit(b)
  if(a.some((x,i)=>x.period!==b[i]!.period))throw new DerivationError("Relative-strength windows differ.")
  if(a[0]!.value===0||b[0]!.value===0)throw new DerivationError("Zero base.")
  result=((a[1]!.value/a[0]!.value-1)-(b[1]!.value/b[0]!.value-1))*100;unit="điểm %";inputs=[...a,...b]
 }else if(input.op==="rank"||input.op==="share"){
  validate(inputs,"cross_entity_same_period");if(!lenient&&inputs.some(x=>!x.entity))throw new DerivationError("Ranking/share requires source entity labels.")
  if(inputs.some(x=>x.unit!==unit))throw new DerivationError("Ranking/share source units differ.")
  const rows=inputs.map(x=>({label:x.entity??x.path,value:x.value}))
  if(input.op==="rank")result=rows.sort((a,b)=>b.value-a.value)
  else{const total=rows.reduce((a,x)=>a+x.value,0);if(total===0)throw new DerivationError("Zero total.");result=rows.map(x=>({label:x.label,value:round(x.value/total*100)}));unit="%"}
 }else throw new DerivationError("Unsupported operation.")
 if(typeof result==="number"){if(!Number.isFinite(result))throw new DerivationError("Non-finite result.");result=round(result)}
 return {result,unit,inputs:inputs.map(x=>({ref:x.ref,path:x.path,value:x.value,unit:x.unit})),...(lenient?{}:sourceProof(inputs,input.op,result,unit))}
}

export function computeTool(): ToolDef<BatchInput> {
  return {
    name: "compute",
    description:
      "Tính trên kết quả đã lấy, theo ref: pct_change, mean, sum (4 quý = TTM), ratio, relative_strength (chênh % thay đổi giữa hai chuỗi), rank, share, annualize. " +
      "Dùng khi: cần số tính từ chuỗi dữ liệu, thay vì tự tính. Câu trả lời ghi số này kèm ref nguồn. " +
      "Không dùng khi: số đã có sẵn trong kết quả tool, hoặc chưa có ref (gọi tool dữ liệu trước). " +
      "Nhiều phép (vd. mean 20/60/120 phiên cho nhiều mã) gửi chung một lần qua batch: [{op, from_call, ...}, ...].",
    input: Input,
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: ({ op, from_call, batch }) => batch ? `compute(batch ×${batch.length})` : `compute(${op}, ${from_call})`,
    async execute(input, ctx: ToolContext) {
      if (input.batch?.length) {
        const lines: string[] = []
        for (const [i, item] of input.batch.entries()) {
          try {
            lines.push(`#${i + 1} ` + (await runOne(item, { ...ctx, callId: `${ctx.callId}#${i + 1}` }, true)))
          } catch (error) {
            lines.push(`#${i + 1} lỗi: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`)
          }
        }
        return lines.join("\n")
      }
      if (!input.op || !input.from_call) throw new Error("compute cần op và from_call, hoặc batch.")
      return runOne(input as Input, ctx)
    },
  }
}

async function runOne(input: Input, ctx: ToolContext, batched = false): Promise<string> {
  {
      // Verified first; if grounded lineage cannot be proven (missing unit/period metadata, mixed
      // units), compute from the series anyway and label it unverified (no derived_result → never
      // recorded as source proof) instead of dead-ending the turn.
      let body: Record<string, unknown>
      if (ctx.groundedFinancial && batched) {
        // A batch item has no execution of its own in the native ledger (one call, many results), so it carries no
        // source proof: computed from the fetched series and labelled unverified, like any relaxed result.
        body = { ...groundedCompute(input, true), lineage: "unverified", lineage_note: "Kết quả trong batch: tính trực tiếp từ chuỗi số đã lấy, không mang source proof." }
      } else if (ctx.groundedFinancial) {
        try {
          body = groundedCompute(input)
        } catch (error) {
          if (!(error instanceof DerivationError) || !relaxableDerivation(error.message)) throw error
          body = { ...groundedCompute(input, true), lineage: "unverified", lineage_note: `Không gắn được nguồn kiểm chứng (${error.message.slice(0, 200)}). Kết quả tính trực tiếp từ chuỗi số đã lấy: dùng để trả lời, ghi rõ công thức và số đầu vào.` }
        }
      } else body = calculate(input)
      const text = JSON.stringify({ op: input.op, ...(input.periods ? { periods: input.periods } : {}), ...body })
      const ref = rememberResult("compute", text, {callId:ctx.callId,rawText:text,rawSha256:new Bun.CryptoHasher("sha256").update(text).digest("hex"),visibleSha256:new Bun.CryptoHasher("sha256").update(text).digest("hex")})
      keepEvidence({ ref, callId: ctx.callId, tool: "compute", input, text, rawText:text,rawSha256:new Bun.CryptoHasher("sha256").update(text).digest("hex"),visibleSha256:new Bun.CryptoHasher("sha256").update(text).digest("hex") })
      return `${REF_PREFIX}${ref}] ${text}`
  }
}
