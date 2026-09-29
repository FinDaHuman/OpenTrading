import { stepCountIs, streamText, type ModelMessage } from "ai"
import { describeError, resolveTarget } from "./chat"
import type { AgentEvent } from "./events"
import { systemPrompt } from "./prompt"
import { languageModel } from "./providers"
import type { Skill } from "./skills"
import type { ToolRegistry } from "./tools/registry"

export const DEFAULT_MAX_STEPS = 10

const SUMMARY_PROMPT =
  "Đã hết số lượt gọi tool cho câu hỏi này. Không gọi thêm tool. Hãy tổng kết câu trả lời dựa trên dữ liệu đã có, nói rõ phần nào còn thiếu."

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

/**
 * One user turn: stream the model, run whatever tools it calls, feed results back, repeat
 * until it stops calling tools or hits `maxSteps` (the last step is forced to answer).
 *
 * Setup problems (no provider/model/key) throw before anything is yielded. Everything after
 * that — provider errors, aborts, tool failures — is reported as events, always ending in
 * `done` with history that is safe to send back next turn.
 */
export async function* runAgent(opts: RunOptions): AsyncGenerator<AgentEvent> {
  const target = await resolveTarget()
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
  const user: ModelMessage = { role: "user", content: opts.input }

  const supportsTools = target.provider.models[target.model]?.tool_call !== false
  const available = opts.registry.list().length > 0
  if (!supportsTools && available) yield { type: "notice", text: "Model này không hỗ trợ tool; trả lời không dùng tool." }
  const tools = supportsTools && available ? opts.registry.toToolSet() : undefined

  let failure: unknown
  let summarized = false
  const result = streamText({
    model: languageModel(target.provider, target.model, target.apiKey),
    system: systemPrompt(opts.skills, { tools: Boolean(tools) }),
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
    onError: ({ error }) => {
      failure = error
    },
  })

  let text = ""
  let aborted = false
  const started = new Map<string, number>()
  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          text += part.text
          yield { type: "text-delta", text: part.text }
          break
        case "tool-call":
          started.set(part.toolCallId, Date.now())
          yield {
            type: "tool-start",
            callId: part.toolCallId,
            name: part.toolName,
            label: label(opts.registry, part.toolName, part.input),
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
          aborted = true
          break
        case "error":
          failure = part.error
          break
      }
    }
  } catch (error) {
    if (opts.signal?.aborted) aborted = true
    else failure = error
  }
  if (opts.signal?.aborted) aborted = true

  if (!aborted && !failure) {
    try {
      const response = await result.response
      if (summarized) yield { type: "notice", text: `Đã dùng hết ${maxSteps} bước gọi tool; câu trả lời là bản tổng kết.` }
      yield { type: "done", messages: [user, ...response.messages] }
      return
    } catch (error) {
      failure = error
    }
  }

  if (failure && !aborted) yield { type: "error", message: describeError(failure) }
  // Aborted or failed mid-turn: keep only plain text, so history never holds a tool call
  // without its result (providers reject that on the next request).
  yield { type: "done", messages: [user, { role: "assistant", content: text || (aborted ? "[Đã dừng]" : "[Lỗi]") }] }
}
