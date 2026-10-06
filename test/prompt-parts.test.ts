import { expect, test } from "bun:test"
import { imagePath, sniffImage } from "../src/tui/prompt/image"
import { imageLabel, isLargePaste, offsetSlice, offsetWidth, pasteLabel } from "../src/tui/prompt/parts"

test("paste pills: Claude Code's threshold and labels", () => {
  expect(isLargePaste("a".repeat(800))).toBe(false)
  expect(isLargePaste("a".repeat(801))).toBe(true)
  expect(isLargePaste("1\n2\n3")).toBe(false) // two line breaks
  expect(isLargePaste("1\n2\n3\n4")).toBe(true)
  expect(pasteLabel(4, "x".repeat(900))).toBe("[Pasted text #4]")
  expect(pasteLabel(4, Array.from({ length: 50 }, () => "x").join("\n"))).toBe("[Pasted text #4 +49 lines]")
  expect(imageLabel(5)).toBe("[Image #5]")
})

test("textarea offsets: wide characters take two cells, a line break one", () => {
  const text = "Giá 漢字\n[Pasted text #1] x"
  expect(offsetWidth("漢字")).toBe(4)
  expect(offsetWidth("a\nb")).toBe(3)
  const start = offsetWidth("Giá 漢字\n")
  expect(offsetSlice(text, start, start + offsetWidth("[Pasted text #1]"))).toBe("[Pasted text #1]")
  expect(offsetSlice(text, 0, start)).toBe("Giá 漢字\n")
})

test("image paths: quotes, file:// URLs, escaped spaces; not relative paths or other files", () => {
  expect(imagePath('"C:\\Users\\a\\Pictures\\chart 1.png"', "win32")).toBe("C:\\Users\\a\\Pictures\\chart 1.png")
  expect(imagePath("& 'C:\\a\\b.JPG'", "win32")).toBe("C:\\a\\b.JPG")
  expect(imagePath("file:///C:/a/b%20c.webp", "win32")).toBe("C:/a/b c.webp")
  expect(imagePath("/home/u/my\\ chart.png", "linux")).toBe("/home/u/my chart.png")
  expect(imagePath("chart.png", "linux")).toBeUndefined()
  expect(imagePath("/home/u/notes.txt", "linux")).toBeUndefined()
  expect(imagePath("/a.png\n/b.png", "linux")).toBeUndefined()
})

test("image type comes from the bytes", () => {
  expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe("image/png")
  expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
  expect(sniffImage(new TextEncoder().encode("GIF89a"))).toBe("image/gif")
  expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp")
  expect(sniffImage(new TextEncoder().encode("hello"))).toBeUndefined()
})
