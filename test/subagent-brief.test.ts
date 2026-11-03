import { expect, test } from "bun:test"
import { z } from "zod"
import { briefFields, renderBrief } from "../src/core/subagents/brief"
import { spawnSubagentTool } from "../src/core/tools/subagent/spawn"
import { SubagentManager } from "../src/core/subagents/manager"
import { ToolRegistry } from "../src/core/tools/registry"

test("renderBrief lays every brief out the same way (33e)", () => {
  const text = renderBrief({
    task: "Tra cứu BCTC VCB 3 quý gần nhất (chỉ đọc).",
    depth: "thorough",
    purpose: "So ROE với ACB cho người dùng",
    context: "ROE 2025 = x% (financial_statements)",
    questions: [" NIM 3 quý? ", "Nợ nhóm 3–5 có tăng?"],
    scope: "VCB, Q1–Q3/2026; không cần giá cổ phiếu",
    output: "≤ 8 dòng, mỗi số kèm nguồn và kỳ.",
    done_when: "đủ 3 quý cho 2 chỉ tiêu",
  })
  expect(text).toBe(
    [
      "Tra cứu BCTC VCB 3 quý gần nhất (chỉ đọc) (mức kỹ: rất kỹ).",
      "Mục đích: So ROE với ACB cho người dùng",
      "Bối cảnh đã có: ROE 2025 = x% (financial_statements)",
      "Việc cần làm:\n- NIM 3 quý?\n- Nợ nhóm 3–5 có tăng?",
      "Phạm vi: VCB, Q1–Q3/2026; không cần giá cổ phiếu",
      "Trả về: ≤ 8 dòng, mỗi số kèm nguồn và kỳ. Ghi [suy luận] cho ý không lấy từ kết quả tool.",
      "Xong khi: đủ 3 quý cho 2 chỉ tiêu",
    ].join("\n"),
  )
})

test("empty optional parts are left out; depth defaults to medium", () => {
  expect(renderBrief({ task: "Giá FPT", purpose: "trả lời", context: "  ", questions: ["Giá đóng cửa?"], output: "1 dòng" })).toBe(
    "Giá FPT (mức kỹ: vừa).\nMục đích: trả lời\nViệc cần làm:\n- Giá đóng cửa?\nTrả về: 1 dòng. Ghi [suy luận] cho ý không lấy từ kết quả tool.",
  )
})

test("spawn_subagent requires purpose, questions and output; the old free-text prompt alone is refused", () => {
  const input = spawnSubagentTool(new SubagentManager({ parent: new ToolRegistry() })).input as z.ZodObject<z.ZodRawShape>
  const ok = { description: "Giá FPT", task: "Giá FPT", purpose: "trả lời", questions: ["Giá?"], output: "1 dòng" }
  expect(input.safeParse(ok).success).toBe(true)
  expect(input.safeParse({ ...ok, purpose: undefined }).success).toBe(false)
  expect(input.safeParse({ ...ok, questions: [] }).success).toBe(false)
  expect(input.safeParse({ ...ok, depth: "rất kỹ" }).success).toBe(false) // ASCII enum values only
  expect(input.safeParse({ description: "Giá FPT", prompt: "giá FPT" }).success).toBe(false)
  // Enum values stay ASCII for Gemini's function declarations.
  expect(briefFields.depth.unwrap().options.every((o) => /^[a-z]+$/.test(o))).toBe(true)
})
