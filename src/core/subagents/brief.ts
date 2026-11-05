import { z } from "zod"

/**
 * The brief the main agent hands a subagent (spawn_subagent), as typed fields rather than one
 * free-text prompt: the model fills each part and the harness lays them out the same way every
 * time. The parts follow Claude Code's Agent-tool guidance (the purpose behind the task, what is
 * already known or ruled out, concrete questions, the length wanted, how thorough to be).
 */
export const DEPTHS = ["quick", "medium", "thorough"] as const
export type Depth = (typeof DEPTHS)[number]

/** ASCII enum values for the schema (Gemini function declarations), Vietnamese in the brief. */
const DEPTH_LABEL: Record<Depth, string> = { quick: "nhanh", medium: "vừa", thorough: "rất kỹ" }

export const briefFields = {
  task: z.string().min(1).max(200).describe("Một dòng: loại việc + đối tượng, ví dụ \"Tra cứu BCTC VCB 3 quý gần nhất (chỉ đọc)\""),
  depth: z.enum(DEPTHS).optional().describe("Mức kỹ: quick (1–3 lần gọi tool), medium (mặc định), thorough (đào sâu, đối chiếu nhiều nguồn)"),
  purpose: z.string().min(1).describe("Vì sao cần và kết quả dùng để làm gì (để subagent tự quyết những chỗ không nói rõ)"),
  context: z
    .string()
    .optional()
    .describe("Số liệu, kết luận đã có (kèm nguồn, thời điểm) và những gì đã loại trừ; subagent không thấy hội thoại"),
  questions: z
    .array(z.string().min(1))
    .min(1)
    .max(10)
    .describe("Các câu hỏi/việc cụ thể cần trả lời, mỗi mục một ý. Tự hiểu vấn đề rồi giao phần việc cụ thể, đừng giao việc hiểu vấn đề"),
  scope: z.string().optional().describe("Phạm vi: mã, kỳ, nguồn ưu tiên; những gì KHÔNG cần làm"),
  output: z.string().min(1).describe("Dạng và độ dài kết quả muốn nhận, ví dụ \"≤ 10 dòng, mỗi số kèm nguồn và kỳ\""),
  done_when: z.string().optional().describe("Khi nào là xong"),
}

export type Brief = z.infer<z.ZodObject<typeof briefFields>>

const line = (label: string, text: string | undefined) => (text?.trim() ? `${label}: ${text.trim()}` : undefined)

/** The fixed layout the subagent receives; empty optional parts are left out. */
export function renderBrief(b: Brief): string {
  const task = b.task.trim().replace(/\.+$/, "")
  return [
    `${task} (mức kỹ: ${DEPTH_LABEL[b.depth ?? "medium"]}).`,
    line("Mục đích", b.purpose),
    line("Bối cảnh đã có", b.context),
    ["Việc cần làm:", ...b.questions.map((q) => `- ${q.trim()}`)].join("\n"),
    line("Phạm vi", b.scope),
    `Trả về: ${b.output.trim().replace(/\.+$/, "")}. Ghi [suy luận] cho ý không lấy từ kết quả tool.`,
    line("Xong khi", b.done_when),
  ]
    .filter(Boolean)
    .join("\n")
}
