import { expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { doctorLocalTool, turnsOf } from "../src/core/tools/session/history"

const ctx = { signal: new AbortController().signal, callId: "c1" }

test("session_get turns: each question keeps the last answer text of its turn, tool steps are skipped", () => {
  const messages: ModelMessage[] = [
    { role: "user", content: "giá FPT hôm nay?" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "t1", toolName: "vn_quote_history", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "t1", toolName: "vn_quote_history", output: { type: "text", value: "…" } }] },
    { role: "assistant", content: [{ type: "text", text: "FPT đóng cửa 118,0." }] },
    { role: "user", content: "còn VCB?" },
    { role: "assistant", content: "VCB 57,3." },
  ]
  expect(turnsOf(messages)).toEqual([
    { question: "giá FPT hôm nay?", answer: "FPT đóng cửa 118,0." },
    { question: "còn VCB?", answer: "VCB 57,3." },
  ])
})

test("doctor_local names providers (never keys), the data folder, MCP errors and skills hidden for missing tools", async () => {
  const doctor = doctorLocalTool({
    mcpStatus: () => [{ name: "opentrading", state: "failed", tools: [], error: "HTTP 502" }],
    model: async () => "google/gemini-3.1-flash-lite",
    home: "/tmp/ot",
    providers: async () => ["google", "groq"],
    hiddenSkills: () => [{ name: "dinh-vi-chu-ky-vn", missing: ["cycle_stats_check"] }],
  })
  const out = (await doctor.execute({}, ctx)) as string
  expect(out).toContain("Provider đã có key: google, groq")
  expect(out).toContain("- opentrading: failed (0 tool) — HTTP 502")
  expect(out).toContain("- dinh-vi-chu-ky-vn: thiếu cycle_stats_check")
  expect(out).toContain("Thư mục dữ liệu: /tmp/ot")
})
