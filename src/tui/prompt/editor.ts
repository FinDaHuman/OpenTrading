import { readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/** Split an $EDITOR value into words, keeping "quoted parts" together (no shell involved). */
export function editorWords(value: string): string[] {
  const words: string[] = []
  for (const m of value.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) words.push(m[1] ?? m[2] ?? m[3]!)
  return words
}

/** $VISUAL, then $EDITOR, else Notepad on Windows and vi elsewhere (Claude Code, Codex). */
export function editorCommand(env = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const value = env.VISUAL?.trim() || env.EDITOR?.trim()
  return value ? editorWords(value) : [platform === "win32" ? "notepad" : "vi"]
}

/**
 * Ctrl+G: edit `text` in the user's editor. The TUI is suspended meanwhile so a terminal
 * editor gets the screen; a GUI editor (Notepad, `code --wait`) just has to be closed.
 * Returns the saved text, or an error message.
 */
export async function editInEditor(
  text: string,
  terminal: { suspend(): void; resume(): void },
): Promise<{ text: string } | { error: string }> {
  const file = path.join(os.tmpdir(), `opentrading-prompt-${process.pid}-${Date.now()}.md`)
  await writeFile(file, text, "utf8")
  const [program, ...args] = editorCommand()
  let resolved = Bun.which(program!) ?? program!
  let command = [resolved, ...args, file]
  // .cmd/.bat launchers (code.cmd) only run through cmd.exe.
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(resolved)) command = ["cmd.exe", "/d", "/c", resolved, ...args, file]
  terminal.suspend()
  try {
    const proc = Bun.spawn(command, { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
    const code = await proc.exited
    if (code !== 0) return { error: `Trình soạn thảo ${program} thoát với mã ${code}` }
    // Editors add a final line break; the prompt does not want it.
    return { text: (await readFile(file, "utf8")).replace(/\r\n?/g, "\n").replace(/\n$/, "") }
  } catch (error) {
    resolved = error instanceof Error ? error.message : String(error)
    return { error: `Không mở được trình soạn thảo ${program}: ${resolved}. Đặt biến EDITOR (ví dụ "code --wait").` }
  } finally {
    terminal.resume()
    await rm(file, { force: true })
  }
}
