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
import { probeSandbox, sandboxDescription, sandboxedArgv, type SandboxPlan, type SandboxStatus } from "./sandbox"

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
export const MATH_NEAR_MISS_PREFIX = "This command is a calculation but not in the arithmetic-only form"

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
  if (workdir && mathOnlyCommand(command, shell)) return `${MATH_NEAR_MISS_PREFIX} because it has a workdir, so it did not run; a calculation needs no folder: call again without workdir and it runs at once, with no approval.`
  const miss = computeIntent(command, shell)
  if (!miss) return undefined
  return [`${MATH_NEAR_MISS_PREFIX}, so it did not run; rewritten in that form it runs at once, with no approval.`, rewriteAdvice(miss, shell), mathHint(shell)].filter(Boolean).join(" ")
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
    ? "Numbers: write PowerShell expressions directly; arrays and foreach work, e.g. `$p = 48.5, 50.2, 51.8; ($p | Measure-Object -Average).Average`; the command already runs in PowerShell, so never wrap it in another `powershell -Command`."
    : "Numbers: use awk; arrays and loops work, e.g. `awk 'BEGIN{ g = 128.4/112 - 1; printf \"%.15g\\n\", g*100 }'`."
  if (!python) return short
  return `${short} Multi-step calculations or work on a series of numbers can be written in Python: \`${python} -c\`${ps ? "" : " or a heredoc"}.`
}

/**
 * `present`: the tools the registry holds; the description names only those (a host that keeps the
 * shell but drops the file tools, like a benchmark runner, must not send the model to read_file).
 * Without it every file tool is named.
 * `mode`: with ▸▸▸ bypass (`--yolo`) nothing asks, so a command runs as written: the arithmetic
 * grammar and the rewrite hint for Python (they exist to spare the user a prompt) do not apply, and
 * saying they do kept the model off Python for series work (issue #309). Other modes: unchanged.
 */
function describe(shell: ShellInfo, present?: ReadonlySet<string>, mode?: PermissionMode, python: () => string | undefined = detectPython, sandboxNote = ""): string {
  const has = (name: string) => !present || present.has(name)
  const fileTools = FILE_TOOLS.filter(has)
  const ps = shell.kind === "pwsh" || shell.kind === "powershell"
  const notes = ps
    ? shell.kind === "powershell"
      ? "Shell: Windows PowerShell 5.1. There is no && or ||: chain commands with ; or `if ($?) { … }`; read text files with Get-Content -Encoding UTF8; environment variables are $env:NAME; quote paths containing spaces."
      : "Shell: PowerShell 7 (pwsh). Chain commands with ; or &&; environment variables are $env:NAME; quote paths containing spaces."
    : `Shell: ${shell.kind}. Chain commands with && ; quote paths containing spaces.`
  return (
    "Runs one shell command on the user's machine, in the workspace by default; returns the output (stdout and stderr) and the exit code. " +
    `${notes} ` +
    sandboxNote +
    "Use it to run programs: scripts that read data files or draw charts to a file, format conversion, installing libraries the user agreed to. " +
    (fileTools.length > 0
      ? `Not for reading, finding or editing files (use ${fileTools.join(", ")}), and not for commands that wait for keyboard input or run forever (servers). `
      : "Not for commands that wait for keyboard input or run forever (servers). ") +
    (mode === "bypass"
      ? `Commands run immediately as written; nobody approves them. ${bypassMath(ps, python())} Keep all digits in intermediate steps; round only the final result. Write a short description of what the command does. Default timeout`
      : `${mathHint(shell)} ` +
        `A calculation written in Python, or with arrays or loops, does not run; the reply gives the form to rewrite it in. Listing workspace directories (ls, dir, pwd) also runs at once. Any other command needs the user's approval; write a short description so the user knows what it does. Default timeout`) +
    ` ${DEFAULT_TIMEOUT_MS / 1000}s, max ${MAX_TIMEOUT_MS / 1000}s; long output is saved to a file${has("read_file") ? " to read on with read_file" : ""}.`
  )
}

export function shellTool(
  workspace: Workspace,
  opts: {
    shell?: ShellInfo
    python?: () => string | undefined
    /** The OS sandbox (sandbox.ts): on for the whole session (`--sandbox` or config `shell.sandbox`). */
    sandbox?: boolean
    /** Replaces the trial run (tests). */
    sandboxStatus?: () => SandboxStatus
  } = {},
): ToolDef<ShellInput> {
  const shell = opts.shell ?? detectShell()
  const sandboxStatus = opts.sandboxStatus ?? probeSandbox
  /**
   * Writable: the workspace folders and the temp folder (the session's scratchpad is in it).
   * Read-only on top: OpenTrading's data folder (config, sessions, memory), so a command can
   * never turn the sandbox off or rewrite permission rules, wherever the workspace is opened.
   */
  const plan = (): SandboxPlan => ({
    writable: [...workspace.roots(), os.tmpdir(), ...(process.env.OPENTRADING_TMPDIR ? [process.env.OPENTRADING_TMPDIR] : []), ...(workspace.scratch?.dir() ? [workspace.scratch.dir()!] : [])],
    readOnly: workspace.env().data ? [workspace.env().data!] : [],
  })
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
    descriptionFor: (present, mode) => describe(shell, present, mode, python, (opts.sandbox && sandboxDescription(true, sandboxStatus())) || ""),
    input: z.object({
      command: z.string().min(1).describe("Command to run"),
      description: z.string().max(200).optional().describe("What this command does, 5–10 Vietnamese words shown to the user, e.g.: Vẽ biểu đồ giá FPT ra file PNG"),
      timeout_ms: z.number().int().min(1000).max(MAX_TIMEOUT_MS).optional().describe(`Maximum time (ms, default ${DEFAULT_TIMEOUT_MS})`),
      workdir: z.string().optional().describe("Working directory (default: the workspace)"),
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
      if (network) return `workdir ${network} is a network path: commands do not run there. Copy the data into the workspace and run it there`
      const why = critical(input)
      return why ? `${why}. Delete exactly the subfolder you mean, by its specific path` : undefined
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
        if (!(await stat(cwd)).isDirectory()) return `${cwd} is not a directory.`
      } catch {
        return `No directory ${cwd}.`
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
      let wrap: ((argv: string[]) => string[]) | undefined
      if (opts.sandbox) {
        const sandbox = sandboxStatus()
        const sandboxPlan = plan()
        // Fails closed: the error is thrown before anything is spawned.
        const probe = sandboxedArgv(sandbox, sandboxPlan, [], cwd)
        if (!Array.isArray(probe)) throw new Error(probe.error)
        wrap = (argv) => sandboxedArgv(sandbox, sandboxPlan, argv, cwd) as string[]
      }
      const result = await runShell(input.command, { cwd, timeoutMs, signal: ctx.signal, shell, spill: { file, after: SHELL_OUTPUT_CHARS }, wrap })
      const status = result.timedOut
        ? `stopped after ${Math.round(timeoutMs / 1000)}s (child processes killed too); raise timeout_ms for longer commands; commands waiting for input cannot run`
        : result.aborted
          ? "cancelled"
          : `exit code ${result.exitCode ?? "?"}`
      const meta = `[${status} · ${(result.ms / 1000).toFixed(1)}s · ${cwd}]`
      const output = result.output.trimEnd()
      if (output.length <= SHELL_OUTPUT_CHARS && !result.dropped) return `${meta}\n${output || "(no output)"}`
      // Long output: in the file as it came, head and tail here (wrap.ts cuts the middle).
      const saved = result.saved
      const where = !saved
        ? `could not be saved to a file${result.dropped ? `; the middle (${result.dropped} characters) is lost` : ""}`
        : saved.cut
          ? `file ${saved.file} keeps only the first ${saved.chars} characters (limit ${SPILL_CAP / 1024 / 1024} MB), the rest was not saved; read it with read_file and offset or search it with grep_files`
          : `the full output (${saved.chars} characters) is in ${saved.file}; read on with read_file and offset or search it with grep_files`
      return `${meta}\n(Long output${result.dropped ? "" : ` of ${output.length} characters`}; ${where}.)\n${output}`
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
  const refusal = `This command is not pure arithmetic, so it did not run (this agent uses the shell only to compute numbers). Rewrite it as a numeric expression. ${mathHint(shell)}`
  return {
    name: "shell",
    description:
      "Calculator: runs one command made only of arithmetic and returns the result. " +
      "Use when: you need a figure computed from figures you have (ratios, % change, CAGR, P/E, unit conversion); put several operations in one command. " +
      `Do not use for: running programs, reading or writing files (refused). ${mathHint(shell)}`,
    input: z.object({
      command: z.string().min(1).describe("Expression to compute"),
      description: z.string().max(200).optional().describe("What this calculation is for, 5–10 Vietnamese words"),
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
