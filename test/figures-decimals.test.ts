import { expect, test } from "bun:test"
import { answerFigures, sourceNumbers } from "../src/core/loop/figures"

/**
 * MyToDoList 43j/43z: "6,9034" read as "6,903" (a thousands group) and dropped its last digit, so a figure the
 * model copied exactly showed up as ungrounded, and a wrong one could trace by accident.
 */

test("a decimal with four or more digits after the separator is read whole, in an answer", () => {
  for (const text of ["tăng 6,9034%", "tăng 6.9034%"]) {
    const [figure] = answerFigures(text)
    expect(figure?.text).toBe("6,9034%".replace(",", text.includes(".") ? "." : ","))
    expect(figure?.values).toContain(6.9034)
    expect(figure?.values).not.toContain(6903)
  }
  // Real thousands groups keep both readings, as before.
  expect(answerFigures("giá 25.350 đồng")[0]?.values).toEqual([25350, 25.35])
  expect(answerFigures("1.234.567,89 đồng")[0]?.values).toContain(1234567.89)
})

test("a decimal with four or more digits is read whole in a source text too", () => {
  const numbers = sourceNumbers("Lợi suất 6,9034% trong kỳ")
  expect(numbers.has(6.9034)).toBe(true)
  expect(numbers.has(6903)).toBe(false)
  expect(sourceNumbers("giá 1.234,5").has(1234.5)).toBe(true)
  expect(sourceNumbers("24,1 tỷ").has(24.1)).toBe(true)
})
