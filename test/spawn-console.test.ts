import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

// #353: a helper the TUI starts (powershell.exe for the clipboard or an image) must get its own hidden
// console. Sharing the TUI's, it reset a conhost window's code page and title mid-session. The one
// exception is the external editor, which is meant to take over the terminal.
const ROOT = path.join(import.meta.dir, "..", "src", "tui")
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []))

test("every Bun.spawn in the TUI hides the child's console (windowsHide), except the editor's", () => {
  const missing: string[] = []
  for (const file of files(ROOT)) {
    if (path.basename(file) === "editor.ts") continue
    const text = readFileSync(file, "utf8")
    for (const m of text.matchAll(/Bun\.spawn\(/g)) {
      const call = text.slice(m.index, text.indexOf("\n", text.indexOf("})", m.index)))
      if (!call.includes("windowsHide: true")) missing.push(`${path.relative(ROOT, file)}:${text.slice(0, m.index).split("\n").length}`)
    }
  }
  expect(missing).toEqual([])
})
