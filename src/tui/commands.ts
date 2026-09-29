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
  { name: "tools", description: "Liệt kê mọi tool model đang gọi được" },
  { name: "sessions", description: "Mở lại một phiên trước" },
  { name: "new", description: "Bắt đầu phiên mới" },
  { name: "memory", description: "Xem, duyệt, xoá memory" },
  { name: "clear", description: "Xoá màn hình và bắt đầu phiên mới" },
  { name: "help", description: "Xem lệnh và phím tắt" },
  { name: "exit", description: "Thoát OpenTrading" },
]

export function parseCommand(input: string): { name: string; args: string } | undefined {
  const match = input.trim().match(/^\/(\S+)\s*(.*)$/)
  if (!match) return undefined
  return { name: match[1]!.toLowerCase(), args: match[2]!.trim() }
}
