import { expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { estimateRequest } from "../src/core/agent"
import { IMAGE_TOKENS } from "../src/core/compact"

test("#332: without provider usage, a large image counts as one image, not as its base64", () => {
  const base64 = "A".repeat(1_400_000) // ~1 MB screenshot
  const messages: ModelMessage[] = [
    { role: "user", content: [{ type: "text", text: "Xem biểu đồ này" }, { type: "image", image: base64, mediaType: "image/png" }] },
  ]
  const size = estimateRequest("system prompt", messages, 500)
  expect(size).toBeLessThan(IMAGE_TOKENS + 1_000)
  expect(size).toBeGreaterThanOrEqual(IMAGE_TOKENS + 500)
})

test("text-only requests keep the chars/4 estimate", () => {
  const messages: ModelMessage[] = [{ role: "user", content: "x".repeat(4_000) }]
  const size = estimateRequest("s".repeat(400), messages)
  expect(size).toBeGreaterThanOrEqual(1_100)
  expect(size).toBeLessThan(1_150)
})
