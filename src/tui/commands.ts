import type { McpPromptInfo } from "../core/mcp/manager"

export interface CommandInfo {
  name: string
  args?: string
  /** Cannot run without its arguments: Enter on it in the "/" list fills "/name " and waits. */
  argsRequired?: boolean
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
  { name: "compact", args: "[hướng dẫn]", description: "Nén hội thoại: dọn kết quả tool cũ và tóm tắt phần đầu" },
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

export interface PromptArg {
  name: string
  description?: string
  required?: boolean
}

/** `<ticker> [focus]` for the suggestion list. */
export function promptUsage(args: PromptArg[]) {
  return args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(" ")
}

/**
 * Arguments for an MCP prompt typed after its slash command.
 * - `ticker=VCB focus="biên lãi"`: by name (quotes optional; a value runs until the next `name=`).
 * - `VCB biên lãi gộp`: positional, in declaration order; the last argument filled takes
 *   the rest of the line, so free text with spaces works.
 */
export function parsePromptArgs(args: PromptArg[], raw: string): { values: Record<string, string> } | { error: string } {
  const values: Record<string, string> = {}
  const text = raw.trim()
  const names = args.map((a) => a.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const named = names.length > 0 && new RegExp(`(^|\\s)(${names.join("|")})=`).test(text)
  if (named) {
    const re = new RegExp(`(?:^|\\s)(${names.join("|")})=("([^"]*)"|.*?)(?=\\s+(?:${names.join("|")})=|$)`, "g")
    for (const m of text.matchAll(re)) values[m[1]!] = (m[3] ?? m[2]!).trim()
  } else if (text) {
    const words = text.split(/\s+/)
    args.forEach((arg, i) => {
      if (i >= words.length) return
      values[arg.name] = i === args.length - 1 || i === words.length - 1 ? words.slice(i).join(" ") : words[i]!
    })
  }
  const missing = args.filter((a) => a.required && !values[a.name])
  if (missing.length > 0) return { error: `Thiếu ${missing.map((a) => a.name).join(", ")}. Cách dùng: ${promptUsage(args)}` }
  return { values }
}
