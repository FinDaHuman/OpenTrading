import { z } from "zod"
import { findResult, REF_PREFIX } from "../refs"
import type { ToolDef } from "../types"

/** Leaves room under the default output cap, so a page is never cut in the middle. */
const PAGE_CHARS = 25_000

const Input = z.object({
  id: z.string().min(1).describe("Id ghi trong dòng đã dọn, hoặc ref dạng r3."),
  offset: z.number().int().min(0).optional().describe("Ký tự bắt đầu, khi kết quả dài hơn một trang."),
})

/** A saved result as it was fetched: the way back to figures an answer already cited. */
export function readResultTool(): ToolDef<z.infer<typeof Input>> {
  return {
    name: "read_result",
    description:
      "Đọc lại nguyên văn một kết quả tool đã lấy trong phiên này, đúng như lúc lấy. " +
      "Dùng khi: cần con số của một kết quả đã dọn, để khớp với số đã trích dẫn. " +
      "Không dùng khi: cần số mới nhất; khi đó gọi lại tool dữ liệu.",
    input: Input,
    readOnly: true,
    summarize: ({ id }) => `read_result(${id})`,
    async execute({ id, offset = 0 }) {
      const found = findResult(id)
      if (!found) return `Không còn kết quả "${id}" trong phiên đang mở. Gọi lại tool dữ liệu; số có thể khác số đã trích dẫn, cần nói rõ thời điểm mới.`
      const page = found.text.slice(offset, offset + PAGE_CHARS)
      const left = found.text.length - offset - page.length
      const head = `[${found.tool} · lấy lúc ${found.at}]\n${found.ref && offset === 0 ? `${REF_PREFIX}${found.ref}] ` : ""}`
      return `${head}${page}${left > 0 ? `\n[còn ${left} ký tự: gọi lại với offset ${offset + page.length}]` : ""}`
    },
  }
}
