import { afterEach, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { cleanSelection, clipboardCommand, setClipboardSpawn, writeClipboard } from "../src/tui/clipboard"

afterEach(() => setClipboardSpawn(undefined))

test("clipboard command per OS: PowerShell (UTF-8 stdin, never clip.exe), pbcopy, wl-copy/xclip/xsel", () => {
  const win = clipboardCommand("win32")!
  expect(win[0]).toBe("powershell.exe")
  expect(win.join(" ")).toContain("[Console]::InputEncoding = [System.Text.Encoding]::UTF8")
  expect(win.join(" ")).toContain("Set-Clipboard")
  expect(win.join(" ")).not.toContain("clip.exe")
  expect(clipboardCommand("darwin")).toEqual(["pbcopy"])
  expect(clipboardCommand("linux", (c) => (c === "wl-copy" ? "/usr/bin/wl-copy" : null))).toEqual(["wl-copy"])
  expect(clipboardCommand("linux", (c) => (c === "xclip" ? "/usr/bin/xclip" : null))).toEqual(["xclip", "-selection", "clipboard"])
  expect(clipboardCommand("linux", () => null)).toBeUndefined()
})

test("writeClipboard: text over maxOsc52 skips OSC52 but still reaches the OS command, with its timeout", async () => {
  const seen: { text: string; timeoutMs?: number }[] = []
  setClipboardSpawn(async (_command, text, timeoutMs) => {
    seen.push({ text, timeoutMs })
    return true
  })
  const osc: string[] = []
  const big = "x".repeat(101)
  const result = writeClipboard(big, (t) => (osc.push(t), true), { maxOsc52: 100, timeoutMs: 15_000 })
  expect(result.osc52).toBe(false)
  expect(osc).toEqual([])
  if (clipboardCommand()) {
    expect(await result.native).toBe(true)
    expect(seen).toEqual([{ text: big, timeoutMs: 15_000 }])
  }
  // At or under the cap, OSC52 goes out as before.
  expect(writeClipboard("x".repeat(100), (t) => (osc.push(t), true), { maxOsc52: 100 }).osc52).toBe(true)
})

test("writeClipboard sends OSC52 and hands the exact text (Vietnamese intact) to the OS command", async () => {
  const seen: { command: string[]; text: string }[] = []
  setClipboardSpawn(async (command, text) => {
    seen.push({ command, text })
    return true
  })
  const osc: string[] = []
  const text = "Giá VCB: 87.500 đ (+1,2%)"
  const result = writeClipboard(text, (t) => {
    osc.push(t)
    return true
  })
  expect(result.osc52).toBe(true)
  expect(osc).toEqual([text])
  if (clipboardCommand()) {
    expect(await result.native).toBe(true)
    expect(seen[0]!.text).toBe(text)
  }
})

test("copied text is cleaned: no trailing spaces on any line, no trailing blank lines", () => {
  expect(cleanSelection("Xin chào!   \nT+2.5 là chu kỳ   \n\n\n")).toBe("Xin chào!\nT+2.5 là chu kỳ")
  expect(cleanSelection("a\r\nb  ")).toBe("a\nb")
})

/** Emoji-presentation or font-fragile glyphs: Windows Terminal draws ⚠ in colour, two cells wide. */
const BANNED = ["⚠", "✔", "↗", "☐", "☒", "✎", "⌕", "◯"]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

test("the TUI uses no emoji-prone glyphs", () => {
  const offenders: string[] = []
  for (const file of files(path.join(import.meta.dir, "../src/tui"))) {
    const text = readFileSync(file, "utf8")
    for (const glyph of BANNED) if (text.includes(glyph)) offenders.push(`${path.basename(file)}: ${glyph}`)
  }
  expect(offenders).toEqual([])
})
