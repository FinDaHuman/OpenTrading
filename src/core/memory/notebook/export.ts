import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { NotebookEntry, NotebookGroup } from "./admin"
import { VIETNAM_OFFSET_MS } from "./render"

/**
 * The notebook as a Markdown file, for reading outside the app. It is a copy, never read back into the
 * store, and it holds the current version of each live entry only. Decisions stay out unless the user asks
 * for them on that one export: the file may later sit where the model can read it.
 */

const GROUPS: { group: NotebookGroup; name: string }[] = [
  { group: "constraint", name: "Ràng buộc" },
  { group: "style", name: "Cách trình bày" },
  { group: "thesis", name: "Luận điểm" },
  { group: "lesson", name: "Bài học" },
  { group: "decision", name: "Quyết định" },
]

const vietnam = (at: Date) => {
  const iso = new Date(at.getTime() + VIETNAM_OFFSET_MS).toISOString()
  return { day: `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`, time: iso.slice(11, 19).replaceAll(":", "") }
}

const heading = (e: NotebookEntry) =>
  e.group === "decision" ? e.title : e.group === "thesis" ? `${e.title} · bản ${e.version}` : `#${e.id} · bản ${e.version}`

/** A stored line that starts like Markdown structure ("# …", "> …") is shown as text, not as a heading. */
const plain = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/^(\s*)([#>])/, "$1\\$2"))
    .join("\n")

export function renderNotebookMarkdown(entries: readonly NotebookEntry[], opts: { decisions: boolean; at: Date }): string {
  const { day, time } = vietnam(opts.at)
  const out = [
    "# Sổ ghi nhớ",
    "",
    `Xuất lúc ${time.slice(0, 2)}:${time.slice(2, 4)} ngày ${day.replaceAll("-", "/")} (giờ Việt Nam). ` +
      "File xuất là bản sao; xoá trong sổ không xoá file này.",
  ]
  for (const { group, name } of GROUPS) {
    if (group === "decision" && !opts.decisions) continue
    out.push("", `## ${name}`)
    const of = entries.filter((e) => e.group === group)
    if (of.length === 0) out.push("", "(trống)")
    for (const e of of) out.push("", `### ${heading(e)}`, "", plain(e.detail))
  }
  return out.join("\n") + "\n"
}

/** so-ghi-nho-DD-MM-YYYY.md; taken, then with the time; taken again, none (an existing file is never replaced). */
export function exportFileName(at: Date, taken: (name: string) => boolean): string | undefined {
  const { day, time } = vietnam(at)
  return [`so-ghi-nho-${day}.md`, `so-ghi-nho-${day}-${time}.md`].find((name) => !taken(name))
}

const WRITE_TIMEOUT_MS = 5_000

/** Writes the export into `dir`; "wx" refuses a file that appeared meanwhile, so nothing is overwritten. */
export async function writeNotebookExport(dir: string, text: string, at: Date): Promise<string> {
  const write = async () => {
    await mkdir(dir, { recursive: true })
    const name = exportFileName(at, (n) => existsSync(path.join(dir, n)))
    if (!name) throw new Error("đã có file xuất cùng tên trong giây này; thử lại sau một giây")
    const file = path.join(dir, name)
    await writeFile(file, text, { encoding: "utf8", flag: "wx", mode: 0o600 })
    return file
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`ghi file quá ${WRITE_TIMEOUT_MS / 1000} giây`)), WRITE_TIMEOUT_MS)
  })
  try {
    return await Promise.race([write(), timeout])
  } finally {
    clearTimeout(timer)
  }
}
