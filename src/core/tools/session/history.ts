import { z } from "zod"
import { listSessions, loadSession } from "../../session/store"
import { visibleUserText } from "../../agent"
import type { ModelMessage } from "ai"
import { LOCAL_SOURCE, type ToolDef } from "../types"

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat
}

function assistantText(m: ModelMessage) {
  if (typeof m.content === "string") return m.content
  return m.content
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim()
}

/** Each user question with the last assistant text before the next question (its conclusion). */
export function turnsOf(messages: ModelMessage[]) {
  const turns: { question: string; answer: string }[] = []
  for (const m of messages) {
    if (m.role === "user") {
      const q = visibleUserText(m)
      if (q) turns.push({ question: q, answer: "" })
    } else if (m.role === "assistant" && turns.length > 0) {
      const text = assistantText(m)
      if (text) turns[turns.length - 1]!.answer = text
    }
  }
  return turns
}

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
      "Đọc lại một phiên cũ theo id: từng câu hỏi của user và kết luận đã trả lời (rút gọn). Dùng khi cần nhắc lại ngữ cảnh hoặc kết luận phiên trước.",
    input: z.object({ id: z.string().min(4).describe("Id phiên lấy từ session_list (cho phép tiền tố, ít nhất 4 ký tự)") }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input) => `session_get(${input.id})`,
    async execute(input) {
      const matches = (await listSessions()).filter((s) => s.id === input.id || s.id.startsWith(input.id))
      if (matches.length > 1 && !matches.some((s) => s.id === input.id)) {
        throw new Error(`Tiền tố "${input.id}" khớp ${matches.length} phiên: ${matches.slice(0, 5).map((s) => s.id).join(", ")}. Dùng id dài hơn.`)
      }
      const loaded = await loadSession(input.id)
      // The whole conversation (display), not just what is left after the last compaction.
      const turns = turnsOf(loaded.display).slice(-12)
      return [
        `Phiên ${loaded.summary.id} · ${loaded.summary.turns} lượt · ${loaded.summary.title} (${loaded.summary.updatedAt})`,
        ...turns.map((t, i) => `${i + 1}. Hỏi: ${clip(t.question, 200)}${t.answer ? `\n   Đáp: ${clip(t.answer, 400)}` : ""}`),
      ].join("\n")
    },
  }
  return [list, get]
}

/** Health check of this machine's harness, as opposed to the MCP server's own `doctor`. */
export function doctorLocalTool(deps: {
  mcpStatus: () => { name: string; state: string; tools: string[]; error?: string }[]
  /** The configured model id, never its key. */
  model: () => Promise<string | undefined>
  home: string
  /** Providers with a saved key (names only). */
  providers?: () => Promise<string[]>
  /** Auto skills hidden because a required tool is missing, with the missing names. */
  hiddenSkills?: () => { name: string; missing: string[] }[]
}): ToolDef<Record<string, never>> {
  return {
    name: "doctor_local",
    description:
      "Tự kiểm tra OpenTrading trên máy này: model, provider đã có key (không lộ key), thư mục dữ liệu, MCP server và số tool, skill đang bị ẩn vì thiếu tool. Dùng khi người dùng hỏi về cài đặt hoặc lỗi kết nối. Không kiểm tra nguồn dữ liệu phía server (đó là tool doctor của server).",
    input: z.object({}),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: () => "doctor_local()",
    async execute() {
      const servers = deps.mcpStatus()
      const providers = (await deps.providers?.()) ?? []
      const hidden = deps.hiddenSkills?.() ?? []
      return [
        `Model: ${(await deps.model()) ?? "chưa chọn (gõ /model)"}`,
        `Provider đã có key: ${providers.length > 0 ? providers.join(", ") : "chưa có (gõ /connect)"}`,
        `Thư mục dữ liệu: ${deps.home}${process.env.OPENTRADING_HOME ? " (từ biến OPENTRADING_HOME)" : ""}`,
        servers.length > 0 ? "MCP:" : "MCP: chưa cấu hình server nào",
        ...servers.map((s) => `- ${s.name}: ${s.state} (${s.tools.length} tool)${s.error ? ` — ${s.error.slice(0, 160)}` : ""}`),
        hidden.length > 0 ? `Skill bị ẩn (${hidden.length}) vì thiếu tool:` : "Skill: không có skill nào bị ẩn vì thiếu tool.",
        ...hidden.map((h) => `- ${h.name}: thiếu ${h.missing.join(", ")}`),
      ].join("\n")
    },
  }
}
