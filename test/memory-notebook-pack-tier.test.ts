import { expect, test } from "bun:test"
import { labelTitle } from "../src/core/memory/notebook/history-blocks"
import { indexCharLimit, recallCharLimit } from "../src/core/memory/notebook/pack"
import { renderLessonBlock, renderThesisBlock } from "../src/core/memory/notebook/render"
import { BUDGETS } from "../src/core/prompt/budget"
import { MEMORY_INDEX_MAX_CHARS, MEMORY_RECALL_MAX_CHARS } from "../src/core/memory/types"

test("memory limits follow the turn's tier; with no tier, the smallest one", () => {
  const chars = (tier: "A" | "B" | "C") => BUDGETS.memory![tier]! * 4
  for (const tier of ["A", "B", "C"] as const) {
    expect(recallCharLimit(tier)).toBe(Math.min(chars(tier), MEMORY_RECALL_MAX_CHARS))
    expect(indexCharLimit(tier)).toBe(Math.min(chars(tier), MEMORY_INDEX_MAX_CHARS))
  }
  expect(recallCharLimit()).toBe(recallCharLimit("C"))
  expect(recallCharLimit("A")).toBeGreaterThan(recallCharLimit("C"))
})

test("labelTitle names a block shortly, for the notice; anything else has none", () => {
  const thesis = renderThesisBlock(
    { subjectId: 1, display: "HPG", version: 3, text: "x", conditions: [], state: "watching", validFrom: "2026-10-20T00:00:00.000Z" },
    {},
  )
  const lesson = renderLessonBlock({ id: 7, version: 2, title: "x", summary: "x", appliesToDisplay: [], tags: [], createdAt: "2026-10-20T00:00:00.000Z" })
  expect(labelTitle(thesis)).toBe("HPG bản 3")
  expect(labelTitle(lesson)).toBe("bài học #7 bản 2")
  expect(labelTitle("[Memory · nhắc] Luận điểm HPG đã có bản 4")).toBeUndefined()
})
