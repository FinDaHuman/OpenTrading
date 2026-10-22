import { statSync } from "node:fs"
import path from "node:path"

/**
 * Top-level command line, parsed without touching the TUI so the help, version and error
 * paths start instantly and work in any folder. `opentrading mcp …` keeps its own parser.
 */
export type Cli =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "mcp"; args: string[] }
  | { kind: "tui"; dir?: string; resume?: string }
  | { kind: "error"; message: string }

export const HELP = `OpenTrading — harness AI phân tích chứng khoán Việt Nam

  opentrading [thư mục]            mở TUI; workspace = thư mục (mặc định: thư mục hiện tại)
  opentrading -c, --continue       mở lại phiên mới nhất
  opentrading -r, --resume [id]    mở lại phiên theo id (bỏ trống = mới nhất)
  opentrading mcp …                quản lý MCP server (opentrading mcp --help)
  opentrading -v, --version        phiên bản và nơi cài
  opentrading -h, --help           trợ giúp này

  Lệnh tắt: ot. Thư mục tên "mcp" thì gõ ./mcp.
`

/** A `-r` value is a session id, not a folder: ids never hold a path separator or a dot. */
const looksLikeId = (arg: string) => !arg.startsWith("-") && !/[\\/.:]/.test(arg)

export function parseCli(argv: string[]): Cli {
  if (argv[0] === "mcp") return { kind: "mcp", args: argv.slice(1) }
  let dir: string | undefined
  let resume: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "-h" || arg === "--help") return { kind: "help" }
    if (arg === "-v" || arg === "--version") return { kind: "version" }
    if (arg === "-c" || arg === "--continue") {
      resume ??= "latest"
      continue
    }
    if (arg === "-r" || arg === "--resume") {
      const next = argv[i + 1]
      if (next !== undefined && looksLikeId(next)) {
        resume = next
        i++
      } else resume ??= "latest"
      continue
    }
    if (arg.startsWith("--resume=")) {
      resume = arg.slice("--resume=".length) || "latest"
      continue
    }
    if (arg.startsWith("-")) return { kind: "error", message: `Không có tuỳ chọn "${arg}". Xem: opentrading --help` }
    if (dir !== undefined) return { kind: "error", message: `Chỉ mở được một thư mục (nhận "${dir}" và "${arg}").` }
    dir = arg
  }
  return { kind: "tui", dir, resume }
}

/** The folder to open, resolved against `cwd` (PowerShell sets no PWD, so never read it). */
export function resolveDir(dir: string, cwd = process.cwd()): { path: string } | { error: string } {
  const target = path.resolve(cwd, dir)
  const stat = (() => {
    try {
      return statSync(target)
    } catch {
      return undefined
    }
  })()
  if (!stat) return { error: `Không có thư mục ${target}.` }
  if (!stat.isDirectory()) return { error: `${target} không phải thư mục.` }
  return { path: target }
}
