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
  { name: "effort", args: "[auto|low…max]", description: "Effort suy luận: phiên chính, subagent, ultradesk (ctrl+t đổi nhanh)" },
  { name: "skills", description: "Danh sách skill; bật / tắt skill cho cả phiên" },
  { name: "agents", description: "Các loại subagent (có sẵn, người dùng, dự án) và tool của từng loại" },
  { name: "tasks", description: "Subagent của phiên này: đang chạy, đã xong; xem kết quả, dừng" },
  { name: "desk", args: "[on|off|resume <run>]", description: "Ultradesk: xem các run nhiều agent; bật/tắt cho cả phiên; chạy tiếp run bị cắt" },
  { name: "skill", args: "<tên>", description: "Bật / tắt một skill cho cả phiên" },
  { name: "watchlist", args: "[tên]", description: "Watchlist cá nhân: xem giá; new|add|rm|rename|del để sửa" },
  { name: "profile", description: "Mở hồ sơ nhà đầu tư (INVESTOR.md)" },
  { name: "context", description: "Xem các tầng ngữ cảnh gửi cho model và số token" },
  { name: "mcp", description: "Trạng thái MCP server, cho phép / kết nối lại" },
  { name: "tools", description: "Liệt kê mọi tool model đang gọi được" },
  { name: "sessions", description: "Mở lại một phiên trước" },
  { name: "new", description: "Bắt đầu phiên mới" },
  { name: "compact", args: "[hướng dẫn]", description: "Nén hội thoại: dọn kết quả tool cũ và tóm tắt phần đầu" },
  { name: "save", description: "Copy toàn bộ hội thoại (Markdown) vào clipboard" },
  { name: "export", args: "[đường dẫn]", description: "Lưu hội thoại ra file .md (mặc định ~/.opentrading/exports)" },
  { name: "add-dir", args: "[thư mục] [--luu]", description: "Thêm thư mục vào workspace (nơi agent đọc/ghi file); không tham số: xem workspace" },
  { name: "scratch", args: "[clear [all]]", description: "Thư mục tạm của phiên: đường dẫn, dung lượng; clear xoá các phiên khác" },
  { name: "undo", args: "[số] [--force]", description: "Hoàn tác thay đổi file do agent ghi (write_file/edit_file); không tham số: xem danh sách" },
  { name: "permissions", description: "Chế độ quyền, workspace và các quy tắc cho phép/chặn; xoá quy tắc" },
  { name: "memory", description: "Xem, duyệt, xoá memory" },
  { name: "config", description: "Cài đặt: bật / tắt memory…" },
  { name: "clear", description: "Xoá màn hình và bắt đầu phiên mới" },
  { name: "help", description: "Xem lệnh và phím tắt" },
  { name: "exit", description: "Thoát OpenTrading" },
]

/** The built-in commands with the playbook commands right after /desk (so /exit stays last). */
export function withPlaybooks(commands: CommandInfo[], playbooks: CommandInfo[]): CommandInfo[] {
  const at = commands.findIndex((c) => c.name === "desk")
  return at < 0 ? [...commands, ...playbooks] : [...commands.slice(0, at + 1), ...playbooks, ...commands.slice(at + 1)]
}

export function parseCommand(input: string): { name: string; args: string } | undefined {
  // Arguments may span lines (a pasted report for /kiem-chung, a long /compact instruction).
  const match = input.trim().match(/^\/(\S+)\s*([\s\S]*)$/)
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
