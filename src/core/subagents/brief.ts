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
  task: z.string().min(1).max(200).describe("Một dòng: loại việc + đối tượng"),
  depth: z.enum(DEPTHS).optional().describe("quick: 1–3 lần gọi tool; medium (mặc định); thorough: đối chiếu nhiều nguồn"),
  purpose: z.string().min(1).describe("Vì sao cần, kết quả dùng làm gì"),
  context: z.string().optional().describe("Số liệu, kết luận đã có (kèm nguồn, thời điểm), điều đã loại trừ"),
  questions: z.array(z.string().min(1)).min(1).max(10).describe("Câu hỏi/việc cụ thể, mỗi mục một ý"),
  scope: z.string().optional().describe("Mã, kỳ, nguồn ưu tiên; việc KHÔNG cần làm"),
  output: z.string().min(1).describe("Dạng và độ dài kết quả, ví dụ \"≤ 10 dòng, mỗi số kèm nguồn và kỳ\""),
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
