import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { dataDir } from "./paths"

/**
 * INVESTOR.md — the user's own, human-written profile (HarnessPlan §4.3), the OpenTrading
 * counterpart of CLAUDE.md / AGENTS.md. Rides the static system prompt (cache-marked),
 * re-read per request so edits apply next turn. Kept separate from agent-written memory.
 */
export const profileFile = () => path.join(dataDir(), "INVESTOR.md")

export async function loadProfile(): Promise<string | undefined> {
  const text = await readFile(profileFile(), "utf8").catch(() => undefined)
  return text?.trim() || undefined
}

const TEMPLATE = `# Hồ sơ nhà đầu tư

<!-- OpenTrading đọc file này ở mỗi lượt hỏi. Xoá các dòng không đúng với bạn, sửa theo ý mình. -->

## Khung đầu tư
- Chân dung: (ví dụ: NĐT cá nhân, nghề chính không phải tài chính)
- Khung thời gian nắm giữ: (ví dụ: 6–24 tháng, không lướt sóng)
- Triết lý: (ví dụ: tăng trưởng ở mức giá hợp lý, ưu tiên ROE > 15%)

## Ràng buộc
- (ví dụ: Không margin. Không phái sinh.)
- (ví dụ: Tránh ngành: bất động sản nghỉ dưỡng)
- (ví dụ: Tối đa 10% danh mục cho một mã)

## Cách tôi muốn được hỗ trợ
- (ví dụ: Luôn nêu bear case trước bull case.)
- (ví dụ: Khi tôi hỏi về mã đang nắm, giả định tôi đang thiên vị và nói thẳng.)
- (ví dụ: Không dùng "nên mua" / "nên bán"; trình bày kịch bản và điều kiện.)
`

/** Create the template if missing. Returns the path and whether it was just created. */
export async function ensureProfile(): Promise<{ file: string; created: boolean }> {
  const file = profileFile()
  if (existsSync(file)) return { file, created: false }
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, TEMPLATE, "utf8")
  return { file, created: true }
}
