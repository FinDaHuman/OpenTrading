import { expect, test } from "bun:test"
import { InvalidToolInputError, NoSuchToolError, ToolCallRepairError, TypeValidationError, type ModelMessage } from "ai"
import { z } from "zod"
import { cleanToolErrors, toolErrorText } from "../src/core/tools/errors"
import { transcriptFromMessages } from "../src/core/session/transcript"

/** The string the SDK puts in the tool-error part and the model's error-text. */
const sdkString = (e: Error) => e.toString()

test("invalid input: one Vietnamese line per issue, without the echoed input or zod JSON", () => {
  const parsed = z
    .object({ from_calls: z.array(z.string()).min(2), kind: z.enum(["a", "b"]), n: z.number(), name: z.string().max(3) })
    .strict()
    .safeParse({ from_calls: ["r1"], kind: "c", name: "dài quá", extra: 1 })
  const error = new InvalidToolInputError({
    toolName: "chart_compare",
    toolInput: "{}",
    cause: new TypeValidationError({ value: { from_calls: ["r1"], secret: "x".repeat(5000) }, cause: parsed.error }),
  })
  const expected = [
    "Tham số không hợp lệ cho chart_compare:",
    "- from_calls: cần ít nhất 2 phần tử",
    '- kind: phải là một trong: "a", "b"',
    "- n: thiếu (bắt buộc)",
    "- name: cần tối đa 3 ký tự",
    "- không có tham số extra",
    "Sửa tham số rồi gọi lại.",
  ].join("\n")
  expect(toolErrorText(error)).toBe(expected)
  // The same from the string the SDK stored (what saved sessions and the model hold).
  expect(toolErrorText(sdkString(error))).toBe(expected)
})

test("repair and unknown-tool errors lose the SDK wrapping; plain errors lose 'Error: '", () => {
  const repair = new ToolCallRepairError({ cause: new Error("Đã nạp tool: x\nGọi lại."), originalError: new NoSuchToolError({ toolName: "x" }) })
  expect(toolErrorText(sdkString(repair))).toBe("Đã nạp tool: x\nGọi lại.")
  expect(toolErrorText(sdkString(new NoSuchToolError({ toolName: "y", availableTools: ["a", "b"] })))).toBe('Không có tool "y".')
  expect(toolErrorText("Error: bar cần series ít nhất 1 cột.")).toBe("bar cần series ít nhất 1 cột.")
  expect(toolErrorText(new Error("nguồn sập"))).toBe("nguồn sập")
  expect(toolErrorText("x".repeat(5000))).toHaveLength(2000)
})

test("cleanToolErrors rewrites error-text results only, and returns the same array when nothing changes", () => {
  const messages: ModelMessage[] = [
    { role: "user", content: "x" },
    {
      role: "tool",
      content: [
        { type: "tool-result", toolCallId: "a", toolName: "t", output: { type: "error-text", value: "AI_ToolCallRepairError: Error repairing tool call: Error: hỏng" } },
        { type: "tool-result", toolCallId: "b", toolName: "t", output: { type: "text", value: "Error: là dữ liệu, giữ nguyên" } },
      ],
    },
  ]
  const cleaned = cleanToolErrors(messages)
  const parts = (cleaned[1]!.content as { output: { value: string } }[]).map((p) => p.output.value)
  expect(parts).toEqual(["hỏng", "Error: là dữ liệu, giữ nguyên"])
  expect(cleanToolErrors(cleaned)).toBe(cleaned)
})

test("resumed sessions show old raw error strings cleaned", () => {
  const items = transcriptFromMessages([
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "web_search", input: {} }] },
    {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "c1", toolName: "web_search", output: { type: "error-text", value: "AI_ToolCallRepairError: Error repairing tool call: Error: Tool hỏng." } }],
    },
  ])
  expect(items.find((i) => i.kind === "tool")).toMatchObject({ ok: false, output: "Tool hỏng." })
})
