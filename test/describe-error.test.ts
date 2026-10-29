import { expect, test } from "bun:test"
import { APICallError } from "ai"
import { describeError } from "../src/core/chat"

const apiError = (statusCode: number, message: string) =>
  new APICallError({ message, url: "https://x.test", requestBodyValues: {}, statusCode, responseBody: JSON.stringify({ error: { message } }) })

test("404 keeps the provider's reason (Google, 30/10: gemini-2.5-flash closed to new users)", () => {
  const google =
    "This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features and improvements. We recommend you to use the Interactions API (https://ai.google.dev/gemini-api/docs/get-started)."
  const text = describeError(apiError(404, google))
  expect(text).toStartWith("Model không dùng được với provider này (404): This model models/gemini-2.5-flash is no longer available to new users.")
  expect(text).toContain("gemini-3.8-flash")
  expect(text).toEndWith("get-started). Gõ /model để chọn model khác.")
  expect(text).not.toContain("..")
})

test("404 with an HTML page or no text gives the plain line; a long reason is capped", () => {
  expect(describeError(apiError(404, "<!DOCTYPE html><html><body>Not Found</body></html>"))).toBe(
    "Model không dùng được với provider này (404). Gõ /model để chọn model khác.",
  )
  expect(describeError(apiError(404, ""))).toBe("Model không dùng được với provider này (404). Gõ /model để chọn model khác.")
  const long = describeError(apiError(404, "x".repeat(2000)))
  expect(long).toContain(`${"x".repeat(300)}…`)
  expect(long.length).toBeLessThan(400)
})

test("an AbortSignal.timeout error reads in Vietnamese, not 'The operation timed out.'", () => {
  const timeout = new DOMException("The operation timed out.", "TimeoutError")
  expect(describeError(timeout)).toBe("Hết thời gian chờ phản hồi.")
  // The user's own cancel stays as it was.
  expect(describeError(new DOMException("The operation was aborted.", "AbortError"))).toBe("Đã huỷ.")
})
