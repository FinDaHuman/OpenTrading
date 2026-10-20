import { describe, expect, test } from "bun:test"
import { STREAM_CURSOR, streamView } from "../src/tui/ui/stream-view"

const view = (text: string) => streamView(text, false)

describe("streamView", () => {
  test("a finished answer is shown whole", () => {
    expect(streamView("## A\n| a |\n| --- |\n", true)).toEqual({ markdown: "## A\n| a |\n| --- |", heldTableRows: 0 })
  })

  test("an unfinished prose line shows with a cursor", () => {
    expect(view("Doanh thu tăng").markdown).toBe(`Doanh thu tăng${STREAM_CURSOR}`)
    expect(view("Dòng một\nDòng hai đang").markdown).toBe(`Dòng một\nDòng hai đang${STREAM_CURSOR}`)
  })

  test("an unfinished line of block syntax waits for its newline", () => {
    for (const partial of ["## Kết lu", "#", "| Chỉ tiêu", "-", "- ", "1.", "1", "```", "``", "---", "> "]) {
      expect(view(`Mở đầu.\n${partial}`).markdown).toBe("Mở đầu.")
    }
    expect(view("## Kết luận\n").markdown).toBe("## Kết luận")
  })

  test("tokens inside an unfinished heading change nothing on screen", () => {
    const text = "Mở đầu.\n## Kết luận về triển vọng tăng trưởng của FPT"
    const shown = new Set<string>()
    for (let i = "Mở đầu.\n".length; i <= text.length; i++) shown.add(view(text.slice(0, i)).markdown)
    expect([...shown]).toEqual(["Mở đầu."])
  })

  test("list and quote items with text stream like prose", () => {
    expect(view("- Ý một dài").markdown).toBe(`- Ý một dài${STREAM_CURSOR}`)
    expect(view("2. Ý hai").markdown).toBe(`2. Ý hai${STREAM_CURSOR}`)
    expect(view("> Trích").markdown).toBe(`> Trích${STREAM_CURSOR}`)
  })

  test("an unfinished line stops before an inline marker still open", () => {
    expect(view("Mã **FPT").markdown).toBe(`Mã${STREAM_CURSOR}`)
    expect(view("Mã **FPT** tăng").markdown).toBe(`Mã **FPT** tăng${STREAM_CURSOR}`)
    expect(view("gọi `read").markdown).toBe(`gọi${STREAM_CURSOR}`)
    expect(view("rất *nhanh").markdown).toBe(`rất${STREAM_CURSOR}`)
    expect(view("**Đậm").markdown).toBe("")
    expect(view("* Ý có *nghiêng*").markdown).toBe(`* Ý có *nghiêng*${STREAM_CURSOR}`)
    expect(view("- Ý **đậm").markdown).toBe(`- Ý${STREAM_CURSOR}`)
    // Cut back to a bare marker, the item would become another block: nothing is shown.
    expect(view("Mở.\n- **Đậm").markdown).toBe("Mở.")
  })

  test("a table is held back until the line after it", () => {
    const table = "Bảng:\n\n| Chỉ tiêu | FPT |\n| --- | --- |\n| P/E | 18,2 |\n"
    expect(view(table)).toEqual({ markdown: "Bảng:", heldTableRows: 2 })
    expect(view(`${table}| P/B | 4`)).toEqual({ markdown: "Bảng:", heldTableRows: 3 })
    // A blank line or text after it ends the table: it is shown whole.
    expect(view(`${table}\n`).markdown).toBe(table.trimEnd())
    expect(view(`${table}Nhận xét`).markdown).toBe(`${table}Nhận xét${STREAM_CURSOR}`)
  })

  test("inside an open code fence the unfinished line is code", () => {
    expect(view("```ts\nconst x = 1\nconst y").markdown).toBe("```ts\nconst x = 1\nconst y")
    // The closing fence being typed is not shown as code.
    expect(view("```ts\nconst x = 1\n``").markdown).toBe("```ts\nconst x = 1")
    // Pipes in code are not a table.
    expect(view("```\n| a |\n").markdown).toBe("```\n| a |")
  })
})
