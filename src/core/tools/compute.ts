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

const Input = z.object({
  op: z.enum(OPS),
  ...Series,
  other: z.object(Series).optional().describe("Chuỗi thứ hai, cho ratio và relative_strength."),
  periods: z.number().int().min(1).optional().describe("Số kỳ gần nhất. pct_change: so với N kỳ trước; mean, sum: N kỳ cuối. Mặc định cả chuỗi."),
  periods_done: z.number().int().min(1).optional().describe("annualize: số kỳ đã có trong năm."),
  periods_per_year: z.number().int().min(1).optional().describe("annualize: số kỳ trong một năm, ví dụ 4 quý."),
})

type Input = z.infer<typeof Input>
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

export function computeTool(): ToolDef<Input> {
  return {
    name: "compute",
    description:
      "Tính trên kết quả đã lấy, theo ref: pct_change, mean, sum (4 quý = TTM), ratio, relative_strength (chênh % thay đổi giữa hai chuỗi), rank, share, annualize. " +
      "Dùng khi: cần số tính từ chuỗi dữ liệu, thay vì tự tính. Câu trả lời ghi số này kèm ref nguồn. " +
      "Không dùng khi: số đã có sẵn trong kết quả tool, hoặc chưa có ref (gọi tool dữ liệu trước).",
    input: Input,
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: ({ op, from_call }) => `compute(${op}, ${from_call})`,
    async execute(input, ctx: ToolContext) {
      const text = JSON.stringify({ op: input.op, ...(input.periods ? { periods: input.periods } : {}), ...calculate(input) })
      const ref = rememberResult("compute", text)
      keepEvidence({ ref, callId: ctx.callId, tool: "compute", input, text })
      return `${REF_PREFIX}${ref}] ${text}`
    },
  }
}
