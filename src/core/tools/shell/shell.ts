import { stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import type { Workspace } from "../../fs/workspace"
import { LOCAL_SOURCE, type ToolDef } from "../types"
import { commandPrefix, criticalDelete, mentionsSensitive, readOnlyCommand, startsInterpreter } from "./command"
import { mathHint, mathNearMiss, mathOnlyCommand } from "./math"
import { detectShell, runShell, SPILL_CAP, type ShellInfo } from "./run"

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
export const MAX_TIMEOUT_MS = 600_000
/** Output beyond this goes to a file the model can page with read_file. */
export const SHELL_OUTPUT_CHARS = 30_000

function describe(shell: ShellInfo): string {
  const ps = shell.kind === "pwsh" || shell.kind === "powershell"
  const notes = ps
    ? shell.kind === "powershell"
      ? "Shell: Windows PowerShell 5.1. Không có && và ||: nối lệnh bằng ; hoặc `if ($?) { … }`; đọc file text bằng Get-Content -Encoding UTF8; biến môi trường $env:TEN; đường dẫn có dấu cách đặt trong ngoặc kép."
      : "Shell: PowerShell 7 (pwsh). Nối lệnh bằng ; hoặc &&; biến môi trường $env:TEN; đường dẫn có dấu cách đặt trong ngoặc kép."
    : `Shell: ${shell.kind}. Nối lệnh bằng && ; đường dẫn có dấu cách đặt trong ngoặc kép.`
  return (
    "Chạy một lệnh shell trên máy người dùng, thư mục chạy mặc định là workspace; trả output (stdout và stderr) cùng mã thoát. " +
    `${notes} ` +
    "Dùng khi cần chạy chương trình: script Python phân tích số liệu hay vẽ biểu đồ ra file, chuyển đổi định dạng, cài thư viện người dùng đồng ý. " +
    "Không dùng khi đọc, tìm hay sửa file (dùng read_file, glob_files, grep_files, write_file, edit_file), cũng không dùng cho lệnh chờ nhập từ bàn phím hay chạy mãi (server). " +
    `${mathHint(shell)} ` +
    `Lệnh khác người dùng duyệt; ghi description ngắn để người dùng biết lệnh làm gì. Timeout mặc định ${DEFAULT_TIMEOUT_MS / 1000}s, tối đa ${MAX_TIMEOUT_MS / 1000}s; output dài được lưu ra file để đọc tiếp bằng read_file.`
  )
}

export function shellTool(workspace: Workspace, opts: { shell?: ShellInfo } = {}): ToolDef<ShellInput> {
  const shell = opts.shell ?? detectShell()
  const cwdOf = (input: ShellInput) => (input.workdir ? workspace.resolve(input.workdir) : workspace.primary)
  const critical = (input: ShellInput) => criticalDelete(input.command, { roots: [os.homedir(), ...workspace.roots()] })
  const def: ToolDef<ShellInput> = {
    name: "shell",
    description: describe(shell),
    input: z.object({
      command: z.string().min(1).describe("Lệnh cần chạy"),
      description: z.string().max(200).optional().describe("Lệnh này làm gì, 5–10 từ, ví dụ: Chạy script tính lợi suất FPT"),
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
      const why = critical(input)
      return why ? `${why}. Xoá đúng thư mục con cần xoá, bằng đường dẫn cụ thể` : undefined
    },
    askFor: (input) => {
      const { command } = input as ShellInput
      if (typeof command !== "string") return undefined
      // Arithmetic only, in the workspace: runs in every mode (permission/index.ts `math:`).
      if (!(input as ShellInput).workdir && mathOnlyCommand(command, shell)) return `math:${command.trim()}`
      const cwd = cwdOf(input as ShellInput)
      // The session's temp folder is a fine place to run a script; the command still asks.
      if (!workspace.contains(cwd) && !workspace.inScratch(cwd)) return `outside:${cwd}`
      if (mentionsSensitive(command)) return `protected:${command.trim()}`
      const prefix = commandPrefix(command)
      return prefix && !startsInterpreter(command) ? `cmd:${prefix}` : `cmd!${command.trim()}`
    },
    subject: (input) => input.command,
    // ▸▸: a command that only lists or prints state needs no classifier request.
    autoSafe: async (input) => typeof input.command === "string" && readOnlyCommand(input.command),
    async validate(input) {
      // Arithmetic in a form the grammar does not take: say the right form (a tool error the
      // model fixes), before the gate turns it into a denial that tells it to stop.
      if (mathNearMiss(input.command, shell)) return `${MATH_NEAR_MISS_PREFIX} nên chưa chạy; viết lại đúng dạng thì chạy ngay, không cần duyệt. ${mathHint(shell)}`
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
      const timeoutMs = Math.min(MAX_TIMEOUT_MS, input.timeout_ms ?? DEFAULT_TIMEOUT_MS)
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
      if (!mathOnlyCommand(input.command, shell)) throw new Error(refusal)
      return full.execute({ command: input.command, ...(input.description ? { description: input.description } : {}), timeout_ms: 20_000 }, ctx)
    },
  }
}
