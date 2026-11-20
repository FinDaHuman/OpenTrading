import { existsSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { NotebookEntry, NotebookGroup } from "./admin"
import { VIETNAM_OFFSET_MS } from "./render"

/**
 * The notebook as a Markdown file, for reading outside the app. It is a copy, never read back into the
 * store, and it holds the current version of each live entry only. Decisions stay out unless the user asks
 * for them on that one export: the file may later sit where the model can read it.
 */

const GROUPS: { group: NotebookGroup; name: string; folder: string }[] = [
  { group: "constraint", name: "Ràng buộc", folder: "rang-buoc" },
  { group: "style", name: "Cách trình bày", folder: "cach-trinh-bay" },
  { group: "thesis", name: "Luận điểm", folder: "luan-diem" },
  { group: "lesson", name: "Bài học", folder: "bai-hoc" },
  { group: "decision", name: "Quyết định", folder: "quyet-dinh" },
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

async function withTimeout<T>(write: () => Promise<T>): Promise<T> {
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

/** Writes the export into `dir`; "wx" refuses a file that appeared meanwhile, so nothing is overwritten. */
export async function writeNotebookExport(dir: string, text: string, at: Date): Promise<string> {
  return withTimeout(async () => {
    await mkdir(dir, { recursive: true })
    const name = exportFileName(at, (n) => existsSync(path.join(dir, n)))
    if (!name) throw new Error("đã có file xuất cùng tên trong giây này; thử lại sau một giây")
    const file = path.join(dir, name)
    await writeFile(file, text, { encoding: "utf8", flag: "wx", mode: 0o600 })
    return file
  })
}

// --- #346: a folder per group, one Markdown file per entry, an index ---

/** A file of a folder export: its path under the export's root (`/` separated) and its text. */
export interface ExportFile {
  path: string
  text: string
}

/** ASCII, lower case, `-` between words, at most 50 characters: a file name every OS and editor takes. */
export const slug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "") || "muc"

/** A YAML value: a number as is, a string in JSON's double-quoted form, which YAML reads the same. */
const yaml = (value: string | number) => (typeof value === "number" ? String(value) : JSON.stringify(value))

/** Theses by their code (one per subject), decisions by "d<id>-…", the rest by a padded id: sorted as in the app. */
const entryName = (e: NotebookEntry) => (e.group === "thesis" || e.group === "decision" ? slug(e.title) : `${String(e.id).padStart(3, "0")}-${slug(e.title)}`)

/**
 * The notebook as a folder, to read and edit by hand (#346): `README.md` lists every entry by group, and
 * each group has a folder with one file per entry. A file starts with a frontmatter (name, description,
 * type, id, version, state, created), then the same text as the single-file export. Like that file it is a
 * copy, never read back into the store: the current version of each live entry, decisions only when asked.
 */
export function renderNotebookFolder(entries: readonly NotebookEntry[], opts: { decisions: boolean; at: Date }): ExportFile[] {
  const { day, time } = vietnam(opts.at)
  const files: ExportFile[] = []
  const index = [
    "# Sổ ghi nhớ",
    "",
    `Xuất lúc ${time.slice(0, 2)}:${time.slice(2, 4)} ngày ${day.replaceAll("-", "/")} (giờ Việt Nam). ` +
      "Thư mục xuất là bản sao: sửa ở đây không đổi sổ, xoá trong sổ không xoá các file này.",
  ]
  for (const { group, name, folder } of GROUPS) {
    if (group === "decision" && !opts.decisions) continue
    index.push("", `## ${name}`, "")
    const of = entries.filter((e) => e.group === group)
    if (of.length === 0) index.push("(trống)")
    const taken = new Set<string>()
    for (const e of of) {
      let base = entryName(e)
      for (let n = 2; taken.has(base); n++) base = `${entryName(e)}-${n}`
      taken.add(base)
      const file = `${folder}/${base}.md`
      const front = [
        "---",
        `name: ${yaml(heading(e))}`,
        `description: ${yaml(e.title)}`,
        `type: ${yaml(group)}`,
        `id: ${yaml(e.id)}`,
        ...(e.version !== undefined ? [`version: ${yaml(e.version)}`] : []),
        ...(e.state ? [`state: ${yaml(e.state)}`] : []),
        `created: ${yaml(e.createdAt)}`,
        "---",
      ]
      files.push({ path: file, text: [...front, "", `# ${plain(heading(e))}`, "", plain(e.detail)].join("\n") + "\n" })
      index.push(`- [${heading(e).replace(/[[\]]/g, "\\$&")}](${file})`)
    }
  }
  return [{ path: "README.md", text: index.join("\n") + "\n" }, ...files]
}

/** so-ghi-nho-DD-MM-YYYY/; taken, then with the time; taken again, none (an existing folder is never written into). */
export const exportFolderName = (at: Date, taken: (name: string) => boolean) =>
  exportFileName(at, (name) => taken(name.replace(/\.md$/, "")))?.replace(/\.md$/, "")

/**
 * Writes a folder export into `dir`. Its root is made here, private to the user like the single file; a
 * root that appeared meanwhile is refused, never written into. A failure removes what this call wrote,
 * so a half export never passes for a whole one.
 */
export async function writeNotebookFolderExport(dir: string, files: readonly ExportFile[], at: Date): Promise<string> {
  return withTimeout(async () => {
    await mkdir(dir, { recursive: true })
    const name = exportFolderName(at, (n) => existsSync(path.join(dir, n)))
    if (!name) throw new Error("đã có thư mục xuất cùng tên trong giây này; thử lại sau một giây")
    const root = path.join(dir, name)
    // Not recursive: EEXIST when another export took the name meanwhile.
    await mkdir(root, { mode: 0o700 })
    try {
      for (const file of files) {
        const target = path.join(root, ...file.path.split("/"))
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
        await writeFile(target, file.text, { encoding: "utf8", flag: "wx", mode: 0o600 })
      }
    } catch (error) {
      await rm(root, { recursive: true, force: true }).catch(() => {})
      throw error
    }
    return root
  })
}
