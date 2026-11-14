import { z } from "zod"
import { TRACE_VERSION, type TraceEvent } from "./trace"

/**
 * Reading a trace is where the format is enforced: the runner and the adapters for other
 * harnesses only have to produce it. New optional fields pass through; a missing field or
 * another version stops the scorer instead of giving a wrong number.
 */
const RUN = z.looseObject({
  type: z.literal("run"),
  trace_version: z.number(),
  harness: z.string(),
  provider: z.string(),
  model: z.string(),
})
const ASKED = { q: z.string(), rep: z.number() }
const EVENT = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("question"), ...ASKED, group: z.string(), question: z.string(), now: z.string() }),
  z.looseObject({ type: z.literal("tool_call"), ...ASKED, call_id: z.string(), tool: z.string() }),
  z.looseObject({ type: z.literal("tool_result"), ...ASKED, call_id: z.string(), ok: z.boolean(), visible: z.string() }),
  z.looseObject({ type: z.literal("tool_raw"), ...ASKED, call_id: z.string(), tool: z.string(), ok: z.boolean(), raw: z.string() }),
  z.looseObject({ type: z.literal("retry"), ...ASKED }),
  z.looseObject({ type: z.literal("notice"), ...ASKED }),
  z.looseObject({ type: z.literal("error"), ...ASKED }),
  z.looseObject({ type: z.literal("stopped") }),
  z.looseObject({
    type: z.literal("answer"),
    ...ASKED,
    text: z.string(),
    outcome: z.string(),
    model_steps: z.number(),
    input_tokens: z.number(),
    output_tokens: z.number(),
    duration_ms: z.number(),
  }),
])

type Of<T extends TraceEvent["type"]> = Extract<TraceEvent, { type: T }>

/** One run of one question. `answer` is missing when the run was cut off before it. */
export interface Attempt {
  q: string
  rep: number
  question: Of<"question">
  /** Tool calls and their results in the order they happened. */
  timeline: (Of<"tool_call"> | Of<"tool_result">)[]
  results: Of<"tool_result">[]
  raws: Of<"tool_raw">[]
  answer?: Of<"answer">
}

export interface Trace {
  run: Of<"run">
  attempts: Attempt[]
  stopped: boolean
}

export function readTrace(text: string): Trace {
  const lines = text.split("\n").filter(Boolean)
  const head = RUN.parse(JSON.parse(lines[0] ?? "null"))
  if (head.trace_version !== TRACE_VERSION) throw new Error(`Trace bản ${head.trace_version}, scorer đọc bản ${TRACE_VERSION}.`)
  const attempts = new Map<string, Attempt>()
  let stopped = false
  lines.slice(1).forEach((line, i) => {
    let event: TraceEvent
    try {
      event = EVENT.parse(JSON.parse(line)) as TraceEvent
    } catch (error) {
      throw new Error(`Dòng ${i + 2} của trace lỗi: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (event.type === "stopped") {
      stopped = true
      return
    }
    if (event.type === "run") return
    const key = `${event.q}#${event.rep}`
    if (event.type === "question") {
      attempts.set(key, { q: event.q, rep: event.rep, question: event, timeline: [], results: [], raws: [] })
      return
    }
    const attempt = attempts.get(key)
    if (!attempt) throw new Error(`Dòng ${i + 2} của trace: chưa có câu ${key}.`)
    if (event.type === "tool_call") attempt.timeline.push(event)
    else if (event.type === "tool_result") {
      attempt.results.push(event)
      attempt.timeline.push(event)
    }
    else if (event.type === "tool_raw") attempt.raws.push(event)
    else if (event.type === "answer") attempt.answer = event
  })
  return { run: head as unknown as Of<"run">, attempts: [...attempts.values()], stopped }
}
