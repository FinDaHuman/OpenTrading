/**
 * Copy to the system clipboard, the way opencode does (`clipboard.ts`): always send OSC52
 * (works in Windows Terminal, iTerm, over SSH) *and* run the OS command, because some
 * terminals ignore OSC52. On Windows that is PowerShell reading UTF-8 from stdin —
 * `clip.exe` mangles Vietnamese.
 */

export type ClipboardSpawn = (command: string[], text: string) => Promise<boolean>

const WINDOWS = [
  "powershell.exe",
  "-NonInteractive",
  "-NoProfile",
  "-Command",
  "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
]

/** The OS command that reads text on stdin into the clipboard, if there is one. */
export function clipboardCommand(platform: NodeJS.Platform = process.platform, which: (cmd: string) => string | null = Bun.which): string[] | undefined {
  if (platform === "win32") return WINDOWS
  if (platform === "darwin") return ["pbcopy"]
  if (which("wl-copy")) return ["wl-copy"]
  if (which("xclip")) return ["xclip", "-selection", "clipboard"]
  if (which("xsel")) return ["xsel", "--clipboard", "--input"]
  return undefined
}

/** Run the command with the text on stdin; true when it exits 0 within 3 s. */
export const spawnClipboard: ClipboardSpawn = async (command, text) => {
  try {
    const proc = Bun.spawn(command, { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
    proc.stdin.write(new TextEncoder().encode(text))
    await proc.stdin.end()
    const code = await Promise.race([proc.exited, new Promise<number>((r) => setTimeout(() => r(-1), 3000))])
    if (code === -1) proc.kill()
    return code === 0
  } catch {
    return false
  }
}

let spawnImpl: ClipboardSpawn = spawnClipboard

/** Tests replace the OS command so CI never starts powershell/pbcopy. */
export function setClipboardSpawn(fn: ClipboardSpawn | undefined) {
  spawnImpl = fn ?? spawnClipboard
}

/**
 * Write text to the clipboard. OSC52 goes out at once; the OS command runs in the
 * background (callers do not wait for it before telling the user).
 */
export function writeClipboard(text: string, osc52?: (text: string) => boolean) {
  const sent = osc52?.(text) ?? false
  const command = clipboardCommand()
  const native = command ? spawnImpl(command, text) : Promise.resolve(false)
  return { osc52: sent, native }
}

/** Selected screen text, cleaned for pasting: no trailing spaces, no trailing blank lines. */
export function cleanSelection(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "")
}
