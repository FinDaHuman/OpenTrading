import { z } from "zod"
import { type AskBroker, type AskResult, formatAskResult } from "../../ask"
import type { ToolDef } from "../types"

const Option = z.object({
  label: z.string().min(1).max(60).describe("1–5 words"),
  description: z.string().max(200).optional(),
})

const Question = z.object({
  header: z.string().min(1).max(30).describe("1–2 words, e.g.: Rủi ro"),
  question: z.string().min(3).max(300),
  options: z.array(Option).min(2).max(4),
  multiSelect: z.boolean().optional(),
})

export const AskUserInput = z
  .object({ questions: z.array(Question).min(1).max(4) })
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    value.questions.forEach((q, i) => {
      if (seen.has(q.question)) ctx.addIssue({ code: "custom", path: ["questions", i, "question"], message: "Duplicate question." })
      seen.add(q.question)
      const labels = q.options.map((o) => o.label)
      if (new Set(labels).size !== labels.length) ctx.addIssue({ code: "custom", path: ["questions", i, "options"], message: "Duplicate option label." })
    })
  })

type Input = z.infer<typeof AskUserInput>

/**
 * `ask_user`: the model asks the user 1–4 multiple-choice questions. The wait happens in
 * `prepare` (before the tool's timer and lock), so thinking time never times the tool out
 * and never blocks other tools; `execute` only formats the answers.
 */
export function askUserTool(broker: AskBroker): ToolDef<Input> {
  return {
    name: "ask_user",
    description:
      "Asks the user 1–4 multiple-choice questions (2–4 options each; they can always type their own answer). Write the questions and options in Vietnamese. " +
      "Use when the user must decide: investment horizon, risk level, choosing an option. Do not use when the information is already in the profile or the conversation, or to ask permission to run a tool.",
    input: AskUserInput,
    readOnly: true,
    summarize: (input) => `Hỏi bạn ${input.questions.length} câu`,
    prepare: (input, ctx) => broker.ask(input.questions, ctx.signal, ctx.callId),
    execute: async (_input, ctx) => formatAskResult(ctx.prepared as AskResult),
  }
}
