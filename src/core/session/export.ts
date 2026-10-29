import { existsSync, statSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { dataDir } from "../paths"
import type { LoadedSession } from "./store"
import { transcriptFromMessages } from "./transcript"

/**
 * A whole conversation as Markdown for /save (clipboard) and /export (file), in the shape of
 * opencode's `formatTranscript`: title and meta, then each turn with every tool call's input
 * and output. Built from the session file, so turns before a compaction are included and
 * tool outputs are what the model received (already capped when the tool ran).
 */

const when = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })

/** A code block that the content cannot close early: longer than any backtick run inside. */
export function fence(text: string, lang = "") {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const ticks = "`".repeat(Math.max(3, longest + 1))
  return `${ticks}${lang}\n${text.replace(/\n+$/, "")}\n${ticks}`
}

export function formatTranscript(loaded: Pick<LoadedSession, "summary" | "display">, opts: { label: (name: string, input: unknown) => string }) {
  const s = loaded.summary
  const model = s.provider && s.model ? ` · ${s.provider}/${s.model}` : ""
  const out: string[] = [
    `# ${s.title || "(không tiêu đề)"}`,
    `Phiên \`${s.id}\` · tạo ${when(s.createdAt)} · cập nhật ${when(s.updatedAt)}${model} · ${s.turns} lượt`,
    "---",
  ]
  // One "## OpenTrading" heading per answer, even when it is split by tool calls.
  let speaker: "user" | "assistant" | undefined
  const answer = () => {
    if (speaker !== "assistant") out.push("## OpenTrading")
    speaker = "assistant"
  }
  for (const item of transcriptFromMessages(loaded.display)) {
    switch (item.kind) {
      case "user":
        out.push("## Bạn", item.text.trim())
        speaker = "user"
        break
      case "assistant":
        answer()
        out.push(item.text.trim())
        break
      case "tool": {
        answer()
        const input = JSON.stringify(item.input ?? {}, null, 2)
        out.push(
          `#### ${item.ok ? "✓" : "✗"} ${opts.label(item.name, item.input)}`,
          "**Input**",
          fence(input, "json"),
          item.ok ? "**Output**" : "**Lỗi**",
          fence(item.output || "(trống)"),
        )
        break
      }
      case "compact":
        out.push("> **Đã nén hội thoại** — tóm tắt thay cho phần trước:", item.text.trim().replace(/^/gm, "> "))
        speaker = undefined
        break
      case "note":
        out.push(`> ${item.text}`)
        speaker = undefined
        break
      case "agent-notice":
        out.push(`> Subagent nền ${item.type} (${item.description}) · ${item.status} · ${item.stats}`)
        speaker = undefined
        break
    }
  }
  return out.join("\n\n") + "\n"
}

/**
 * `/export [đường dẫn] [--force]`: the path (quotes allowed, for spaces) and the flag.
 * Returns the file to write and whether an existing file may be replaced.
 */
export function resolveExportPath(args: string, ctx: { cwd: string; id: string }): { file: string; overwrite: boolean } {
  let raw = args.trim()
  const force = /(^|\s)--force$/.test(raw)
  if (force) raw = raw.replace(/(^|\s)--force$/, "").trim()
  raw = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1")
  const name = `${ctx.id}.md`
  // No path: the session's own file under the data dir; exporting again updates it.
  if (!raw) return { file: path.join(dataDir(), "exports", name), overwrite: true }
  if (raw === "~" || raw.startsWith("~/") || raw.startsWith("~\\")) raw = path.join(os.homedir(), raw.slice(1))
  let file = path.resolve(ctx.cwd, raw)
  const isDir = /[\\/]$/.test(raw) || (existsSync(file) && statSync(file).isDirectory())
  if (isDir) file = path.join(file, name)
  else if (!path.extname(file)) file += ".md"
  return { file, overwrite: force }
}

/** Write the export (UTF-8, LF), creating parent folders. Refuses to replace a file unless allowed. */
export async function writeExport(file: string, text: string, opts: { overwrite: boolean }) {
  if (!opts.overwrite && existsSync(file)) throw new Error(`File đã tồn tại: ${file}. Thêm --force để ghi đè.`)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, text, "utf8")
}
