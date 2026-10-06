import { z } from "zod"
import { listSessions, loadSession } from "../../session/store"
import { visibleUserText } from "../../agent"
import { LOCAL_SOURCE, type ToolDef } from "../types"

/**
 * This user's saved sessions (~/.opentrading/sessions), the local counterpart of the MCP
 * server's shared run log: past conversations never mix between users.
 */
export function sessionHistoryTools(): ToolDef[] {
  const list: ToolDef<{ limit?: number }> = {
    name: "session_list",
    description:
      "Liệt kê các phiên hội thoại đã lưu trên máy này (mới nhất trước). Dùng khi user hỏi lại phiên cũ. Không dùng cho dữ liệu thị trường (đó là MCP tools).",
    input: z.object({ limit: z.number().int().min(1).max(30).optional().describe("Số phiên (mặc định 10)") }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
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
    input: z.object({ id: z.string().min(4).describe("Id phiên lấy từ session_list (cho phép tiền tố, ít nhất 4 ký tự)") }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input) => `session_get(${input.id})`,
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

/** Health check of this machine's harness, as opposed to the MCP server's own `doctor`. */
export function doctorLocalTool(deps: {
  mcpStatus: () => { name: string; state: string; tools: string[] }[]
  /** The configured model id, never its key. */
  model: () => Promise<string | undefined>
  home: string
}): ToolDef<Record<string, never>> {
  return {
    name: "doctor_local",
    description:
      "Tự kiểm tra OpenTrading trên máy này: model đã chọn, thư mục dữ liệu, các MCP server và số tool của từng server. Dùng khi người dùng hỏi về cài đặt hoặc lỗi kết nối. Không kiểm tra nguồn dữ liệu phía server (đó là tool doctor của server).",
    input: z.object({}),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: () => "doctor_local()",
    async execute() {
      const servers = deps.mcpStatus()
      return [
        `Model: ${(await deps.model()) ?? "chưa chọn (gõ /model)"}`,
        `Thư mục dữ liệu: ${deps.home}`,
        servers.length > 0 ? "MCP:" : "MCP: chưa cấu hình server nào",
        ...servers.map((s) => `- ${s.name}: ${s.state} (${s.tools.length} tool)`),
      ].join("\n")
    },
  }
}
