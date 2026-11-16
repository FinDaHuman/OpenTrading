import { stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import type { Workspace } from "../../fs/workspace"
import type { PermissionMode } from "../../permission/mode"
import { LOCAL_SOURCE, type ToolDef } from "../types"
import { commandPrefix, criticalDelete, mentionsSensitive, readOnlyCommand, startsInterpreter } from "./command"
import { computeIntent, mathHint, mathOnlyCommand, rewriteAdvice } from "./math"
import { listingCommand } from "./read-only"
import { isUncPath, readScope } from "../../fs/path-safety"
import { realish } from "../../fs/workspace"
import { detectPython, detectShell, runShell, SPILL_CAP, type ShellInfo } from "./run"

/**
 * shell: run one command on the user's machine (a Python script that crunches a CSV, a
 * converter, git). Every call asks in ‖ and ▸ (the permission mode), with per-call scopes:
 * - `cmd:<prefix>` for one simple command: "this session" / "always" cover that prefix
 *   (`git status …`), and such a rule never matches a chained command;
 * - `cmd!<command>` for anything else (chains, pipes, interpreters): only that exact command;
 * - `outside:` (working folder outside the workspace) and `protected:` (names a key file,
 *   OpenTrading's config, login autostart): asked every time, nothing pre-approves them.
 * A recursive delete of a drive root, home, a system folder or the workspace root never runs.
 * A command that only computes numbers (math.ts) gets `math:` and runs without a prompt in
 * every mode, headless included: the model's arithmetic goes through the shell.
 */

export type ShellInput = { command: string; description?: string; timeout_ms?: number; workdir?: string }

/** How the tool error for arithmetic in a form the grammar does not take starts (eval traces count it). */
export const MATH_NEAR_MISS_PREFIX = "Lệnh này là phép tính nhưng chưa đúng dạng chỉ-toán"

export const DEFAULT_TIMEOUT_MS = 120_000
/** A listing of the workspace runs unasked (read-only.ts), so it gets a short limit. */
export const LISTING_TIMEOUT_MS = 20_000
export const MAX_TIMEOUT_MS = 600_000
/** Output beyond this goes to a file the model can page with read_file. */
export const SHELL_OUTPUT_CHARS = 30_000

/** The tool error for arithmetic the grammar does not take: why, and the form that runs unasked. */
function nearMiss(command: string, shell: ShellInfo, workdir: boolean): string | undefined {
  if (typeof command !== "string") return undefined
  // The right form in another folder: arithmetic needs none.
  if (workdir && mathOnlyCommand(command, shell)) return `${MATH_NEAR_MISS_PREFIX} vì có workdir nên chưa chạy; phép tính không cần thư mục: gọi lại không kèm workdir thì chạy ngay, không cần duyệt.`
  const miss = computeIntent(command, shell)
  if (!miss) return undefined
  return [`${MATH_NEAR_MISS_PREFIX} nên chưa chạy; viết lại đúng dạng thì chạy ngay, không cần duyệt.`, rewriteAdvice(miss, shell), mathHint(shell)].filter(Boolean).join(" ")
}

/** The file tools the shell description sends the model to instead of a command. */
const FILE_TOOLS = ["read_file", "glob_files", "grep_files", "write_file", "edit_file"]

/**
 * How to compute in ▸▸▸ bypass, for this machine. Python is named only when `detectPython` saw it run:
 * naming it "if the machine has it" sent the model to the Windows Store alias, then to a nested
 * `powershell -Command "…$x…"` whose variables the outer PowerShell erased (16/11: 22 of 33 commands
 * failed, 2.9 → 4.3 requests a turn). PowerShell already runs the command, so it is never wrapped again.
 */
function bypassMath(ps: boolean, python: string | undefined): string {
  const short = ps
    ? "Tính số: viết thẳng biểu thức PowerShell, mảng và foreach chạy được, ví dụ `$p = 48.5, 50.2, 51.8; ($p | Measure-Object -Average).Average`; lệnh đã chạy trong PowerShell nên không bọc thêm `powershell -Command`."
    : "Tính số: dùng awk, mảng và vòng lặp chạy được, ví dụ `awk 'BEGIN{ g = 128.4/112 - 1; printf \"%.15g\\n\", g*100 }'`."
  if (!python) return short
  return `${short} Phép tính nhiều bước hay trên chuỗi số có thể viết bằng Python: \`${python} -c\`${ps ? "" : " hoặc heredoc"}.`
}

/**
 * `present`: the tools the registry holds; the description names only those (a host that keeps the
 * shell but drops the file tools, like a benchmark runner, must not send the model to read_file).
 * Without it every file tool is named.
 * `mode`: with ▸▸▸ bypass (`--yolo`) nothing asks, so a command runs as written: the arithmetic
 * grammar and the rewrite hint for Python (they exist to spare the user a prompt) do not apply, and
 * saying they do kept the model off Python for series work (issue #309). Other modes: unchanged.
 */
function describe(shell: ShellInfo, present?: ReadonlySet<string>, mode?: PermissionMode, python: () => string | undefined = detectPython): string {
  const has = (name: string) => !present || present.has(name)
  const fileTools = FILE_TOOLS.filter(has)
  const ps = shell.kind === "pwsh" || shell.kind === "powershell"
  const notes = ps
    ? shell.kind === "powershell"
      ? "Shell: Windows PowerShell 5.1. Không có && và ||: nối lệnh bằng ; hoặc `if ($?) { … }`; đọc file text bằng Get-Content -Encoding UTF8; biến môi trường $env:TEN; đường dẫn có dấu cách đặt trong ngoặc kép."
      : "Shell: PowerShell 7 (pwsh). Nối lệnh bằng ; hoặc &&; biến môi trường $env:TEN; đường dẫn có dấu cách đặt trong ngoặc kép."
    : `Shell: ${shell.kind}. Nối lệnh bằng && ; đường dẫn có dấu cách đặt trong ngoặc kép.`
  return (
    "Chạy một lệnh shell trên máy người dùng, thư mục chạy mặc định là workspace; trả output (stdout và stderr) cùng mã thoát. " +
    `${notes} ` +
    "Dùng khi cần chạy chương trình: script đọc file dữ liệu hay vẽ biểu đồ ra file, chuyển đổi định dạng, cài thư viện người dùng đồng ý. " +
    (fileTools.length > 0
      ? `Không dùng khi đọc, tìm hay sửa file (dùng ${fileTools.join(", ")}), cũng không dùng cho lệnh chờ nhập từ bàn phím hay chạy mãi (server). `
      : "Không dùng cho lệnh chờ nhập từ bàn phím hay chạy mãi (server). ") +
    (mode === "bypass"
      ? `Lệnh chạy ngay như đã viết, không ai duyệt. ${bypassMath(ps, python())} Giữ đủ chữ số ở bước trung gian, chỉ làm tròn ở kết quả cuối. Ghi description ngắn cho biết lệnh làm gì. Timeout mặc định`
      : `${mathHint(shell)} ` +
        `Phép tính viết bằng Python, mảng hay vòng lặp không chạy mà trả lại dạng đúng để viết lại. Liệt kê thư mục trong workspace (ls, dir, pwd) cũng chạy ngay. Lệnh khác người dùng duyệt; ghi description ngắn để người dùng biết lệnh làm gì. Timeout mặc định`) +
    ` ${DEFAULT_TIMEOUT_MS / 1000}s, tối đa ${MAX_TIMEOUT_MS / 1000}s; output dài được lưu ra file${has("read_file") ? " để đọc tiếp bằng read_file" : ""}.`
  )
}

export function shellTool(workspace: Workspace, opts: { shell?: ShellInfo; python?: () => string | undefined } = {}): ToolDef<ShellInput> {
  const shell = opts.shell ?? detectShell()
  const python = opts.python ?? detectPython
  const cwdOf = (input: ShellInput) => (input.workdir ? workspace.resolve(input.workdir) : workspace.primary)
  // A network workdir (\\host\share, or //host/share on Windows): refused by string alone. Resolving it
  // (realpath in workspace.contains) or stat-ing it is already the SMB lookup that can leak the NTLM hash.
  const networkDir = (input: ShellInput) => {
    const raw = input.workdir
    if (typeof raw !== "string" || !raw) return undefined
    const abs = cwdOf(input)
    const windows = process.platform === "win32"
    // `\\?\UNC\host\share` and `\\.\…` too: isUncPath leaves those prefixes out on purpose.
    const device = (p: string) => /^[\\/]{2}[?.][\\/]/.test(p)
    return [raw, abs].find((p) => device(p) || (isUncPath(p) && (windows || p.startsWith("\\\\"))))
  }
  // The same answer read_file gives for a path: inside the workspace or the temp folder, and not
  // a key file, a network path or an odd Windows spelling, symlinks and junctions followed.
  // readScope first: its string checks refuse a network path before anything resolves it.
  const readable = (abs: string) => readScope(abs, workspace.env(), realish) === undefined && (workspace.contains(abs) || workspace.inScratch(abs))
  const lists = (command: string, cwd: string) => listingCommand(command, { shell, readable, resolve: (raw) => path.resolve(cwd, raw) })
  const critical = (input: ShellInput) => criticalDelete(input.command, { roots: [os.homedir(), ...workspace.roots()] })
  const def: ToolDef<ShellInput> = {
    name: "shell",
    description: describe(shell),
    descriptionFor: (present, mode) => describe(shell, present, mode, python),
    input: z.object({
      command: z.string().min(1).describe("Lệnh cần chạy"),
      description: z.string().max(200).optional().describe("Lệnh này làm gì, 5–10 từ, ví dụ: Vẽ biểu đồ giá FPT ra file PNG"),
      timeout_ms: z.number().int().min(1000).max(MAX_TIMEOUT_MS).optional().describe(`Thời gian tối đa (ms, mặc định ${DEFAULT_TIMEOUT_MS})`),
      workdir: z.string().optional().describe("Thư mục chạy lệnh (mặc định workspace)"),
    }),
    readOnly: false,
    effect: "shell",
    approvalGroup: "shell",
    // Always declared: the model's arithmetic goes through it (no tool_search request first).
    source: LOCAL_SOURCE,
    // The tool keeps its own time: the timeout kills the whole process tree, not just the wait.
    timeoutMs: MAX_TIMEOUT_MS + 15_000,
    maxOutputChars: SHELL_OUTPUT_CHARS + 2_000,
    blockFor: (input) => {
      const network = networkDir(input)
      if (network) return `workdir ${network} là đường dẫn mạng: không chạy lệnh ở đó. Chép dữ liệu vào workspace rồi chạy`
      const why = critical(input)
      return why ? `${why}. Xoá đúng thư mục con cần xoá, bằng đường dẫn cụ thể` : undefined
    },
    askFor: (input) => {
      const { command } = input as ShellInput
      if (typeof command !== "string") return undefined
      // Arithmetic only, in the workspace: runs in every mode (permission/index.ts `math:`).
      if (!(input as ShellInput).workdir && mathOnlyCommand(command, shell)) return `math:${command.trim()}`
      // Before anything resolves the folder (the gate asks askFor before blockFor refuses).
      const network = networkDir(input as ShellInput)
      if (network) return `outside:${network}`
      const cwd = cwdOf(input as ShellInput)
      // The session's temp folder is a fine place to run a script; the command still asks.
      if (!workspace.contains(cwd) && !workspace.inScratch(cwd)) return `outside:${cwd}`
      if (mentionsSensitive(command)) return `protected:${command.trim()}`
      // Lists a folder of the workspace and nothing else (read-only.ts): every mode, like `math:`.
      if (lists(command, cwd)) return `read:${command.trim()}`
      const prefix = commandPrefix(command)
      return prefix && !startsInterpreter(command) ? `cmd:${prefix}` : `cmd!${command.trim()}`
    },
    subject: (input) => input.command,
    // ▸▸: a command that only lists or prints state needs no classifier request.
    autoSafe: async (input) => typeof input.command === "string" && readOnlyCommand(input.command),
    // Arithmetic in a form the grammar does not take: say the right form (a tool error the model
    // fixes) instead of a prompt, or of a denial that tells it to stop. Only where the call would
    // have asked: a command the user already allowed (a rule, ▸▸▸) runs as written.
    rewrite: (input) => nearMiss(input.command, shell, !!input.workdir),
    async validate(input) {
      const cwd = cwdOf(input)
      try {
        if (!(await stat(cwd)).isDirectory()) return `${cwd} không phải thư mục.`
      } catch {
        return `Không có thư mục ${cwd}.`
      }
      return undefined
    },
    async preview(input) {
      const lines = input.command.split(/\r?\n/).map((text) => ({ kind: " " as const, text }))
      const note = input.description ? [{ kind: "…" as const, text: "" }, { kind: " " as const, text: `# ${input.description}` }] : []
      return { title: `trong ${cwdOf(input)} · tối đa ${Math.round((input.timeout_ms ?? DEFAULT_TIMEOUT_MS) / 1000)}s`, diff: [...lines, ...note] }
    },
    summarize: (input) => `shell ${input.description ? `${input.description} · ` : ""}${input.command.replace(/\s+/g, " ").slice(0, 80)}`,
    async execute(input, ctx) {
      const cwd = cwdOf(input)
      // A listing that ran unasked gets a short limit: it never needs long, and nobody approved it.
      const timeoutMs = lists(input.command, cwd) ? LISTING_TIMEOUT_MS : Math.min(MAX_TIMEOUT_MS, input.timeout_ms ?? DEFAULT_TIMEOUT_MS)
      // Long output goes to this file as it streams, before the memory cap drops its middle.
      const file = path.join(workspace.env().data!, "tool-output", `${ctx.callId.replace(/[^\w-]/g, "_")}.txt`)
      const result = await runShell(input.command, { cwd, timeoutMs, signal: ctx.signal, shell, spill: { file, after: SHELL_OUTPUT_CHARS } })
      const status = result.timedOut
        ? `dừng vì quá ${Math.round(timeoutMs / 1000)}s (đã giết cả các tiến trình con); lệnh chạy lâu hơn thì tăng timeout_ms, lệnh chờ nhập thì không chạy được`
        : result.aborted
          ? "đã huỷ"
          : `mã thoát ${result.exitCode ?? "?"}`
      const meta = `[${status} · ${(result.ms / 1000).toFixed(1)}s · ${cwd}]`
      const output = result.output.trimEnd()
      if (output.length <= SHELL_OUTPUT_CHARS && !result.dropped) return `${meta}\n${output || "(không có output)"}`
      // Long output: in the file as it came, head and tail here (wrap.ts cuts the middle).
      const saved = result.saved
      const where = !saved
        ? `không lưu được ra file${result.dropped ? `; phần giữa (${result.dropped} ký tự) đã mất` : ""}`
        : saved.cut
          ? `file ${saved.file} chỉ giữ ${saved.chars} ký tự đầu (giới hạn ${SPILL_CAP / 1024 / 1024} MB), phần sau không được lưu; đọc bằng read_file với offset hoặc tìm bằng grep_files`
          : `bản đầy đủ (${saved.chars} ký tự) ở ${saved.file}, đọc tiếp bằng read_file với offset hoặc tìm bằng grep_files`
      return `${meta}\n(Output dài${result.dropped ? "" : ` ${output.length} ký tự`}; ${where}.)\n${output}`
    },
  }
  return { ...def, readOnlyVariant: mathShellTool(def, shell) }
}

/**
 * shell for agents limited to read-only tools (`@chi-doc` subagents, ultradesk): arithmetic
 * only (math.ts), in the workspace. Anything else is refused at once, never put to the user.
 */
function mathShellTool(full: ToolDef<ShellInput>, shell: ShellInfo): ToolDef<ShellInput> {
  // A tool error, not a permission denial: the model should retry as arithmetic, not stop.
  const refusal = `Lệnh này không phải phép tính thuần nên không chạy (agent này chỉ dùng shell để tính số). Viết lại thành biểu thức số. ${mathHint(shell)}`
  return {
    name: "shell",
    description:
      "Máy tính: chạy một lệnh chỉ gồm phép tính số và trả kết quả. " +
      "Dùng khi: cần số tính ra từ số đã có (tỷ lệ, % thay đổi, CAGR, P/E, đổi đơn vị); gộp nhiều phép vào một lệnh. " +
      `Không dùng khi: chạy chương trình, đọc hay ghi file (bị từ chối). ${mathHint(shell)}`,
    input: z.object({
      command: z.string().min(1).describe("Biểu thức cần tính"),
      description: z.string().max(200).optional().describe("Phép tính này để làm gì, 5–10 từ"),
    }),
    readOnly: true,
    source: LOCAL_SOURCE,
    timeoutMs: 30_000,
    maxOutputChars: 4_000,
    // Arithmetic goes through the gate as `math:` (deny/ask rules apply); anything else never
    // reaches the user: execute refuses it.
    askFor: (input) => {
      const { command } = input as ShellInput
      return typeof command === "string" && mathOnlyCommand(command, shell) ? `math:${command.trim()}` : undefined
    },
    subject: (input) => input.command,
    summarize: full.summarize,
    async execute(input, ctx) {
      // Also without a gate (tests, scripts): never run anything but arithmetic.
      if (!mathOnlyCommand(input.command, shell)) throw new Error(nearMiss(input.command, shell, false) ?? refusal)
      return full.execute({ command: input.command, ...(input.description ? { description: input.description } : {}), timeout_ms: 20_000 }, ctx)
    },
  }
}

/**
 * A program caller (`--profile machine`) with nobody to approve anything: the shell becomes the
 * read-only agents' calculator (arithmetic only, a short description). Any other command would be
 * refused anyway; its longer description is only input tokens. Returns how to put it back.
 */
export function useCalculatorShell(registry: { get(name: string): ToolDef | undefined; register(def: ToolDef): void }): () => void {
  const full = registry.get("shell")
  if (!full?.readOnlyVariant) return () => {}
  registry.register(full.readOnlyVariant)
  return () => registry.register(full)
}
