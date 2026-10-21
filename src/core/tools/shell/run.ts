/**
 * Running one shell command: which shell, how output comes back, how a timeout or Esc stops
 * it. Windows uses PowerShell (pwsh, else Windows PowerShell 5.1, which every machine has);
 * elsewhere bash, else sh (opencode core/src/shell.ts, codex shell_detect.rs). The command
 * goes to PowerShell as -EncodedCommand (UTF-16 base64), so quotes and Vietnamese text reach
 * it unchanged, and console output is switched to UTF-8 first.
 */

import { mkdirSync } from "node:fs"
import path from "node:path"
import type { FileSink } from "bun"

export interface ShellInfo {
  kind: "pwsh" | "powershell" | "bash" | "sh"
  path: string
}

let cached: ShellInfo | undefined

export function detectShell(platform: NodeJS.Platform = process.platform): ShellInfo {
  if (cached && platform === process.platform) return cached
  let info: ShellInfo
  if (platform === "win32") {
    const pwsh = Bun.which("pwsh")
    info = pwsh ? { kind: "pwsh", path: pwsh } : { kind: "powershell", path: Bun.which("powershell") ?? "powershell.exe" }
  } else {
    const bash = Bun.which("bash")
    info = bash ? { kind: "bash", path: bash } : { kind: "sh", path: "/bin/sh" }
  }
  if (platform === process.platform) cached = info
  return info
}

/**
 * The PowerShell wrapper. With a redirected stderr, Windows PowerShell writes errors (and
 * progress) as CLIXML, so the command runs in a script block with its error stream merged
 * into stdout and each error record printed as one "LỖI: …" line; progress is off; tables
 * become text at 200 columns. Exit code: the last native program's, else 1 after an error.
 */
function psScript(command: string) {
  return [
    "$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Continue'",
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$OutputEncoding=[System.Text.Encoding]::UTF8",
    "$__otErr = $false",
    "& {",
    command,
    '} 2>&1 | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { $__otErr = $true; "LỖI: " + $_.ToString() } else { $_ } } | Out-String -Stream -Width 200',
    "if ($LASTEXITCODE) { exit $LASTEXITCODE } elseif ($__otErr) { exit 1 }",
  ].join("\n")
}

export function shellArgs(shell: ShellInfo, command: string): string[] {
  if (shell.kind === "pwsh" || shell.kind === "powershell") {
    const encoded = Buffer.from(psScript(command), "utf16le").toString("base64")
    return [shell.path, "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded]
  }
  return [shell.path, "-c", command]
}

export interface RunResult {
  /** stdout and stderr in the order they arrived. */
  output: string
  exitCode: number | null
  timedOut: boolean
  aborted: boolean
  ms: number
  /** Characters dropped from the middle of `output` (memory cap). */
  dropped: number
  /** The spill file, when output passed `spill.after`: every character as it came, unless `cut`. */
  saved?: { file: string; chars: number; cut: boolean }
}

/** Kill the process and everything it started. */
async function killTree(pid: number) {
  if (process.platform === "win32") {
    try {
      await Bun.spawn(["taskkill", "/pid", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" }).exited
    } catch {
      // already gone
    }
    return
  }
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    // not a group leader or already gone
  }
  await new Promise((r) => setTimeout(r, 1500))
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    // gone
  }
}

/** Names that hold keys and tokens (GOOGLE_GENERATIVE_AI_API_KEY, GITHUB_TOKEN, AWS_SECRET_ACCESS_KEY…). */
const SECRET_ENV = /(API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)(_|$)|^OPENTRADING_/i

/** The parent's environment without secrets. */
export function childEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !SECRET_ENV.test(k)) out[k] = v
  return out
}

/** Collected output is capped in memory: past this, the middle is dropped. */
const MEMORY_CAP = 4 * 1024 * 1024
/** A runaway command must not fill the disk: the spill file stops here. */
export const SPILL_CAP = 64 * 1024 * 1024

export async function runShell(
  command: string,
  opts: {
    cwd: string
    timeoutMs: number
    signal: AbortSignal
    shell?: ShellInfo
    env?: Record<string, string>
    /** Past `after` characters, stream everything (from the first byte) to `file`, before the memory cap cuts the middle. */
    spill?: { file: string; after: number }
  },
): Promise<RunResult> {
  const shell = opts.shell ?? detectShell()
  const started = Date.now()
  const proc = Bun.spawn(shellArgs(shell, command), {
    cwd: opts.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    // Python prints Vietnamese as UTF-8 even on a Windows console code page. Provider keys
    // set as environment variables stay out of the child: `printenv` would put them in the
    // transcript the model provider receives.
    env: { ...childEnv(process.env), PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", ...opts.env },
    windowsHide: true,
    // POSIX: its own process group, so a timeout kills the children too.
    detached: process.platform !== "win32",
  })
  // The first half of the cap is kept as it came, then a rolling tail: a long build log keeps
  // its start and its end, and memory stays bounded.
  let head = ""
  let tail = ""
  let dropped = 0
  // The spill file opens once output passes `spill.after` (well under MEMORY_CAP / 2, so
  // nothing is dropped yet) with all that came so far, then takes every chunk.
  let total = 0
  let sink: FileSink | undefined
  let spillTried = false
  let saved: RunResult["saved"]
  const spill = (text: string) => {
    if (!saved || saved.cut || !sink) return
    const room = SPILL_CAP - saved.chars
    const part = text.length > room ? text.slice(0, room) : text
    try {
      sink.write(part)
      saved.chars += part.length
      if (part.length < text.length) saved.cut = true
    } catch {
      saved = undefined
    }
  }
  const append = (raw: string) => {
    let text = raw.replace(/\r\n/g, "\n")
    total += text.length
    if (opts.spill && !spillTried && total > opts.spill.after) {
      spillTried = true
      try {
        mkdirSync(path.dirname(opts.spill.file), { recursive: true })
        sink = Bun.file(opts.spill.file).writer()
        saved = { file: opts.spill.file, chars: 0, cut: false }
        spill(head + tail)
      } catch {
        sink = undefined
      }
    }
    spill(text)
    if (head.length < MEMORY_CAP / 2) {
      const room = MEMORY_CAP / 2 - head.length
      head += text.slice(0, room)
      text = text.slice(room)
    }
    tail += text
    if (tail.length > MEMORY_CAP / 2) {
      dropped += tail.length - MEMORY_CAP / 2
      tail = tail.slice(tail.length - MEMORY_CAP / 2)
    }
  }
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder("utf-8")
    const reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      append(decoder.decode(value, { stream: true }))
    }
    append(decoder.decode())
  }
  let timedOut = false
  let aborted = false
  const stop = (why: "timeout" | "abort") => {
    if (why === "timeout") timedOut = true
    else aborted = true
    void killTree(proc.pid)
  }
  const timer = setTimeout(() => stop("timeout"), opts.timeoutMs)
  const onAbort = () => stop("abort")
  if (opts.signal.aborted) onAbort()
  else opts.signal.addEventListener("abort", onAbort, { once: true })
  try {
    await Promise.all([pump(proc.stdout), pump(proc.stderr), proc.exited])
  } finally {
    clearTimeout(timer)
    opts.signal.removeEventListener("abort", onAbort)
    try {
      await sink?.end()
    } catch {
      saved = undefined
    }
  }
  const output = dropped > 0 ? `${head}\n[... đã bỏ ${dropped} ký tự ở giữa ...]\n${tail}` : head + tail
  // Chunks are normalised as they come; a \r\n split across two chunks is joined here.
  return { output: output.replace(/\r\n/g, "\n"), exitCode: proc.exitCode, timedOut, aborted, ms: Date.now() - started, dropped, ...(saved ? { saved } : {}) }
}
