import { stepCountIs, streamText, type ModelMessage, type StreamTextResult, type ToolSet } from "ai"
import { describeError, resolveTarget } from "./chat"
import type { AgentEvent } from "./events"
import { systemPrompt } from "./prompt"
import { languageModel } from "./providers"
import type { Skill } from "./skills"
import type { ToolRegistry } from "./tools/registry"

export const DEFAULT_MAX_STEPS = 10

const SUMMARY_PROMPT =
  "Đã hết số lượt gọi tool cho câu hỏi này. Không gọi thêm tool. Hãy tổng kết câu trả lời dựa trên dữ liệu đã có, nói rõ phần nào còn thiếu."

/**
 * Some models (seen with gemini-2.5-flash-lite) end a turn with an empty answer right
 * after a tool result: finish reason STOP, zero output tokens. The request is well formed —
 * it is a model quirk — so we ask once more, with tools still declared but disabled.
 */
const NUDGE_PROMPT = "Hãy trả lời câu hỏi của người dùng dựa trên kết quả tool ở trên. Không gọi thêm tool."

export interface RunOptions {
  history: ModelMessage[]
  input: string
  skills: Skill[]
  registry: ToolRegistry
  signal?: AbortSignal
  maxSteps?: number
}

function label(registry: ToolRegistry, name: string, input: unknown) {
  const def = registry.get(name)
  if (def?.summarize) {
    try {
      return def.summarize(input)
    } catch {
      // fall through to the generic label
    }
  }
  const args = JSON.stringify(input ?? {})
  return `${name}(${args === "{}" ? "" : args.length > 60 ? args.slice(0, 57) + "…" : args})`
}

function stringify(value: unknown) {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Assistant messages with no content at all (the empty answer itself) are dropped from history. */
function isEmptyAssistant(message: ModelMessage) {
  if (message.role !== "assistant") return false
  if (typeof message.content === "string") return message.content.trim() === ""
  return message.content.every((part) => part.type === "text" && part.text.trim() === "")
}

interface Outcome {
  text: string
  aborted: boolean
  failure?: unknown
}

/** Relay one streamText run as AgentEvents and report what happened. */
async function* relay(
  result: StreamTextResult<ToolSet, never>,
  registry: ToolRegistry,
  signal: AbortSignal | undefined,
  outcome: Outcome,
): AsyncGenerator<AgentEvent> {
  const started = new Map<string, number>()
  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          outcome.text += part.text
          yield { type: "text-delta", text: part.text }
          break
        case "tool-call":
          started.set(part.toolCallId, Date.now())
          yield {
            type: "tool-start",
            callId: part.toolCallId,
            name: part.toolName,
            label: label(registry, part.toolName, part.input),
            input: part.input,
          }
          break
        case "tool-result":
        case "tool-error": {
          const ok = part.type === "tool-result"
          yield {
            type: "tool-end",
            callId: part.toolCallId,
            ok,
            output: ok ? stringify(part.output) : describeError(part.error),
            durationMs: Date.now() - (started.get(part.toolCallId) ?? Date.now()),
          }
          break
        }
        case "abort":
          outcome.aborted = true
          break
        case "error":
          outcome.failure = part.error
          break
      }
    }
  } catch (error) {
    if (signal?.aborted) outcome.aborted = true
    else outcome.failure = error
  }
  if (signal?.aborted) outcome.aborted = true
}

/**
 * One user turn: stream the model, run whatever tools it calls, feed results back, repeat
 * until it stops calling tools or hits `maxSteps` (the last step is forced to answer).
 *
 * Setup problems (no provider/model/key) throw before anything is yielded. Everything after
 * that — provider errors, aborts, tool failures, empty answers — is reported as events,
 * always ending in `done` with history that is safe to send back next turn.
 */
export async function* runAgent(opts: RunOptions): AsyncGenerator<AgentEvent> {
  const target = await resolveTarget()
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
  const user: ModelMessage = { role: "user", content: opts.input }

  const supportsTools = target.provider.models[target.model]?.tool_call !== false
  const available = opts.registry.list().length > 0
  if (!supportsTools && available) yield { type: "notice", text: "Model này không hỗ trợ tool; trả lời không dùng tool." }
  const tools = supportsTools && available ? opts.registry.toToolSet() : undefined

  const model = languageModel(target.provider, target.model, target.apiKey)
  const system = systemPrompt(opts.skills, { tools: Boolean(tools) })
  let summarized = false
  const result = streamText({
    model,
    system,
    messages: [...opts.history, user],
    tools,
    stopWhen: stepCountIs(maxSteps),
    // Last allowed step: keep tools declared (some providers reject tool history otherwise)
    // but forbid calling them, so the turn always ends with an answer.
    prepareStep: ({ stepNumber, messages }) => {
      if (!tools || stepNumber < maxSteps - 1) return undefined
      summarized = true
      return { toolChoice: "none", messages: [...messages, { role: "user", content: SUMMARY_PROMPT }] }
    },
    abortSignal: opts.signal,
    maxRetries: 1,
    onError: () => {}, // errors are read from the stream
  })

  const outcome: Outcome = { text: "", aborted: false }
  yield* relay(result, opts.registry, opts.signal, outcome)

  let messages: ModelMessage[] | undefined
  if (!outcome.aborted && !outcome.failure) {
    try {
      messages = (await result.response).messages
    } catch (error) {
      outcome.failure = error
    }
  }

  // Completed, but the model said nothing: ask once more for the actual answer.
  if (messages && !outcome.text.trim()) {
    const usedTools = messages.some((m) => m.role === "tool")
    const kept = messages.filter((m) => !isEmptyAssistant(m))
    const retry = streamText({
      model,
      system,
      // The nudge is only for this request; it is not kept in history.
      messages: [...opts.history, user, ...kept, { role: "user", content: NUDGE_PROMPT }],
      tools,
      toolChoice: tools ? "none" : undefined,
      abortSignal: opts.signal,
      maxRetries: 1,
      onError: () => {},
    })
    const second: Outcome = { text: "", aborted: false }
    yield* relay(retry, opts.registry, opts.signal, second)
    outcome.aborted = second.aborted
    outcome.failure = second.failure
    outcome.text = second.text
    if (!second.aborted && !second.failure) {
      if (second.text.trim()) messages = [...kept, { role: "assistant", content: second.text }]
      else {
        yield {
          type: "notice",
          text: usedTools
            ? "Model không trả lời sau khi gọi tool (câu trả lời rỗng). Kết quả tool ở phía trên; thử hỏi lại hoặc đổi model."
            : "Model trả về câu trả lời rỗng. Thử hỏi lại hoặc đổi model.",
        }
        messages = [...kept, { role: "assistant", content: "[Không có câu trả lời]" }]
      }
    }
  }

  if (messages && !outcome.aborted && !outcome.failure) {
    if (summarized) yield { type: "notice", text: `Đã dùng hết ${maxSteps} bước gọi tool; câu trả lời là bản tổng kết.` }
    yield { type: "done", messages: [user, ...messages] }
    return
  }

  if (outcome.failure && !outcome.aborted) yield { type: "error", message: describeError(outcome.failure) }
  // Aborted or failed mid-turn: keep only plain text, so history never holds a tool call
  // without its result (providers reject that on the next request).
  const text = outcome.text
  yield { type: "done", messages: [user, { role: "assistant", content: text || (outcome.aborted ? "[Đã dừng]" : "[Lỗi]") }] }
}
