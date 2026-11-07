import { describe, expect, test } from "bun:test"
import { NOTEBOOK_COMMANDS, notebookCommandOf } from "../src/core/memory/notebook/commands"

describe("notebookCommandOf", () => {
  test("knows the four notebook commands and nothing else", () => {
    expect([...NOTEBOOK_COMMANDS]).toEqual(["nho", "luandiem", "baihoc", "quyetdinh"])
    for (const name of NOTEBOOK_COMMANDS) expect(notebookCommandOf(`/${name}`)).toBe(name)
  })

  test("ignores case, surrounding spaces and the arguments", () => {
    expect(notebookCommandOf("/NHO  Không dùng margin")).toBe("nho")
    expect(notebookCommandOf("  /LuanDiem hpg ")).toBe("luandiem")
    expect(notebookCommandOf("/quyetdinh HPG\nMua HPG\nLý do dài")).toBe("quyetdinh")
    expect(notebookCommandOf("/baihoc\tĐịnh giá")).toBe("baihoc")
  })

  test("works on text that still holds a paste chip", () => {
    expect(notebookCommandOf("/nho [Pasted text #1]")).toBe("nho")
    expect(notebookCommandOf("/nho[Pasted text #1]")).toBeUndefined()
  })

  test("anything else is not a notebook command", () => {
    for (const text of ["/memory", "/nhox", "/nho-", "Phân tích HPG", "nho Không dùng margin", "/", "", "  ", "//nho"]) {
      expect(notebookCommandOf(text)).toBeUndefined()
    }
  })
})
