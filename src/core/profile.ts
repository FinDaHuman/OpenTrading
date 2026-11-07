import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { DEADLINE_MS, diskReason, errorCode, isPassingCode, ReadTimeout, timedRead, timeoutReason } from "./memory/binding/timed-read"
import { dataDir } from "./paths"

/**
 * INVESTOR.md — the user's own, human-written profile (HarnessPlan §4.3), the OpenTrading
 * counterpart of CLAUDE.md / AGENTS.md. Rides the static system prompt (cache-marked),
 * re-read per request so edits apply next turn. Kept separate from agent-written memory.
 *
 * "No file" and "could not read the file" are different answers: a profile that failed to read
 * must never reach the model as "this user has no limits", so the turn is held instead (agent.ts).
 * The app writes this file only when /profile creates the template.
 */
export const profileFile = () => path.join(dataDir(), "INVESTOR.md")

export type ProfileRead =
  | { state: "none" }
  /** Filtered by profileForPrompt, not yet escaped. */
  | { state: "loaded"; text: string }
  | { state: "failed"; file: string; reason: string }

/** Test seam (spyOn): the one disk read. */
export const profileDisk = {
  readFile: (file: string): Promise<Uint8Array> => readFile(file),
}

class Undecodable extends Error {}

function reasonOf(error: unknown, deadlineMs: number) {
  if (error instanceof ReadTimeout) return timeoutReason(deadlineMs)
  if (error instanceof Undecodable) return "nội dung không phải văn bản UTF-8"
  return diskReason(error)
}

async function readOnce(file: string): Promise<ProfileRead> {
  let bytes: Uint8Array
  try {
    bytes = await profileDisk.readFile(file)
  } catch (error) {
    const code = errorCode(error)
    if (code === "ENOENT" || code === "ENOTDIR") return { state: "none" }
    throw error
  }
  let text: string
  try {
    // fatal: a file that is not UTF-8 is an error, not text with replacement characters. The BOM is dropped.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new Undecodable()
  }
  const kept = profileForPrompt(text)
  return kept === undefined ? { state: "none" } : { state: "loaded", text: kept }
}

export async function readProfile(
  opts: { file?: string; deadlineMs?: number; retryWindowMs?: number } = {},
): Promise<ProfileRead> {
  const file = opts.file ?? profileFile()
  const deadlineMs = opts.deadlineMs ?? DEADLINE_MS
  try {
    return await timedRead(() => readOnce(file), { passing: isPassingCode, deadlineMs, retryWindowMs: opts.retryWindowMs })
  } catch (error) {
    return { state: "failed", file, reason: reasonOf(error, deadlineMs) }
  }
}

/** The 9 example lines of the template shipped before examples moved into comments. Never edit. */
export const OLD_TEMPLATE_EXAMPLES: readonly string[] = Object.freeze([
  "- Chân dung: (ví dụ: NĐT cá nhân, nghề chính không phải tài chính)",
  "- Khung thời gian nắm giữ: (ví dụ: 6–24 tháng, không lướt sóng)",
  "- Triết lý: (ví dụ: tăng trưởng ở mức giá hợp lý, ưu tiên ROE > 15%)",
  "- (ví dụ: Không margin. Không phái sinh.)",
  "- (ví dụ: Tránh ngành: bất động sản nghỉ dưỡng)",
  "- (ví dụ: Tối đa 10% danh mục cho một mã)",
  "- (ví dụ: Luôn nêu bear case trước bull case.)",
  "- (ví dụ: Khi tôi hỏi về mã đang nắm, giả định tôi đang thiên vị và nói thẳng.)",
  '- (ví dụ: Không dùng "nên mua" / "nên bán"; trình bày kịch bản và điều kiện.)',
])

const HEADING = /^(#{1,6})\s/

/**
 * What of INVESTOR.md goes to the model: comments out (an unclosed one runs to the end, as Markdown
 * previews show it), lines equal to an old template example out (an edited one is the user's and stays),
 * then headings left with nothing under them out: an empty "## Ràng buộc" could read as "no limits".
 * Undefined when only headings would be left.
 */
export function profileForPrompt(raw: string): string | undefined {
  let text = raw.replace(/^﻿/, "").replace(/<!--[\s\S]*?-->/g, "")
  const open = text.indexOf("<!--")
  if (open >= 0) text = text.slice(0, open)
  const examples = new Set(OLD_TEMPLATE_EXAMPLES)
  const lines = text.split(/\r?\n/).filter((line) => !examples.has(line.trim()))

  // A heading stays when some content line comes before the next heading of the same or a higher level.
  const level = (line: string) => HEADING.exec(line)?.[1]!.length
  const keep = lines.map((line, i) => {
    const own = level(line)
    if (own === undefined) return line.trim() !== ""
    for (let j = i + 1; j < lines.length; j++) {
      const next = level(lines[j]!)
      if (next !== undefined && next <= own) return false
      if (next === undefined && lines[j]!.trim() !== "") return true
    }
    return false
  })
  if (!keep.some((k, i) => k && level(lines[i]!) === undefined)) return undefined

  // Blank lines stay as separators; runs of them (left by what was dropped) shrink to one.
  return lines
    .flatMap((line, i) => (keep[i] ? [line] : line.trim() === "" ? [""] : []))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const TEMPLATE = `# Hồ sơ nhà đầu tư

<!--
OpenTrading đọc file này ở mỗi lượt hỏi. Viết mỗi ý một dòng dưới đúng mục, sửa theo ý mình.
Chữ nằm trong khối chú thích (như khối này) không được gửi cho model; mục chỉ có chú thích thì được bỏ qua.
-->

## Khung đầu tư
<!--
Ví dụ:
- Chân dung: NĐT cá nhân, nghề chính không phải tài chính
- Khung thời gian nắm giữ: 6–24 tháng, không lướt sóng
- Triết lý: tăng trưởng ở mức giá hợp lý, ưu tiên ROE trên 15%
-->

## Ràng buộc
<!-- Thêm ràng buộc bằng /nho; danh sách được quản lý trong /memory. Ràng buộc ghi ở đây không tới agent con. -->

## Cách tôi muốn được hỗ trợ
<!--
Ví dụ:
- Luôn nêu bear case trước bull case.
- Khi tôi hỏi về mã đang nắm, giả định tôi đang thiên vị và nói thẳng.
- Không dùng "nên mua" / "nên bán"; trình bày kịch bản và điều kiện.
-->
`

/** Create the template if missing. Returns the path and whether it was just created. */
export async function ensureProfile(): Promise<{ file: string; created: boolean }> {
  const file = profileFile()
  if (existsSync(file)) return { file, created: false }
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, TEMPLATE, "utf8")
  return { file, created: true }
}
