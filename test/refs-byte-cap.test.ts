import { afterEach, expect, test } from "bun:test"
import { clearResults, recallResult, rememberResult, storedResults, useResultSession } from "../src/core/tools/refs"

afterEach(() => clearResults())

test("#336: the 8 MB cap counts rawText too, in UTF-8 bytes", () => {
  useResultSession("s-bytes")
  // 1.5 MB of model text + 1.5 MB raw reply per result = 3 MB: the cap keeps at most two.
  const big = "x".repeat(1_500_000)
  const refs = [0, 1, 2, 3].map(() => rememberResult("t", big, { rawText: big }))
  expect(storedResults().length).toBe(2)
  expect(recallResult(refs[0]!)).toBeUndefined()
  expect(recallResult(refs[3]!)?.text.length).toBe(big.length)
})

test("Vietnamese text counts its UTF-8 bytes, not its length", () => {
  useResultSession("s-utf8")
  // "ữ" is 3 bytes: 1M characters = 3 MB, so three results exceed 8 MB.
  const vi = "ữ".repeat(1_000_000)
  ;[0, 1, 2].map(() => rememberResult("t", vi))
  expect(storedResults().length).toBe(2)
})
