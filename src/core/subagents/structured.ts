import type { z } from "zod"
import type { ToolDef } from "../tools/types"

/**
 * Structured output for a subagent, the way Claude Code's workflow agents do it: a tool the
 * agent must call once with the result as its input. Tool input is validated by the SDK on
 * every provider, so this needs no provider's JSON mode (unlike Output.object).
 */
export const RESULT_TOOL = "tra_ket_qua"

/** Turns a run may take to produce a valid result (Claude Code: MAX_STRUCTURED_OUTPUT_RETRIES 5). */
export const MAX_RESULT_ATTEMPTS = 5

/** Sent when a turn ended without a valid call; the next turn's last step forces the tool. */
export const RESULT_REMINDER =
  `Bạn chưa gọi ${RESULT_TOOL} với kết quả hợp lệ. Gọi ${RESULT_TOOL} ngay, đúng schema, với những gì đã có; ` +
  "thiếu số liệu thì ghi rõ là thiếu, không bịa."

/** The last step of a run with a schema: answer through the tool, not in prose. */
export const RESULT_LAST_STEP = `Đây là bước cuối. Gọi ${RESULT_TOOL} ngay với kết quả hiện có; thiếu gì thì ghi rõ là thiếu.`

export function resultTool(schema: z.ZodObject, sink: (data: unknown) => void): ToolDef {
  return {
    name: RESULT_TOOL,
    description:
      `Trả kết quả cuối cùng của nhiệm vụ cho bên giao việc, đúng schema. Gọi đúng một lần khi đã xong; ` +
      "sau khi gọi thì dừng, không viết thêm.",
    input: schema,
    readOnly: true,
    summarize: () => `${RESULT_TOOL}(…)`,
    async execute(input) {
      // The SDK validated the input already; parse again so defaults and transforms apply.
      const parsed = schema.safeParse(input)
      if (!parsed.success) throw new Error(`Kết quả sai schema: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(gốc)"}: ${i.message}`).join("; ")}`)
      sink(parsed.data)
      return "Đã nhận kết quả. Dừng tại đây."
    },
  }
}
