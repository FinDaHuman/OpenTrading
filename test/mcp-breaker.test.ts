import { expect, test } from "bun:test"
import { BREAKER_THRESHOLD, ServerBreaker } from "../src/core/mcp/breaker"
import { fetchQuotes } from "../src/core/tools/watchlist/quotes"
import type { ToolRegistry } from "../src/core/tools/registry"

function breaker() {
  const clock = { now: 1_000 }
  return { clock, b: new ServerBreaker(60_000, () => clock.now) }
}

const trip = (b: ServerBreaker) => {
  for (let i = 0; i < BREAKER_THRESHOLD; i++) b.failure()
}

test("calls pass until the threshold, then are refused with the time left", () => {
  const { b, clock } = breaker()
  b.failure()
  b.failure()
  expect(b.admit()).toBeUndefined()
  b.failure()
  expect(b.admit()).toBe(60_000)
  clock.now += 45_000
  expect(b.admit()).toBe(15_000)
})

test("an answer from the server resets the count", () => {
  const { b } = breaker()
  b.failure()
  b.failure()
  b.success()
  b.failure()
  b.failure()
  expect(b.admit()).toBeUndefined()
})

test("after the period exactly one call goes through to test it", () => {
  const { b, clock } = breaker()
  trip(b)
  clock.now += 60_000
  expect(b.admit()).toBeUndefined()
  expect(b.admit()).toBe(60_000)
})

test("a test that succeeds closes it, one that fails opens it again", () => {
  const { b, clock } = breaker()
  trip(b)
  clock.now += 60_000
  b.admit()
  b.failure()
  expect(b.admit()).toBe(60_000)
  clock.now += 60_000
  b.admit()
  b.success()
  expect(b.admit()).toBeUndefined()
  expect(b.admit()).toBeUndefined()
})

test("a test without a verdict does not leave it stuck", () => {
  const { b, clock } = breaker()
  trip(b)
  clock.now += 60_000
  b.admit()
  clock.now += 60_000
  expect(b.admit()).toBeUndefined()
})

test("a reconnect lets the next call test it at once, and only that one", () => {
  const { b } = breaker()
  trip(b)
  b.reconnected()
  expect(b.admit()).toBeUndefined()
  expect(b.admit()).toBe(60_000)
})

test("a reconnect means nothing while it is closed", () => {
  const { b } = breaker()
  b.failure()
  b.reconnected()
  b.failure()
  b.failure()
  expect(b.admit()).toBe(60_000)
})

test("the watchlist panel shows the refusal without the advice meant for the model", async () => {
  const tool = {
    name: "mcp__ot__vn_equity_quote_batch",
    source: "mcp:ot",
    execute: async () => {
      throw new Error('MCP server "ot" đang lỗi kết nối liên tiếp nên lần gọi này chưa được gửi đi. Thử lại sau 42 giây; lúc này đừng gọi tool của server này.')
    },
  }
  const registry = { list: () => [tool] } as unknown as ToolRegistry
  const { error } = await fetchQuotes(registry, ["FPT"], new AbortController().signal)
  expect(error).toBe('MCP server "ot" đang lỗi kết nối liên tiếp nên lần gọi này chưa được gửi đi. Thử lại sau 42 giây')
})
