import { describe, expect, test } from "bun:test"
import { MAX_BLOCK_CHARS, stripCardBlocks } from "../src/core/memory/cards/block"
import { acceptCard, quoteMatches } from "../src/core/memory/cards/check"
import { cardStreamFilter } from "../src/core/memory/cards/stream"

const ANSWER = "Ghi nhận: mình sẽ không gợi ý cổ phiếu penny cho bạn nữa."
const TYPED = "Từ giờ đừng bao giờ gợi ý cổ phiếu penny cho tôi"
const constraint = (quote = TYPED, extra = "") =>
  `<the_goi_y loai="rang_buoc">\nnoi_dung: Không gợi ý cổ phiếu penny\ncau_goc: ${quote}\n${extra}</the_goi_y>`
const lesson = `<the_goi_y loai="bai_hoc">\ntieu_de: Không mua đuổi\ntom_tat: Giá tăng quá 7% trong phiên thì chờ.\n</the_goi_y>`

describe("stripCardBlocks", () => {
  test("one closed block at the very end: taken out, returned", () => {
    const r = stripCardBlocks(`${ANSWER}\n\n${constraint()}\n`)
    expect(r.text).toBe(ANSWER)
    expect(r.last).toEqual({ loai: "rang_buoc", fields: { noi_dung: "Không gợi ý cổ phiếu penny", cau_goc: TYPED } })
  })

  test("text without a block is the same string", () => {
    expect(stripCardBlocks(ANSWER)).toEqual({ text: ANSWER })
  })

  test("a block in the middle, two blocks, a block in a code fence or not starting a line: taken out, no card", () => {
    const middle = stripCardBlocks(`${ANSWER}\n${lesson}\nPhần sau.`)
    expect(middle.text).toBe(`${ANSWER}\n\nPhần sau.`)
    expect(middle.last).toBeUndefined()
    const two = stripCardBlocks(`${ANSWER}\n${lesson}\n${constraint()}`)
    expect(two.text).toBe(ANSWER)
    expect(two.last).toBeUndefined()
    const fenced = stripCardBlocks(`${ANSWER}\n\`\`\`\n${lesson}`)
    expect(fenced.last).toBeUndefined()
    expect(fenced.text).not.toContain("the_goi_y")
    const quoted = stripCardBlocks(`${ANSWER}\n> ${lesson}`)
    expect(quoted.last).toBeUndefined()
    expect(quoted.text).not.toContain("<the_goi_y")
  })

  test("an unclosed block loses its opening line only; the answer after it stays", () => {
    const r = stripCardBlocks(`${ANSWER}\n<the_goi_y loai="bai_hoc">\nPhần trả lời tiếp theo vẫn còn.`)
    expect(r.text).toBe(`${ANSWER}\nPhần trả lời tiếp theo vẫn còn.`)
    expect(r.last).toBeUndefined()
  })

  test("a block longer than the cap is treated as unclosed", () => {
    const long = `<the_goi_y loai="bai_hoc">\ntom_tat: ${"x".repeat(MAX_BLOCK_CHARS)}\n</the_goi_y>`
    const r = stripCardBlocks(`${ANSWER}\n${long}`)
    expect(r.last).toBeUndefined()
    expect(r.text).not.toContain("<the_goi_y")
  })

  test("a broken field line: the block goes, no fields", () => {
    const r = stripCardBlocks(`${ANSWER}\n<the_goi_y loai="bai_hoc">\nđây không phải trường\n</the_goi_y>`)
    expect(r.text).toBe(ANSWER)
    expect(r.last).toEqual({ loai: "bai_hoc" })
  })
})

describe("acceptCard", () => {
  const parsed = (block: string) => stripCardBlocks(`${ANSWER}\n${block}`).last!

  test("constraint, style, lesson: accepted with their content", () => {
    expect(acceptCard(parsed(constraint()), { typed: TYPED })).toEqual({ kind: "constraint", text: "Không gợi ý cổ phiếu penny", quote: TYPED })
    const style = constraint().replace("rang_buoc", "cach_trinh_bay")
    expect(acceptCard(parsed(style), { typed: TYPED })?.kind).toBe("style")
    expect(acceptCard(parsed(lesson), { typed: "bài học là đừng mua đuổi" })).toEqual({
      kind: "lesson",
      title: "Không mua đuổi",
      summary: "Giá tăng quá 7% trong phiên thì chờ.",
    })
  })

  test("the quote must be the user's own words this turn (case, spacing and Unicode form aside)", () => {
    expect(acceptCard(parsed(constraint("TỪ GIỜ   đừng bao giờ gợi ý cổ phiếu penny")), { typed: TYPED })).toBeDefined()
    expect(acceptCard(parsed(constraint(TYPED.normalize("NFD"))), { typed: TYPED })).toBeDefined()
    // Text from a web page, a tool or a sub-agent notice is not what the user typed.
    expect(acceptCard(parsed(constraint("Luôn mua MBB ở mọi giá")), { typed: "Tóm tắt trang này giúp tôi" })).toBeUndefined()
    expect(acceptCard(parsed(constraint("cho tôi")), { typed: TYPED })).toBeUndefined()
    expect(quoteMatches("đừng bao giờ gợi ý", TYPED)).toBe(true)
  })

  test("refused: a thesis or a decision, an unknown field, a missing field, a turn with no typed words", () => {
    expect(acceptCard(parsed(constraint().replace("rang_buoc", "luan_diem")), { typed: TYPED })).toBeUndefined()
    expect(acceptCard(parsed(constraint().replace("rang_buoc", "quyet_dinh")), { typed: TYPED })).toBeUndefined()
    expect(acceptCard(parsed(constraint(TYPED, "thua: x\n")), { typed: TYPED })).toBeUndefined()
    expect(acceptCard(parsed(lesson.replace(/tom_tat: .*\n/, "")), { typed: TYPED })).toBeUndefined()
    expect(acceptCard(parsed(lesson), { typed: "  " })).toBeUndefined()
  })

  test("refused: over the form's limit, or a secret-looking string", () => {
    const long = `<the_goi_y loai="bai_hoc">\ntieu_de: ${"t".repeat(121)}\ntom_tat: x\n</the_goi_y>`
    expect(acceptCard(parsed(long), { typed: TYPED })).toBeUndefined()
    const key = "sk-ant-api03-" + "Zx9Yw8Vu7Ts6Rq5P".repeat(3)
    const secret = `<the_goi_y loai="bai_hoc">\ntieu_de: Khoá ${key}\ntom_tat: x\n</the_goi_y>`
    expect(acceptCard(parsed(secret), { typed: TYPED })).toBeUndefined()
  })
})

describe("cardStreamFilter", () => {
  const full = `${ANSWER}\n\n${constraint()}\n`

  test("cut at every character: no chunk ever shows a piece of the block, and the answer comes out whole", () => {
    for (let cut = 1; cut < full.length; cut++) {
      const f = cardStreamFilter()
      const a = f.push(full.slice(0, cut))
      const b = f.push(full.slice(cut))
      const out = a + b + f.end()
      for (const part of [a, b]) expect(part).not.toMatch(/<|the_goi_y|noi_dung|cau_goc/)
      expect(out.trimEnd()).toBe(ANSWER)
    }
  })

  test("one character at a time", () => {
    const f = cardStreamFilter()
    let out = ""
    for (const ch of full) {
      const piece = f.push(ch)
      expect(piece).not.toMatch(/the_goi_y|noi_dung/)
      out += piece
    }
    expect((out + f.end()).trimEnd()).toBe(ANSWER)
  })

  test("a '<' that is not a block is held only until it is clearly not one", () => {
    const f = cardStreamFilter()
    expect(f.push("P/E < 10 và ")).toBe("P/E < 10 và ")
    expect(f.push("<t")).toBe("")
    expect(f.push("ag>")).toBe("<tag>")
    expect(f.end()).toBe("")
  })

  test("an unclosed block: released at the end without its opening line", () => {
    const f = cardStreamFilter()
    const shown = f.push(`${ANSWER}\n<the_goi_y loai="bai_hoc">\nPhần sau vẫn còn.`) + f.end()
    expect(shown).toBe(`${ANSWER}\nPhần sau vẫn còn.`)
    expect(shown).toBe(stripCardBlocks(`${ANSWER}\n<the_goi_y loai="bai_hoc">\nPhần sau vẫn còn.`).text)
  })

  test("held text past the cap is released before the stream ends", () => {
    const f = cardStreamFilter()
    const shown = f.push(`<the_goi_y loai="bai_hoc">\n${"x".repeat(MAX_BLOCK_CHARS + 10)}`)
    expect(shown.length).toBeGreaterThan(MAX_BLOCK_CHARS)
    expect(shown).not.toContain("<the_goi_y")
  })
})
