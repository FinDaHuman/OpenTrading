import { expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { operandNote, operandsOf, pythonComputation, untracedOperands } from "../src/core/loop/operands"

/** The note after an arithmetic command whose typed numbers nothing read holds (issue #278 N2). */

const question = "Lợi nhuận sau thuế 1.315.800.000.000 đồng, 215.000.000 cổ phiếu lưu hành. EPS?"
const arithmetic = () => true
const step = (command: string, output = "[mã thoát 0 · 0.2s · /w]\n61200", tool = "shell"): ModelMessage[] => [
  { role: "user", content: question },
  { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: tool, input: { command } }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: tool, output: { type: "text", value: output } }] },
]

test("a dropped zero (15/11 EPS) is flagged; the right numbers, constants and unit changes are not", () => {
  expect(untracedOperands(step("$e = 1315800000000; $s = 21500000; $e / $s"), arithmetic)).toEqual(["21500000"])
  expect(untracedOperands(step("$e = 1315800000000; $s = 215000000; $e / $s"), arithmetic)).toEqual([])
  // Tỷ đồng and percent as a fraction trace; 100 and 250 are constants.
  expect(untracedOperands(step("1315.8 / 215 * 100 * 250"), arithmetic)).toEqual([])
})

test("an array index is a position, not a figure", () => {
  // The whole index goes, `$i-1` included.
  expect(operandsOf("data[6] = 48.5; $p[$i-1]; x[11]").map((o) => o.text)).toEqual(["48.5"])
  expect(untracedOperands(step("awk 'BEGIN{ d[6] = 1315800000000; print d[6] / 215000000 }'"), arithmetic)).toEqual([])
})

test("numbers from an earlier command's output trace; its status line does not", () => {
  const messages: ModelMessage[] = [
    ...step("1315800000000 / 215000000", "[mã thoát 0 · 0.7s · /w]\n61200"),
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c2", toolName: "shell", input: { command: "61200 * 2 + 0.7" } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "c2", toolName: "shell", output: { type: "text", value: "[mã thoát 0 · 0.2s · /w]\n122400.7" } }] },
  ]
  // 61200 is the first command's output; 0.7 only appears as the "0.7s" of its status line.
  // (A one-decimal operand traces within ±0.05 of a source: 0.2 would match 0.215, a reading of 215 nghìn.)
  expect(untracedOperands(messages, arithmetic)).toEqual(["0.7"])
})

test("only the last step, only commands that ran, only arithmetic, at most five values", () => {
  expect(untracedOperands(step("$s = 21500000", "Người dùng từ chối chạy tool này."), arithmetic)).toEqual([])
  expect(untracedOperands(step("$s = 21500000", "[mã thoát 1 · 0.2s · /w]\nLỖI"), arithmetic)).toEqual([])
  expect(untracedOperands(step("python3 calc.py 21500000"), (c) => !c.startsWith("python"))).toEqual([])
  expect(untracedOperands(step("21500000", undefined, "calculate"), arithmetic)).toEqual([])
  expect(untracedOperands(step("11.1 + 22.2 + 33.3 + 44.4 + 55.5 + 66.6 + 77.7"), arithmetic)).toHaveLength(5)
  // A later step without shell: nothing is said again.
  const later: ModelMessage[] = [...step("$s = 21500000"), { role: "assistant", content: [{ type: "text", text: "EPS 61.200 đồng." }] }]
  expect(untracedOperands(later, arithmetic)).toEqual([])
})

test("the note names the numbers, says the command ran, and leaves the decision to the model", () => {
  const note = operandNote(["21500000"])
  expect(note).toStartWith("<nhac_nho>")
  expect(note).toContain("21500000")
  expect(note).toContain("bỏ qua nhắc này")
  for (const word of ["Không chạy", "bị chặn", "DỪNG"]) expect(note).not.toContain(word)
})

test("what the user told the harness counts: constraints and profile (system), the memory index (context), an earlier answer", () => {
  // The user's own threshold, not in any message of the turn.
  const command = "$pe = 96500 / 6120; $pe - 12.5"
  const turn: ModelMessage[] = [
    { role: "user", content: "P/E của FPT là bao nhiêu? Giá 96.500 đồng, EPS 6.120 đồng." },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "shell", input: { command } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "shell", output: { type: "text", value: "[mã thoát 0 · 0.2s · /w]\n3.268" } }] },
  ]
  expect(untracedOperands(turn, arithmetic)).toEqual(["12.5"])
  expect(untracedOperands(turn, arithmetic, "<rang_buoc>\nRàng buộc của người dùng: - [#1 · bản 1] Chỉ mua khi P/E dưới 12,5 lần.\n</rang_buoc>")).toEqual([])
  expect(untracedOperands(turn, arithmetic, "Sổ ghi nhớ: ngưỡng P/E 12.5 cho cổ phiếu công nghệ")).toEqual([])
  const followUp: ModelMessage[] = [{ role: "user", content: "Ngưỡng?" }, { role: "assistant", content: "Ngưỡng P/E bạn đặt là 12,5 lần." }, ...turn]
  expect(untracedOperands(followUp, arithmetic)).toEqual([])
})

test("a one-shot Python computation counts as arithmetic; other Python does not (issue #309 A3)", () => {
  for (const command of [
    'python3 -c "print(1315800000000 / 21500000)"',
    "python3 - <<'EOF'\nprint(1315800000000 / 215000000)\nEOF",
    "python <<EOF\nprint(1)\nEOF",
    "cat > calc.py <<'EOF'\nprint(1)\nEOF\npython3 calc.py",
  ])
    expect([command, pythonComputation(command)]).toEqual([command, true])
  for (const command of ["python3 scripts/plot.py", "pip install pandas", "awk 'BEGIN{print 1}'"]) expect([command, pythonComputation(command)]).toEqual([command, false])
  // The dropped zero is flagged in Python as in awk; the right figure, an index and a format are not.
  expect(untracedOperands(step('python3 -c "e = 1315800000000; s = 21500000; print(f\'{e/s:.2f}\')"'), pythonComputation)).toEqual(["21500000"])
  expect(untracedOperands(step('python3 -c "x = [1315800000000, 215000000]; print(x[0] / x[1])"'), pythonComputation)).toEqual([])
})
