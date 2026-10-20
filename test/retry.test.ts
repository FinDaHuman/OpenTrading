import { expect, test } from "bun:test"
import { APICallError } from "ai"
import { backoff, classifyFailure, describeFailure, inputTokensPerMinute, MAX_WAIT_MS, RATE_RETRIES, RequestOverQuota, RETRIES, requestedDelay, withRetries } from "../src/core/retry"

/**
 * Gemini 429 bodies, shaped after Google's documented google.rpc error details
 * (QuotaFailure + RetryInfo). Not captured from a live response: no session log had one.
 */
const geminiBody = (quotaId: string, retryDelay = "38s") =>
  JSON.stringify({
    error: {
      code: 429,
      message: "You exceeded your current quota, please check your plan and billing details.",
      status: "RESOURCE_EXHAUSTED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId, quotaValue: "20" }],
        },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
      ],
    },
  })

const apiError = (statusCode: number, responseBody = "", responseHeaders: Record<string, string> = {}, message = `HTTP ${statusCode}`) =>
  new APICallError({ message, url: "https://x", requestBodyValues: {}, statusCode, responseBody, responseHeaders })

test("a Gemini daily quota is never retried; a per-minute one waits RetryInfo", () => {
  expect(classifyFailure(apiError(429, geminiBody("GenerateRequestsPerDayPerProjectPerModel-FreeTier"))).kind).toBe("daily-quota")
  const minute = classifyFailure(apiError(429, geminiBody("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "12.5s")))
  expect(minute).toMatchObject({ kind: "rate-limit", delayMs: 12_500 })
})

test("other providers: OpenAI insufficient_quota and Groq TPD are daily; Groq's 'try again in' is read", () => {
  expect(classifyFailure(apiError(429, '{"error":{"code":"insufficient_quota"}}')).kind).toBe("daily-quota")
  expect(classifyFailure(apiError(429, "", {}, "Rate limit reached for model on tokens per day (TPD): Limit 100000")).kind).toBe("daily-quota")
  const groq = classifyFailure(apiError(429, "", {}, "Rate limit reached. Please try again in 1m30.5s."))
  expect(groq).toMatchObject({ kind: "rate-limit", delayMs: 90_500 })
})

test("retry-after headers: milliseconds, seconds and dates", () => {
  expect(requestedDelay({ responseHeaders: { "retry-after-ms": "1500" } })).toBe(1500)
  expect(requestedDelay({ responseHeaders: { "Retry-After": "7" } })).toBe(7000)
  const date = new Date(Date.now() + 20_000).toUTCString()
  expect(requestedDelay({ responseHeaders: { "retry-after": date } })).toBeGreaterThan(15_000)
  expect(requestedDelay({})).toBeUndefined()
})

test("overload, 5xx and network errors retry; bad requests, keys and overflow do not", () => {
  expect(classifyFailure(apiError(503)).kind).toBe("overloaded")
  expect(classifyFailure(apiError(529)).kind).toBe("overloaded")
  expect(classifyFailure(apiError(500)).kind).toBe("overloaded")
  expect(classifyFailure(new TypeError("fetch failed")).kind).toBe("network")
  expect(classifyFailure(Object.assign(new Error("x"), { cause: { message: "ECONNRESET" } })).kind).toBe("network")
  for (const status of [400, 401, 403, 404, 422]) expect(classifyFailure(apiError(status)).kind).toBe("fatal")
  expect(classifyFailure(apiError(400, "", {}, "This model's maximum context length is 128000 tokens")).kind).toBe("fatal")
  expect(classifyFailure(new DOMException("Aborted", "AbortError")).kind).toBe("fatal")
})

test("backoff: 2s doubling with at most 25% jitter, capped at 30s", () => {
  expect(backoff(1, () => 0)).toBe(2000)
  expect(backoff(2, () => 0)).toBe(4000)
  expect(backoff(3, () => 1)).toBe(10_000)
  expect(backoff(9, () => 1)).toBe(30_000)
})

const noSleep = { sleep: async () => {} }

test("withRetries: retries what can recover, reports each wait, then gives up", async () => {
  let calls = 0
  const notices: number[] = []
  await expect(
    withRetries(
      async () => {
        calls++
        throw apiError(503)
      },
      undefined,
      { ...noSleep, onRetry: (n) => notices.push(n.attempt), random: () => 0 },
    ),
  ).rejects.toBeInstanceOf(APICallError)
  expect(calls).toBe(RETRIES + 1)
  expect(notices).toEqual([1, 2, 3, 4])

  calls = 0
  const value = await withRetries(
    async () => {
      if (++calls <= RATE_RETRIES) throw apiError(429, geminiBody("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "1s"))
      return "ok"
    },
    undefined,
    noSleep,
  )
  expect(value).toBe("ok")
  expect(calls).toBe(RATE_RETRIES + 1)
})

test("withRetries: no retry for a daily quota or a wait longer than a minute", async () => {
  for (const error of [
    apiError(429, geminiBody("GenerateRequestsPerDayPerProjectPerModel-FreeTier")),
    apiError(429, "", { "retry-after": String(MAX_WAIT_MS / 1000 + 30) }),
  ]) {
    let calls = 0
    await expect(
      withRetries(
        async () => {
          calls++
          throw error
        },
        undefined,
        noSleep,
      ),
    ).rejects.toBe(error)
    expect(calls).toBe(1)
  }
})

test("withRetries: Esc during the wait stops at once", async () => {
  // Other test files zero the delays; this one needs the real 2s wait.
  const saved = process.env.OPENTRADING_RETRY_SCALE
  process.env.OPENTRADING_RETRY_SCALE = "1"
  try {
    const controller = new AbortController()
    let calls = 0
    const started = Date.now()
    const run = withRetries(
      async () => {
        calls++
        throw apiError(503)
      },
      controller.signal,
      { random: () => 0 }, // the real abortable sleep: 2s unless aborted
    )
    setTimeout(() => controller.abort(), 20)
    await expect(run).rejects.toBeDefined()
    expect(Date.now() - started).toBeLessThan(1000)
    expect(calls).toBe(1)
  } finally {
    if (saved === undefined) delete process.env.OPENTRADING_RETRY_SCALE
    else process.env.OPENTRADING_RETRY_SCALE = saved
  }
})

test("the messages a user sees when quota runs out", () => {
  expect(describeFailure(apiError(429, geminiBody("GenerateRequestsPerDayPerProjectPerModel-FreeTier")))).toContain("hết quota trong ngày")
  expect(describeFailure(apiError(429, "", { "retry-after": "90" }))).toContain("khoảng 90 giây")
  expect(describeFailure(apiError(503))).toBeUndefined()
})

test("withRetries: each notice carries the deadline of the wait that is really slept", async () => {
  const saved = process.env.OPENTRADING_RETRY_SCALE
  try {
    // Default sleep, scaled down 1000×: the deadline is ~2 ms away, not the nominal 2 s.
    process.env.OPENTRADING_RETRY_SCALE = "0.001"
    const scaled: { delayMs: number; until: number; at: number }[] = []
    let calls = 0
    await withRetries(
      async () => {
        if (++calls === 1) throw apiError(503)
        return "ok"
      },
      undefined,
      { onRetry: (n) => scaled.push({ delayMs: n.delayMs, until: n.until, at: Date.now() }), random: () => 0 },
    )
    expect(scaled[0]!.delayMs).toBe(2000)
    expect(scaled[0]!.until - scaled[0]!.at).toBeLessThanOrEqual(5)

    // An injected sleep waits what it is given.
    const injected: number[] = []
    calls = 0
    await withRetries(
      async () => {
        if (++calls === 1) throw apiError(503)
        return "ok"
      },
      undefined,
      { sleep: async () => {}, onRetry: (n) => injected.push(n.until - Date.now()), random: () => 0 },
    )
    expect(injected[0]).toBeGreaterThan(1900)
  } finally {
    if (saved === undefined) delete process.env.OPENTRADING_RETRY_SCALE
    else process.env.OPENTRADING_RETRY_SCALE = saved
  }
})

/** A Gemini 429 for the per-minute input-token quota (shape as in geminiBody). */
const tpmBody = JSON.stringify({
  error: {
    code: 429,
    message: "You exceeded your current quota, please check your plan and billing details.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_input_token_count",
            quotaId: "GenerateContentInputTokensPerModelPerMinute-FreeTier",
            quotaValue: "250000",
          },
        ],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "20s" },
    ],
  },
})

test("a request larger than the per-minute input-token quota fails at once; a smaller one waits as usual", async () => {
  expect(inputTokensPerMinute(apiError(429, tpmBody))).toBe(250_000)
  expect(inputTokensPerMinute(apiError(429, "", {}, "Quota exceeded for metric: generate_content_free_tier_input_token_count, limit: 1000000"))).toBe(1_000_000)
  expect(inputTokensPerMinute(apiError(429, geminiBody("GenerateRequestsPerMinutePerProjectPerModel-FreeTier")))).toBeUndefined()

  let calls = 0
  const fail = async () => {
    calls++
    throw apiError(429, tpmBody)
  }
  const big = withRetries(fail, undefined, { ...noSleep, requestTokens: () => 300_000 })
  await expect(big).rejects.toBeInstanceOf(RequestOverQuota)
  await expect(big).rejects.toThrow("vượt giới hạn 250.000 token đầu vào mỗi phút")
  expect(calls).toBe(1)

  calls = 0
  await expect(withRetries(fail, undefined, { ...noSleep, requestTokens: () => 40_000 })).rejects.toMatchObject({ statusCode: 429 })
  expect(calls).toBe(RATE_RETRIES + 1)
})
