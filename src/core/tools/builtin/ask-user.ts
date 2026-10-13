import { z } from "zod"
import { type AskBroker, type AskResult, formatAskResult } from "../../ask"
import type { ToolDef } from "../types"

const Option = z.object({
  label: z.string().min(1).max(60).describe("Nhãn ngắn của lựa chọn (1–5 từ)"),
  description: z.string().max(200).optional().describe("Giải thích ngắn lựa chọn này nghĩa là gì"),
})

const Question = z.object({
  header: z.string().min(1).max(30).describe("Nhãn rất ngắn cho tab, 1–2 từ, ví dụ: Thời hạn, Rủi ro"),
  question: z.string().min(3).max(300).describe("Câu hỏi đầy đủ, kết thúc bằng dấu ?"),
  options: z.array(Option).min(2).max(4).describe("2–4 lựa chọn rõ ràng, loại trừ nhau (trừ khi multiSelect)"),
  multiSelect: z.boolean().optional().describe("true nếu người dùng được chọn nhiều đáp án"),
})

export const AskUserInput = z
  .object({ questions: z.array(Question).min(1).max(4) })
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    value.questions.forEach((q, i) => {
      if (seen.has(q.question)) ctx.addIssue({ code: "custom", path: ["questions", i, "question"], message: "Câu hỏi bị trùng." })
      seen.add(q.question)
      const labels = q.options.map((o) => o.label)
      if (new Set(labels).size !== labels.length) ctx.addIssue({ code: "custom", path: ["questions", i, "options"], message: "Nhãn lựa chọn bị trùng." })
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
      "Hỏi người dùng 1–4 câu trắc nghiệm khi thiếu thông tin để làm đúng việc (ví dụ: khung thời gian đầu tư, mức chấp nhận rủi ro, mã nào trong danh sách). Mỗi câu 2–4 lựa chọn ngắn, rõ ràng (ĐÚNG: 2–4 options; SAI: 1 lựa chọn duy nhất); người dùng luôn có thể tự nhập câu trả lời khác. Thông tin mang tính thủ tục/kỹ thuật (chọn mã mẫu để so sánh, thu hẹp danh sách, khung dữ liệu) thì KHÔNG hỏi — tự chọn phương án hợp lý nhất, ghi rõ giả định ở đầu câu trả lời rồi làm tiếp. Chỉ hỏi khi lựa chọn làm đổi ý nghĩa kết quả với người dùng. Không hỏi lại điều đã có trong hồ sơ nhà đầu tư hoặc đã nói trong cuộc trò chuyện. Không dùng để xin phép chạy tool (harness tự hỏi).",
    input: AskUserInput,
    readOnly: true,
    summarize: (input) => `Hỏi bạn ${input.questions.length} câu`,
    prepare: (input, ctx) => broker.ask(input.questions, ctx.signal, ctx.callId),
    execute: async (_input, ctx) => formatAskResult(ctx.prepared as AskResult),
  }
}
