import { afterEach, beforeEach, expect, test } from "bun:test"
import type { Target } from "../src/core/chat"
import { extractWithModel, guardedNative, isQuotaError, NATIVE_PAUSE_MS, nativeSearch, nextPacificMidnight, NOT_IN_PLAN_NOTE, notInPlan, resetNativePause } from "../src/core/tools/web/side-model"
import { runSearch } from "../src/core/tools/web/search"

const realFetch = globalThis.fetch
let calls = 0

beforeEach(() => {
  calls = 0
  resetNativePause()
  // Gemini's answer once the quota is gone.
  globalThis.fetch = (async () => {
    calls++
    return Response.json(
      { error: { code: 429, message: "You exceeded your current quota, please check your plan and billing details.", status: "RESOURCE_EXHAUSTED" } },
      { status: 429 },
    )
  }) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const target: Target = {
  provider: { id: "google", name: "Google", env: [], npm: "@ai-sdk/google", models: { "gemini-3.1-flash-lite": { id: "gemini-3.1-flash-lite", name: "g" } as never } },
  model: "gemini-3.1-flash-lite",
  apiKey: "k",
}

test("a 429 on the side calls is sent once, not three times (no SDK retries)", async () => {
  const error = await nativeSearch("FPT", target, {}, new AbortController().signal).catch((e: unknown) => e)
  expect(calls).toBe(1)
  expect(isQuotaError(error)).toBe(true)
  calls = 0
  await expect(extractWithModel("nội dung", "tóm tắt", "https://cafef.vn/x", target, new AbortController().signal)).rejects.toThrow(
    "Gọi lại web_fetch không kèm prompt",
  )
  expect(calls).toBe(1)
})

test("a model out of quota is skipped for 10 minutes, then tried again; another model is not affected", async () => {
  let now = Date.parse("2026-10-11T14:00:00Z")
  const clock = () => now
  let runs = 0
  const quota = () => {
    runs++
    return Promise.reject(Object.assign(new Error("You exceeded your current quota"), { statusCode: 429 }))
  }
  await expect(guardedNative("google/m", quota, clock)).rejects.toThrow("Hết quota hoặc bị giới hạn tốc độ (429)")
  await expect(guardedNative("google/m", quota, clock)).rejects.toThrow("tạm bỏ qua tới 21:10 vì model hết quota (429)")
  expect(runs).toBe(1)
  expect(await guardedNative("google/other", async () => "ok", clock)).toBe("ok")
  now += NATIVE_PAUSE_MS + 1
  expect(await guardedNative("google/m", async () => "ok", clock)).toBe("ok")
  // Other failures do not pause it.
  await expect(guardedNative("google/x", () => Promise.reject(new Error("mạng lỗi")), clock)).rejects.toThrow("mạng lỗi")
  expect(await guardedNative("google/x", async () => "ok", clock)).toBe("ok")
})

test("web_search reports the quota once in plain words and still answers from a fallback", async () => {
  const out = await runSearch({ query: "FPT tin mới" }, new AbortController().signal, {
    native: () => guardedNative("google/m", () => Promise.reject(Object.assign(new Error("quota"), { statusCode: 429 }))),
    backends: () => [{ name: "duckduckgo", run: async () => [{ title: "FPT", url: "https://cafef.vn/fpt.chn" }] }],
  })
  expect(out).toContain("Hết quota hoặc bị giới hạn tốc độ (429)")
  expect(out).not.toContain("AI_APICallError")
  expect(out).not.toContain("Failed after")
  expect(out).toContain("cafef.vn")
})

/** The grounding 429 of 30/10 (free key, gemini-3.1-flash-lite): no RetryInfo, no QuotaFailure. */
const NOT_IN_PLAN = JSON.stringify({
  error: {
    code: 429,
    message: "You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.",
    status: "RESOURCE_EXHAUSTED",
    details: [{ "@type": "type.googleapis.com/google.rpc.Help", links: [{ description: "Learn more about Gemini API quotas", url: "https://ai.google.dev/gemini-api/docs/rate-limits" }] }],
  },
})
const PER_MINUTE = JSON.stringify({
  error: {
    code: 429,
    message: "Resource has been exhausted (e.g. check quota).",
    status: "RESOURCE_EXHAUSTED",
    details: [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests" }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "21s" },
    ],
  },
})
const rejected = (responseBody: string) => () =>
  Promise.reject(Object.assign(new Error("You exceeded your current quota"), { statusCode: 429, responseBody }))

test("grounding not in the key's plan (30/10 body): skipped until Gemini's quota day ends, said once", async () => {
  expect(notInPlan({ statusCode: 429, responseBody: NOT_IN_PLAN })).toBe(true)
  expect(notInPlan({ statusCode: 429, responseBody: PER_MINUTE })).toBe(false)
  expect(notInPlan(new Error("quota"))).toBe(false)
  // 03:23 on 30/10 in Vietnam = 13:23 on 29/10 in Pacific daylight time: the day ends 07:00 UTC on 30/10.
  let now = Date.parse("2026-10-29T20:23:00Z")
  expect(nextPacificMidnight(now)).toBe(Date.parse("2026-10-30T07:00:00Z"))
  const clock = () => now
  await expect(guardedNative("google/gemini-3.1-flash-lite", rejected(NOT_IN_PLAN), clock)).rejects.toThrow("gói free Gemini 3 của key này")
  // runSearch keeps 120 chars of a native failure: the whole note fits.
  expect(NOT_IN_PLAN_NOTE.length).toBeLessThanOrEqual(120)
  let runs = 0
  const count = () => ((runs += 1), Promise.resolve("ok"))
  now += NATIVE_PAUSE_MS + 1
  await expect(guardedNative("google/gemini-3.1-flash-lite", count, clock)).rejects.toThrow("tạm bỏ qua tới 14:00")
  expect(runs).toBe(0)
  now = Date.parse("2026-10-30T07:00:01Z")
  expect(await guardedNative("google/gemini-3.1-flash-lite", count, clock)).toBe("ok")
})

test("a per-minute 429 (RetryInfo, QuotaFailure) keeps the 10-minute pause", async () => {
  let now = Date.parse("2026-10-11T14:00:00Z")
  const clock = () => now
  await expect(guardedNative("google/m2", rejected(PER_MINUTE), clock)).rejects.toThrow("tạm bỏ qua 10 phút")
  now += NATIVE_PAUSE_MS + 1
  expect(await guardedNative("google/m2", async () => "ok", clock)).toBe("ok")
})
