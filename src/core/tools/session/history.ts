import { z } from "zod"
import { listSessions, loadSession } from "../../session/store"
import { visibleUserText } from "../../agent"
import type { ToolDef } from "../types"

/**
 * WS3-A: phiên local thay cho runs_list/run_get của MCP-server.
 * Đọc ~/.opentrading/sessions (của chính user này) thay vì data/runs.jsonl
 * share trên server — đúng layer, không trộn runs giữa các user.
 */
export function sessionHistoryTools(): ToolDef[] {
  const list: ToolDef<{ limit?: number }> = {
    name: "session_list",
    description:
      "Liệt kê các phiên hội thoại đã lưu trên máy này (mới nhất trước). Dùng khi user hỏi lại phiên cũ. Không dùng cho dữ liệu thị trường (đó là MCP tools).",
    input: z.object({ limit: z.number().int().min(1).max(30).optional().describe("Số phiên (mặc định 10)") }),
    readOnly: true,
    summarize: () => "session_list()",
    async execute(input) {
      const all = await listSessions()
      const rows = all.slice(0, input.limit ?? 10).map((s) => ({
        id: s.id,
        title: s.title,
        turns: s.turns,
        updatedAt: s.updatedAt,
        model: s.model,
      }))
      if (rows.length === 0) return "Chưa có phiên nào được lưu."
      return rows.map((r) => `- ${r.id} · ${r.turns} lượt · ${r.title} (${r.updatedAt})`).join("\n")
    },
  }
  const get: ToolDef<{ id: string }> = {
    name: "session_get",
    description:
      "Đọc tóm tắt một phiên cũ theo id (câu hỏi user từng hỏi). Dùng khi cần nhắc lại ngữ cảnh phiên trước.",
    input: z.object({ id: z.string().describe("Id phiên (cho phép tiền tố)") }),
    readOnly: true,
    summarize: (input) => `session_get(${(input as { id: string }).id})`,
    async execute(input) {
      const loaded = await loadSession(input.id)
      const questions = loaded.messages
        .filter((m) => m.role === "user")
        .map((m) => visibleUserText(m))
        .filter(Boolean)
        .slice(-10)
      return [
        `Phiên ${loaded.summary.id} · ${loaded.summary.turns} lượt · ${loaded.summary.title}`,
        ...questions.map((q, i) => `${i + 1}. ${q.slice(0, 160)}`),
      ].join("\n")
    },
  }
  return [list, get]
}

/** WS3-A: doctor của harness (máy này) — phân biệt với doctor của MCP-server. */
export function doctorLocalTool(deps: {
  mcpStatus: () => { name: string; state: string; tools: string[] }[]
  modelInfo: () => string
}): ToolDef<Record<string, never>> {
  return {
    name: "doctor_local",
    description:
      "Tự kiểm tra harness trên máy này: model đã chọn, MCP servers nào đã kết nối (bao nhiêu tools), thư mục dữ liệu. Dùng khi debug setup. Không kiểm tra env của MCP-server (đó là tool doctor phía server).",
    input: z.object({}),
    readOnly: true,
    summarize: () => "doctor_local()",
    async execute() {
      const servers = deps.mcpStatus()
      const lines = [
        `Model: ${deps.modelInfo()}`,
        ...servers.map((s) => `- MCP ${s.name}: ${s.state} (${s.tools.length} tools)`),
      ]
      return lines.join("\n")
    },
  }
}
