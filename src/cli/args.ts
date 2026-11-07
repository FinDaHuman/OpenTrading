import { statSync } from "node:fs"
import path from "node:path"
import { YOLO_FLAGS } from "../core/permission/mode"

/**
 * Top-level command line, parsed without touching the TUI so the help, version and error
 * paths start instantly and work in any folder. `opentrading mcp …` keeps its own parser.
 */
export type Cli =
  | { kind: "help" }
  | { kind: "version" }
  /** Hidden: smoke test of a built binary (src/cli/self-check.ts). */
  | { kind: "self-check" }
  | { kind: "mcp"; args: string[] }
  | { kind: "update"; args: string[] }
  | { kind: "tui"; dir?: string; resume?: string; yolo?: boolean }
  /** `-p`: one turn without the TUI (src/cli/print.ts). No prompt = read stdin. */
  | { kind: "print"; prompt?: string; dir?: string; yolo?: boolean; model?: string; format: PrintFormat }
  | { kind: "error"; message: string }

export const HELP = `OpenTrading — harness AI phân tích chứng khoán Việt Nam

  opentrading [thư mục]            mở TUI; workspace = thư mục (mặc định: thư mục hiện tại)
  opentrading -c, --continue       mở lại phiên mới nhất
  opentrading -r, --resume [id]    mở lại phiên theo id (bỏ trống = mới nhất)
  opentrading --yolo               ▸▸▸ bỏ qua quyền: không hỏi trước khi ghi file/chạy lệnh
                                   (alias --dangerously-skip-permissions; hỏi xác nhận khi mở)
  opentrading -p "câu hỏi"         chạy một lượt không giao diện, in câu trả lời rồi thoát
                                   (không có câu hỏi hay "-": đọc từ stdin)
      --model provider/model       model cho lượt này (mặc định: model trong config)
      --output-format text|json    json: câu trả lời, file phiên, số request, token
      --yolo                       ở -p: chạy luôn tool ghi; không có thì tool cần duyệt bị từ chối
  opentrading mcp …                quản lý MCP server (opentrading mcp --help)
  opentrading update [--check]     cập nhật lên bản mới (opentrading update --help)
  opentrading -v, --version        phiên bản và nơi cài
  opentrading -h, --help           trợ giúp này

  Lệnh tắt: ot. Thư mục tên "mcp" hay "update" thì gõ ./mcp, ./update.
`

export type PrintFormat = "text" | "json"
const FORMATS: PrintFormat[] = ["text", "json"]

/** A `-r` value is a session id, not a folder: ids never hold a path separator or a dot. */
const looksLikeId = (arg: string) => !arg.startsWith("-") && !/[\\/.:]/.test(arg)

export function parseCli(argv: string[]): Cli {
  if (argv[0] === "mcp") return { kind: "mcp", args: argv.slice(1) }
  if (argv[0] === "update" || argv[0] === "upgrade") return { kind: "update", args: argv.slice(1) }
  if (argv[0] === "--self-check") return { kind: "self-check" }
  let dir: string | undefined
  let resume: string | undefined
  let yolo = false
  let print = false
  let prompt: string | undefined
  let model: string | undefined
  let format: PrintFormat | undefined
  /** The value after a flag, or the error to return. */
  const value = (i: number, flag: string): string | Cli => {
    const next = argv[i + 1]
    return next === undefined || next.startsWith("-") ? { kind: "error", message: `${flag} cần một giá trị. Xem: opentrading --help` } : next
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "-h" || arg === "--help") return { kind: "help" }
    if (arg === "-v" || arg === "--version") return { kind: "version" }
    if (YOLO_FLAGS.includes(arg)) {
      yolo = true
      continue
    }
    if (arg === "-p" || arg === "--print") {
      print = true
      // The next word is the question unless it is another flag; "-" (or nothing) reads stdin.
      const next = argv[i + 1]
      if (next === "-") i++
      else if (next !== undefined && !next.startsWith("-")) {
        prompt = next
        i++
      }
      continue
    }
    if (arg === "--model" || arg === "--output-format") {
      const v = value(i, arg)
      if (typeof v !== "string") return v
      i++
      if (arg === "--model") {
        if (!/^[^/]+\/.+/.test(v)) return { kind: "error", message: `--model phải có dạng provider/model (nhận "${v}").` }
        model = v
      } else {
        if (!FORMATS.includes(v as PrintFormat)) return { kind: "error", message: `--output-format chỉ nhận text hoặc json (nhận "${v}").` }
        format = v as PrintFormat
      }
      continue
    }
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
  if (print) {
    if (resume !== undefined) return { kind: "error", message: "-p luôn mở phiên mới: không dùng cùng -c/-r." }
    return { kind: "print", format: format ?? "text", ...(prompt !== undefined ? { prompt } : {}), ...(dir !== undefined ? { dir } : {}), ...(yolo ? { yolo } : {}), ...(model ? { model } : {}) }
  }
  if (model || format) return { kind: "error", message: "--model và --output-format chỉ dùng với -p." }
  return { kind: "tui", dir, resume, ...(yolo ? { yolo } : {}) }
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
