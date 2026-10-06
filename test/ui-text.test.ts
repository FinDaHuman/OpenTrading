import { expect, test } from "bun:test"
import { fold, pad, rank, truncate, width } from "../src/tui/ui/text"

test("truncate cuts to terminal cells with …, keeping Vietnamese accents intact", () => {
  expect(truncate("Trả về ngày giờ hiện tại", 100)).toBe("Trả về ngày giờ hiện tại")
  expect(truncate("Trả về ngày giờ hiện tại", 10)).toBe("Trả về ng…")
  expect(width(truncate("Trả về ngày giờ hiện tại", 10))).toBeLessThanOrEqual(10)
  // NFD (macOS paste): base letter + combining marks must stay together and count as one cell.
  const nfd = "Tiếng Việt có dấu".normalize("NFD")
  const cut = truncate(nfd, 8)
  expect(width(cut)).toBeLessThanOrEqual(8)
  expect(cut.normalize("NFC").startsWith("Tiếng")).toBe(true)
  expect(truncate("a\n  b\tc", 10)).toBe("a b c")
  expect(pad("ab", 5)).toBe("ab   ")
})

test("rank: exact, then prefix (shorter first), substring, in-order letters, description; accent-insensitive", () => {
  const cmds = [
    { name: "connect", d: "Nhập API key" },
    { name: "config", d: "Cài đặt" },
    { name: "context", d: "Xem ngữ cảnh" },
    { name: "model", d: "Chọn model" },
    { name: "mcp", d: "Quản lý MCP server" },
    { name: "skills", d: "Danh sách skill phân tích" },
  ]
  const names = (q: string) => rank(cmds, q, (c) => c.name, (c) => c.d).map((c) => c.name)
  expect(names("")).toEqual(cmds.map((c) => c.name))
  expect(names("con")).toEqual(["config", "connect", "context"])
  expect(names("model")[0]).toBe("model")
  expect(names("mdl")).toEqual(["model"])
  expect(names("phan tich")).toEqual(["skills"]) // description text, accents ignored
  expect(names("phan")).toEqual(["skills"])
  expect(names("quan")).toEqual(["mcp"])
  expect(fold("Đồng hồ phiên")).toBe("dong ho phien")
})
