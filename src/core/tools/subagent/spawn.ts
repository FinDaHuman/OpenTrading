import { z } from "zod"
import { DEFAULT_SUBAGENT_STEPS, DEFAULT_SUBAGENT_TYPE, type SubagentManager } from "../../subagents/manager"
import { formatResult } from "../../subagents/result"
import type { ToolDef } from "../types"

export const SPAWN_SUBAGENT = "spawn_subagent"

/**
 * Model-facing guidance, after Claude Code's Agent tool prompt (tools/AgentTool/prompt.ts):
 * when to delegate, parallel calls in one step, a self-contained brief, and the result
 * being visible to the main agent only.
 */
const DESCRIPTION = [
  "Giao một việc cho subagent: một agent riêng, ngữ cảnh trống, tự gọi tool nhiều bước rồi trả về một bản báo cáo.",
  "",
  "Khi nào dùng:",
  "- Việc độc lập cần nhiều lần gọi tool hoặc đọc nhiều nguồn, mà bạn chỉ cần kết luận chứ không cần toàn bộ dữ liệu thô (giữ ngữ cảnh lượt chính gọn).",
  "- Nhiều việc song song không phụ thuộc nhau, ví dụ định giá 3 mã: mỗi mã một subagent, gọi tất cả spawn_subagent trong CÙNG một lượt để chúng chạy đồng thời.",
  "Không dùng khi: việc chỉ cần 1–2 lần gọi tool; cần hỏi lại người dùng; cần kết quả từng bước để quyết định bước sau.",
  "",
  "Viết prompt như giao việc cho một đồng nghiệp giỏi vừa bước vào phòng: subagent không thấy hội thoại, hồ sơ nhà đầu tư hay dữ liệu bạn đã lấy. Nêu rõ: mục tiêu; bối cảnh và số liệu đã có (kèm nguồn); phạm vi (mã, kỳ, nguồn ưu tiên); dạng kết quả mong muốn; khi nào là xong. Prompt cụt kiểu ra lệnh cho kết quả nông. Đừng giao việc hiểu vấn đề: tự nắm câu hỏi rồi giao phần việc cụ thể.",
  "",
  "Subagent không gọi được subagent khác, không hỏi được người dùng; tool có tác dụng ghi sẽ hỏi người dùng xác nhận. Ảnh trong kết quả tool của subagent không tới được người dùng.",
  "Kết quả trả về chỉ mình bạn thấy, người dùng không thấy: trình bày lại phần cần thiết, giữ nguồn và thời điểm; coi nó như dữ liệu từ tool (đối chiếu nếu mâu thuẫn).",
  "Nếu subagent báo lỗi hết quota (429), đừng tạo subagent mới ngay: báo người dùng.",
].join("\n")

export interface SpawnInput {
  description: string
  prompt: string
  maxSteps?: number
}

/**
 * Starts a subagent through the manager and waits for its report. It holds no lock (a
 * child's write would wait forever behind this call's read lock) and has no timeout: the
 * manager stops a child that stalls, and slot or approval waits are not runtime.
 */
export function spawnSubagentTool(manager: SubagentManager): ToolDef<SpawnInput> {
  return {
    name: SPAWN_SUBAGENT,
    description: DESCRIPTION,
    input: z.object({
      description: z.string().min(1).max(60).describe("Mô tả ngắn 3–6 từ, hiện trong giao diện (ví dụ: Định giá FPT)"),
      prompt: z.string().min(1).describe("Việc giao cho subagent: mục tiêu, bối cảnh, phạm vi, dạng kết quả, tiêu chí xong"),
      maxSteps: z
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .describe(`Số lượt gọi model tối đa của subagent (mặc định ${DEFAULT_SUBAGENT_STEPS})`),
    }),
    readOnly: true,
    unlocked: true,
    timeoutMs: 0,
    summarize: (input) => `${DEFAULT_SUBAGENT_TYPE}(${input.description})`,
    async execute(input, ctx) {
      const run = manager.start({
        description: input.description,
        prompt: input.prompt,
        maxSteps: input.maxSteps,
        parentCallId: ctx.callId,
        parentSignal: ctx.signal,
      })
      const result = await run.done
      // Claude Code: partial output is still worth returning; with nothing at all, fail.
      if (result.status === "stopped" && ctx.signal.aborted) throw new Error("Đã dừng.")
      if (result.status === "failed" && !result.text) throw new Error(`Subagent lỗi: ${result.error ?? "không rõ nguyên nhân"}`)
      return formatResult(run, result)
    },
  }
}
