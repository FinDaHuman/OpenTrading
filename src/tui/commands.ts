import type { McpPromptInfo } from "../core/mcp/manager"

export interface CommandInfo {
  name: string
  args?: string
  description: string
}

export const COMMANDS: CommandInfo[] = [
  { name: "connect", description: "Nhập API key (Groq, Gemini, NVIDIA và 200+ provider khác)" },
  { name: "model", description: "Chọn model từ mọi provider đã kết nối" },
  { name: "skills", description: "Danh sách skill; bật / tắt skill cho cả phiên" },
  { name: "skill", args: "<tên>", description: "Bật / tắt một skill cho cả phiên" },
  { name: "profile", description: "Mở hồ sơ nhà đầu tư (INVESTOR.md)" },
  { name: "context", description: "Xem các tầng ngữ cảnh gửi cho model và số token" },
  { name: "mcp", description: "Trạng thái MCP server, cho phép / kết nối lại" },
  { name: "mcp-setup", description: "Kết nối MCP-server công ty (dán TEAM_TOKEN lần đầu)" },
  { name: "tools", description: "Liệt kê mọi tool model đang gọi được" },
  { name: "sessions", description: "Mở lại một phiên trước" },
  { name: "new", description: "Bắt đầu phiên mới" },
  { name: "memory", description: "Xem, duyệt, xoá memory" },
  { name: "config", description: "Cài đặt: bật / tắt memory…" },
  { name: "clear", description: "Xoá màn hình và bắt đầu phiên mới" },
  { name: "help", description: "Xem lệnh và phím tắt" },
  { name: "exit", description: "Thoát OpenTrading" },
]

/** MCP prompt workflows become slash commands, like opencode maps them. */
export function promptCommands(prompts: (McpPromptInfo & { server: string })[]): CommandInfo[] {
  return prompts.map((p) => {
    const args = (p.arguments ?? []).filter((a) => a.required)
    return {
      name: p.name,
      args: args.length > 0 ? args.map((a) => a.name).join(" ") : undefined,
      description: `${p.server} · ${(p.description ?? "workflow từ MCP server").split("\n")[0]!.slice(0, 60)}`,
    }
  })
}

/** Fill a prompt's arguments from the typed string: `symbol=VCB` pairs or positional. */
export function fillPromptArgs(
  promptArgs: { name: string }[] | undefined,
  input: string,
): Record<string, string> | string {
  const text = input.trim()
  if (!promptArgs || promptArgs.length === 0) return text ? `${text} là tham số thừa — prompt này không nhận tham số.` : {}
  if (!text) return `Thiếu tham số: ${promptArgs.map((a) => a.name).join(", ")}.`
  const named = [...text.matchAll(/([a-zA-Z_]+)=("([^"]*)"|\S+)/g)]
  if (named.length > 0) {
    const filled: Record<string, string> = {}
    for (const match of named) filled[match[1]!] = match[3] ?? match[2]!
    const missing = promptArgs.filter((a) => !(a.name in filled))
    if (missing.length > 0) return `Thiếu tham số: ${missing.map((a) => a.name).join(", ")}.`
    return filled
  }
  const parts = text.split(/\s+/)
  if (parts.length < promptArgs.length) return `Thiếu tham số: cần ${promptArgs.length} (${promptArgs.map((a) => a.name).join(", ")}).`
  return Object.fromEntries(promptArgs.map((a, i) => [a.name, parts[i]!]))
}

export function parseCommand(input: string): { name: string; args: string } | undefined {
  const match = input.trim().match(/^\/(\S+)\s*(.*)$/)
  if (!match) return undefined
  return { name: match[1]!.toLowerCase(), args: match[2]!.trim() }
}
