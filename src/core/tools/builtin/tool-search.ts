import { z } from "zod"
import type { ToolRegistry } from "../registry"
import { LOADED_PREFIX, describeTool, resolveToolName, scoreTools } from "../search"
import type { ToolDef } from "../types"

export const TOOL_SEARCH = "tool_search"
const DEFAULT_RESULTS = 5
const MAX_RESULTS = 20

/**
 * Loads deferred tools on demand. The result starts with `Đã nạp tool: …`, which the agent
 * loop reads back from history to make those tools callable (from the next step on, and in
 * later turns and resumed sessions).
 */
export function toolSearchTool(registry: ToolRegistry, pending: () => string[] = () => []): ToolDef<{ query: string; max_results?: number }> {
  return {
    name: TOOL_SEARCH,
    description: [
      "Tìm và nạp các tool đang hoãn (liệt kê theo tên trong <tool_hoan>). Tool hoãn chưa có schema nên phải nạp trước khi gọi; nạp xong thì gọi được ngay như tool bình thường.",
      'Cách viết query: "select:ten_a,ten_b" để nạp đúng các tool đã biết tên — gộp mọi tool sẽ cần vào một lần gọi thay vì gọi tool_search nhiều lần; hoặc từ khoá như "gia lich su co phieu"; "+tu" bắt buộc khớp từ đó; "mcp__server" lấy tool của một server. Mô tả tool thường viết bằng tiếng Anh, nên thêm từ khoá tiếng Anh (ví dụ "price history", "foreign flow").',
      "Kết quả gồm mô tả và tham số của từng tool đã nạp.",
    ].join(" "),
    input: z.object({
      query: z.string().describe('Ví dụ "select:vn_quote_history,market_snapshot" hoặc "dong tien khoi ngoai"'),
      max_results: z.number().int().min(1).max(MAX_RESULTS).optional().describe(`Số tool tối đa (mặc định ${DEFAULT_RESULTS})`),
    }),
    readOnly: true,
    summarize: (input) => `tool_search ${input.query}`,
    async execute({ query, max_results }) {
      const limit = Math.min(max_results ?? DEFAULT_RESULTS, MAX_RESULTS)
      const candidates = registry.list().filter((d) => d.deferrable)
      const q = query.trim()
      let found: ToolDef[] = []
      const notes: string[] = []

      if (q.toLowerCase().startsWith("select:")) {
        for (const raw of q.slice("select:".length).split(",").map((s) => s.trim()).filter(Boolean)) {
          const names = resolveToolName(registry, raw)
          if (names.length === 1) found.push(registry.get(names[0]!)!)
          else if (names.length > 1) notes.push(`"${raw}" khớp nhiều tool: ${names.join(", ")} — ghi rõ server/tên.`)
          else notes.push(`Không có tool "${raw}".`)
        }
      } else if (/^mcp__[A-Za-z0-9_-]+$/.test(q)) {
        const prefix = q.endsWith("__") ? q : `${q}__`
        found = candidates.filter((d) => d.name.startsWith(prefix)).slice(0, limit)
      } else {
        // Loading is permanent for the session: keep only hits close to the best one, so a
        // search does not drag in every tool that merely mentions a word.
        const hits = scoreTools(registry, candidates, q)
        const floor = (hits[0]?.score ?? 0) / 2
        found = hits
          .filter((h) => h.score >= floor)
          .slice(0, limit)
          .map((h) => h.def)
      }
      found = [...new Map(found.map((d) => [d.name, d])).values()]

      if (found.length === 0) {
        const servers = new Map<string, number>()
        for (const d of candidates) servers.set(d.source ?? "?", (servers.get(d.source ?? "?") ?? 0) + 1)
        const list = [...servers].map(([s, n]) => `${s.replace(/^mcp:/, "")} (${n} tool)`).join(", ")
        const waiting = pending()
        return [
          `Không tìm thấy tool khớp "${q}".`,
          ...notes,
          list ? `Các server có tool hoãn: ${list}. Thử từ khoá khác hoặc "mcp__<server>" để xem tool của một server.` : "Không có tool hoãn nào.",
          waiting.length > 0 ? `Server đang kết nối (thử lại sau): ${waiting.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join("\n")
      }
      return [
        LOADED_PREFIX + found.map((d) => d.name).join(", "),
        ...notes,
        "",
        ...found.map((d) => describeTool(registry, d)),
      ].join("\n")
    },
  }
}
