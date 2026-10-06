import { z } from "zod"
import { runAgent } from "../../agent"
import { ToolRegistry } from "../registry"
import type { ToolDef } from "../types"

/**
 * Subagent kiểu opencode Task: chạy 1 vòng agent con với bộ tool thu hẹp,
 * trả về text tổng kết. Không đệ quy (tool này bị loại khỏi tập con).
 * Không background ở bản này: chạy foreground, kế thừa abort signal của lượt gọi.
 */
export function spawnSubagentTool(parent: ToolRegistry): ToolDef<{
  description: string
  task: string
  maxSteps?: number
  tools?: string[]
}> {
  return {
    name: "spawn_subagent",
    description:
      "Giao việc cho 1 subagent chạy độc lập rồi nhận kết quả tổng kết. Dùng khi cần nghiên cứu song song nhiều mã/nhiều nguồn mà không muốn tràn context lượt chính (VD: định giá 3 mã cùng lúc, mỗi mã 1 subagent). Subagent chỉ thấy tools được liệt kê (mặc định: tools đọc). Không dùng cho việc đơn giản 1-2 calls.",
    input: z.object({
      description: z.string().min(1).max(60).describe("Mô tả ngắn việc giao (hiện trong TUI)"),
      task: z.string().min(1).describe("Yêu cầu chi tiết cho subagent, kèm tiêu chí xong"),
      maxSteps: z.number().int().min(1).max(15).optional().describe("Số bước tool tối đa (mặc định 8)"),
      tools: z.array(z.string()).optional().describe("Tên tools cho phép (mặc định: tools readOnly). Không được gồm spawn_subagent."),
    }),
    readOnly: true,
    summarize: (input) => `spawn_subagent(${(input as { description: string }).description})`,
    async execute(input, ctx) {
      const child = new ToolRegistry()
      const allowlist = input.tools?.filter((t) => t !== "spawn_subagent")
      const candidates = parent
        .list()
        .filter((t) => t.name !== "spawn_subagent")
        .filter((t) => (allowlist ? allowlist.includes(t.name) : t.readOnly))
      if (candidates.length === 0)
        throw new Error("Subagent không có tool nào khả dụng (allowlist rỗng hoặc toàn tool ghi).")
      for (const def of candidates) child.register(def)
      let text = ""
      const messages: { role: string; content: unknown }[] = []
      for await (const event of runAgent({
        history: [],
        input: input.task,
        skills: [],
        registry: child,
        maxSteps: input.maxSteps ?? 8,
        signal: ctx.signal,
      })) {
        if (event.type === "done") {
          for (const m of event.messages as { role: string; content: unknown }[]) messages.push(m)
        }
      }
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")
      if (lastAssistant) {
        const c = lastAssistant.content
        text =
          typeof c === "string"
            ? c
            : Array.isArray(c)
              ? c
                  .filter((p) => typeof p === "object" && p !== null && "text" in p)
                  .map((p) => (p as { text: string }).text)
                  .join("\n")
              : ""
      }
      if (!text.trim()) return "[Subagent không trả lời. Hãy tự tổng kết từ dữ liệu đã có.]"
      return text.length > 12000 ? text.slice(0, 12000) + "\n[… subagent output đã cắt bớt]" : text
    },
  }
}
