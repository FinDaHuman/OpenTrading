import { expect, test } from "bun:test"
import { parseFailureThresholds } from "../scripts/eval/failure-thresholds"
import { readTrace } from "../scripts/eval/read-trace"
import { TRACE_VERSION } from "../scripts/eval/trace"

test("failure thresholds default to production values and accept an eval override", () => {
  expect(parseFailureThresholds()).toEqual({ nudge: 4, stop: 8, breaker: 3 })
  expect(parseFailureThresholds("nudge=2,stop=4", "5")).toEqual({ nudge: 2, stop: 4, breaker: 5 })
})

test("invalid thresholds fail before an eval starts", () => {
  for (const value of ["nudge=0,stop=4", "nudge=4,stop=4", "nudge=5,stop=4", "nudge=1.5,stop=4", "stop=4,nudge=2"]) {
    expect(() => parseFailureThresholds(value)).toThrow()
  }
  for (const value of ["0", "-1", "1.5", "abc", "9007199254740992"]) expect(() => parseFailureThresholds(undefined, value)).toThrow()
})

test("the scorer reads traces with new policy events and old traces", () => {
  const header = { type: "run", trace_version: TRACE_VERSION, harness: "opentrading", provider: "x", model: "y" }
  const question = { type: "question", q: "q", rep: 1, group: "A", question: "x", now: "2026-01-01" }
  const events = [
    { type: "notice", q: "q", rep: 1, text: "nudge", failure_policy: { action: "nudge", streak: 2, step: 2 } },
    { type: "notice", q: "q", rep: 1, text: "breaker", breaker: { server: "data", event: "opened" } },
  ]
  for (const lines of [[header, question], [header, question, ...events]]) {
    expect(readTrace(lines.map((line) => JSON.stringify(line)).join("\n")).attempts).toHaveLength(1)
  }
})
