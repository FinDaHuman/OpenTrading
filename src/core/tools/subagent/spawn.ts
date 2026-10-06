import { z } from "zod"
import { runAgent } from "../../agent"
import { toolSearchTool } from "../builtin/tool-search"
import { ToolRegistry } from "../registry"
import type { ToolDef } from "../types"

/**
 * Tools a subagent never gets: itself (no recursion), tools that wait on the user or feed
 * the parent's UI, and the parent's tool_search (bound to the parent registry; the child
 * gets its own).
 */
const EXCLUDED = new Set(["spawn_subagent", "tool_search", "load_skill", "ask_user", "todo_write"])

/** The subagent's registry: the parent's read-only tools (optionally narrowed), same gate. */
export function childRegistry(parent: ToolRegistry, only?: string[]) {
  const child = new ToolRegistry()
  child.gate = parent.gate
  const allow = only && new Set(only)
  const candidates = parent.list().filter((t) => t.readOnly && !EXCLUDED.has(t.name) && (!allow || allow.has(t.name)))
  if (candidates.length === 0) throw new Error("Subagent không có tool chỉ đọc nào để dùng (danh sách tools rỗng hoặc không khớp).")
  for (const def of candidates) child.register(def)
  if (candidates.some((t) => t.deferrable)) child.register(toolSearchTool(child))
  return child
}

/**
 * opencode-style Task: run one child agent loop over read-only tools and return its final
 * text. Read-only only, so the child can neither write nor bypass an approval it has no UI
 * to show. Runs in the foreground and inherits the call's abort signal.
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
      "Giao một việc nghiên cứu cho subagent chạy độc lập rồi nhận bản tổng kết. Dùng khi cần đọc nhiều mã/nhiều nguồn mà không muốn tràn ngữ cảnh lượt chính (ví dụ định giá 3 mã, mỗi mã một subagent). Subagent chỉ dùng được tool chỉ đọc. Không dùng cho việc 1–2 lần gọi tool.",
    input: z.object({
      description: z.string().min(1).max(60).describe("Mô tả ngắn việc giao (hiện trong TUI)"),
      task: z.string().min(1).describe("Yêu cầu chi tiết cho subagent, kèm tiêu chí hoàn thành"),
      maxSteps: z.number().int().min(1).max(15).optional().describe("Số bước gọi tool tối đa (mặc định 8)"),
      tools: z.array(z.string()).optional().describe("Thu hẹp danh sách tool chỉ đọc được dùng (mặc định: mọi tool chỉ đọc)"),
    }),
    readOnly: true,
    summarize: (input) => `spawn_subagent(${input.description})`,
    async execute(input, ctx) {
      const child = childRegistry(parent, input.tools)
      const messages: { role: string; content: unknown }[] = []
      for await (const event of runAgent({
        history: [],
        input: input.task,
        skills: [],
        registry: child,
        maxSteps: input.maxSteps ?? 8,
        signal: ctx.signal,
      })) {
        if (event.type === "done") messages.push(...(event.messages as { role: string; content: unknown }[]))
      }
      const last = messages.findLast((m) => m.role === "assistant")?.content
      const text =
        typeof last === "string"
          ? last
          : Array.isArray(last)
            ? last
                .filter((p): p is { text: string } => typeof p === "object" && p !== null && "text" in p)
                .map((p) => p.text)
                .join("\n")
            : ""
      if (!text.trim()) return "(Subagent không trả lời. Hãy tự tổng kết từ dữ liệu đã có.)"
      return text
    },
  }
}
