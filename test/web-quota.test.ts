import { afterEach, beforeEach, expect, test } from "bun:test"
import type { Target } from "../src/core/chat"
import { extractWithModel, guardedNative, isQuotaError, NATIVE_PAUSE_MS, nativeSearch, resetNativePause } from "../src/core/tools/web/side-model"
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
