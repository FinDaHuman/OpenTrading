import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { removeTempDir } from "./helpers/temp"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { OLD_TEMPLATE_EXAMPLES, ensureProfile, profileDisk, profileForPrompt, readProfile } from "../src/core/profile"

let dir = ""
let saved: string | undefined
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "ot-profile-"))
  saved = process.env.OPENTRADING_HOME
  process.env.OPENTRADING_HOME = dir
})
afterEach(async () => {
  if (saved === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = saved
  await removeTempDir(dir)
})

const file = () => path.join(dir, "INVESTOR.md")
const code = (c: string) => Object.assign(new Error(`${c}: failed`), { code: c })

/** The template the app shipped before this change, byte for byte. */
const OLD_TEMPLATE = `# Hồ sơ nhà đầu tư

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

describe("readProfile", () => {
  test("none: no file, no data folder at all", async () => {
    expect(await readProfile()).toEqual({ state: "none" })
    expect(await readProfile({ file: path.join(dir, "missing", "INVESTOR.md") })).toEqual({ state: "none" })
  })

  test("loaded: the filtered text", async () => {
    writeFileSync(file(), "# Hồ sơ\n\n## Khung đầu tư\n- Khung thời gian nắm giữ: 1–3 năm\n")
    expect(await readProfile()).toEqual({
      state: "loaded",
      text: "# Hồ sơ\n\n## Khung đầu tư\n- Khung thời gian nắm giữ: 1–3 năm",
    })
  })

  test("failed: the path is a folder", async () => {
    mkdirSync(file())
    expect(await readProfile()).toEqual({ state: "failed", file: file(), reason: "đường dẫn là thư mục, không phải file" })
  })

  test("failed: permission refused (never read as 'no profile')", async () => {
    writeFileSync(file(), "# Hồ sơ\n- Không margin")
    const read = spyOn(profileDisk, "readFile").mockImplementation(async () => {
      throw code("EACCES")
    })
    try {
      expect(await readProfile()).toEqual({ state: "failed", file: file(), reason: "không có quyền đọc file" })
    } finally {
      read.mockRestore()
    }
  })

  test("failed: not UTF-8 text", async () => {
    writeFileSync(file(), Buffer.from([0x23, 0x20, 0xff, 0xfe, 0xc3, 0x28, 0x0a]))
    expect(await readProfile()).toEqual({ state: "failed", file: file(), reason: "nội dung không phải văn bản UTF-8" })
  })

  test("a passing lock is retried: busy twice, then read", async () => {
    writeFileSync(file(), "- Không margin")
    const real = profileDisk.readFile
    let calls = 0
    const read = spyOn(profileDisk, "readFile").mockImplementation(async (f) => {
      calls++
      if (calls <= 2) throw code("EBUSY")
      return real(f)
    })
    try {
      const started = Date.now()
      expect(await readProfile()).toEqual({ state: "loaded", text: "- Không margin" })
      expect(calls).toBe(3)
      expect(Date.now() - started).toBeLessThan(1000)
    } finally {
      read.mockRestore()
    }
  })

  test("still locked after the retries: failed under a second", async () => {
    const read = spyOn(profileDisk, "readFile").mockImplementation(async () => {
      throw code("EBUSY")
    })
    try {
      const started = Date.now()
      expect(await readProfile()).toEqual({ state: "failed", file: file(), reason: "file đang bị chương trình khác giữ" })
      expect(Date.now() - started).toBeLessThan(1000)
    } finally {
      read.mockRestore()
    }
  })

  test("a read that never ends: failed within the deadline", async () => {
    const read = spyOn(profileDisk, "readFile").mockImplementation(() => new Promise(() => {}))
    try {
      const started = Date.now()
      const result = await readProfile({ deadlineMs: 80 })
      expect(Date.now() - started).toBeLessThan(1000)
      expect(result.state).toBe("failed")
      if (result.state === "failed") expect(result.reason).toContain("ổ đĩa chưa sẵn sàng")
    } finally {
      read.mockRestore()
    }
  })

  test("a byte order mark is not sent", async () => {
    writeFileSync(file(), "﻿- Không margin\r\n")
    expect(await readProfile()).toEqual({ state: "loaded", text: "- Không margin" })
  })

  test("the file on disk stays byte for byte", async () => {
    const text = `${OLD_TEMPLATE}\n- Không mua cổ phiếu ngân hàng\r\n`
    writeFileSync(file(), text)
    const before = readFileSync(file())
    await readProfile()
    expect(Buffer.compare(readFileSync(file()), before)).toBe(0)
  })
})

describe("profileForPrompt", () => {
  test("comments go: one line, several lines, one never closed", () => {
    expect(profileForPrompt("A <!-- ẩn --> B\n<!--\nnhiều\ndòng\n-->\nC")).toBe("A  B\n\nC")
    expect(profileForPrompt("A\n<!-- không đóng\nB\nC")).toBe("A")
  })

  test("all 9 old example lines go; an edited one stays; the user's own line stays", () => {
    expect(OLD_TEMPLATE_EXAMPLES).toHaveLength(9)
    for (const line of OLD_TEMPLATE_EXAMPLES) expect(OLD_TEMPLATE).toContain(line)
    const kept = profileForPrompt(
      OLD_TEMPLATE.replace("- (ví dụ: Tối đa 10% danh mục cho một mã)", "- (ví dụ: Tối đa 10% danh mục cho một mã)\n- Không mua cổ phiếu ngân hàng") +
        "\n## Khác\n- (ví dụ: Không margin.) Tôi dùng margin tối đa 10%\n",
    )!
    expect(kept).not.toContain("(ví dụ: Không margin. Không phái sinh.)")
    for (const line of OLD_TEMPLATE_EXAMPLES) expect(kept).not.toContain(line)
    expect(kept).toContain("- Không mua cổ phiếu ngân hàng")
    expect(kept).toContain("- (ví dụ: Không margin.) Tôi dùng margin tối đa 10%")
    // Sections left with nothing in them go too: an empty "## Ràng buộc" could read as "no limits".
    expect(kept).not.toContain("## Khung đầu tư")
    expect(kept).not.toContain("## Cách tôi muốn được hỗ trợ")
    expect(kept).toBe(
      "# Hồ sơ nhà đầu tư\n\n## Ràng buộc\n- Không mua cổ phiếu ngân hàng\n\n## Khác\n- (ví dụ: Không margin.) Tôi dùng margin tối đa 10%",
    )
  })

  test("CRLF and surrounding spaces still match an old example line", () => {
    const text = "## Ràng buộc\r\n  - (ví dụ: Không margin. Không phái sinh.)  \r\n- Thật\r\n"
    expect(profileForPrompt(text)).toBe("## Ràng buộc\n- Thật")
  })

  test("the untouched old template, or headings only: nothing to send", () => {
    expect(profileForPrompt(OLD_TEMPLATE)).toBeUndefined()
    expect(profileForPrompt("# Hồ sơ\n\n## A\n\n## B\n<!-- x -->\n")).toBeUndefined()
    expect(profileForPrompt("   \n")).toBeUndefined()
  })

  test("a heading keeps its parents when one of its children has content", () => {
    expect(profileForPrompt("# Hồ sơ\n## A\n### A1\n- x\n## B\n")).toBe("# Hồ sơ\n## A\n### A1\n- x")
  })
})

describe("the new template", () => {
  test("ensureProfile writes it once; untouched it sends nothing and has no '(ví dụ'", async () => {
    const first = await ensureProfile()
    expect(first).toEqual({ file: file(), created: true })
    const text = readFileSync(file(), "utf8")
    expect(text).toContain("Thêm ràng buộc bằng /nho; danh sách được quản lý trong /memory. Ràng buộc ghi ở đây không tới agent con.")
    expect(text).toContain("không được gửi cho model")
    expect(profileForPrompt(text)).toBeUndefined()
    expect(await readProfile()).toEqual({ state: "none" })
    expect(text).not.toContain("(ví dụ")

    writeFileSync(file(), "đã sửa")
    expect(await ensureProfile()).toEqual({ file: file(), created: false })
    expect(readFileSync(file(), "utf8")).toBe("đã sửa")
  })

  test("a line added under 'Khung đầu tư' goes out with its heading, no comment text", async () => {
    await ensureProfile()
    const text = readFileSync(file(), "utf8").replace("## Khung đầu tư\n", "## Khung đầu tư\n- Khung thời gian nắm giữ: 1–3 năm\n")
    writeFileSync(file(), text)
    const read = await readProfile()
    expect(read).toEqual({ state: "loaded", text: "# Hồ sơ nhà đầu tư\n\n## Khung đầu tư\n- Khung thời gian nắm giữ: 1–3 năm" })
  })
})
