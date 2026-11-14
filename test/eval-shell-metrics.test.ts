import { expect, test } from "bun:test"
import path from "node:path"
import { readTrace } from "../scripts/eval/read-trace"
import { parseQuestions } from "../scripts/eval/runner"
import { parseLabels } from "../scripts/eval/scoring"
import { parseCommands, replayAll } from "../scripts/eval/shell-replay"
import { operandsOf, shellMetrics } from "../scripts/eval/shell-metrics"
import { shellExecMs, shellRoute } from "../scripts/eval/shell-route"
import { TRACE_VERSION, type TraceEvent } from "../scripts/eval/trace"
import { MATH_NEAR_MISS_PREFIX } from "../src/core/tools/shell/shell"

const DENIED = "Lời gọi này cần người dùng xác nhận, nhưng không có giao diện để hỏi. Không chạy."

test("shellRoute: what ran is named by its scope, what did not by the text the model read", () => {
  const ran = { executed: true, ok: true, visible: "[mã thoát 0 · 0.1s · /w]\n1" }
  expect(shellRoute({ ...ran, scope: "math:1+1", readOnly: false })).toBe("math")
  expect(shellRoute({ ...ran, scope: "cmd:git status", readOnly: true })).toBe("read-only")
  expect(shellRoute({ ...ran, scope: "read:git status", readOnly: false })).toBe("read-only")
  expect(shellRoute({ ...ran, scope: "cmd!python a.py", readOnly: false })).toBe("approved")
  // A command that ran and failed still ran.
  expect(shellRoute({ ...ran, ok: false, scope: "math:1/0", readOnly: false })).toBe("math")
  const refused = { executed: false, ok: false, readOnly: false }
  expect(shellRoute({ ...refused, scope: "cmd!python -c 1", visible: `${MATH_NEAR_MISS_PREFIX} nên chưa chạy` })).toBe("near-miss")
  expect(shellRoute({ ...refused, scope: "cmd!python a.py", visible: DENIED })).toBe("denied")
  expect(shellRoute({ ...refused, scope: "cmd!x", visible: "Người dùng từ chối chạy tool này. Lời nhắn của người dùng: eval: không có người duyệt" })).toBe("denied")
  expect(shellRoute({ ...refused, visible: "Không có thư mục /x." })).toBe("error")
})

test("shellExecMs reads the run time the tool writes, and nothing from another first line", () => {
  expect(shellExecMs("[mã thoát 0 · 0.3s · C:\\w]\n14.64")).toBe(300)
  expect(shellExecMs("[dừng vì quá 20s (đã giết cả các tiến trình con); … · 20.0s · /w]")).toBe(20000)
  expect(shellExecMs(DENIED)).toBeUndefined()
})

test("operandsOf: typed numbers with their decimals; formats, names and exponents are not operands", () => {
  expect(operandsOf(`awk 'BEGIN{printf "%.2f %10.4f\\n", (128.4/112-1)*100, 1.08^3}'`).map((o) => o.text)).toEqual(["128.4", "112", "1", "100", "1.08", "3"])
  expect(operandsOf('python -c "print(128.4/112)"').map((o) => o.text)).toEqual(["128.4", "112"])
  expect(operandsOf("[math]::Log10(52700000000/1e9); $x2 = 66.30").map((o) => [o.text, o.decimals])).toEqual([
    ["52700000000", 0],
    ["1e9", 0],
    ["66.30", 2],
  ])
})

const head: TraceEvent = { type: "run", trace_version: TRACE_VERSION, harness: "opentrading", harness_version: "0", provider: "p", model: "m", started_at: "2026-11-14T00:00:00Z", tools: 1 }
const answer = (q: string, text: string, requests: number): TraceEvent => ({
  type: "answer", q, rep: 1, text, outcome: "completed", unanswered: false, recoveries: [], data_gaps: [], model_steps: requests, requests, input_tokens: 0, output_tokens: 0, duration_ms: 0,
})
const call = (q: string, id: string, tool: string, command?: string): TraceEvent => ({ type: "tool_call", q, rep: 1, call_id: id, tool, input: command === undefined ? {} : { command }, step: 0 })

test("shellMetrics: routes, attempts where nothing ran, self-computed answers, operands against what was read before", () => {
  const events: TraceEvent[] = [
    head,
    { type: "question", q: "a", rep: 1, group: "A", question: "HPG tăng bao nhiêu % trong 20 phiên?", now: "2026-03-10T10:00:00+07:00" },
    call("a", "c1", "quote"),
    { type: "tool_result", q: "a", rep: 1, call_id: "c1", ok: true, visible: '{"close":[25.35,27.1]}', duration_ms: 5 },
    // 27.1 and 25.35 were fetched, 20 is in the question; 26.9 is in nothing the model read.
    call("a", "c2", "shell", `awk 'BEGIN{printf "%.4f\\n", (27.1/25.35-1)*100/20 + 26.9}'`),
    { type: "tool_result", q: "a", rep: 1, call_id: "c2", ok: true, visible: "[mã thoát 0 · 0.2s · /w]\n27.2452", duration_ms: 250, shell: { route: "math", exec_ms: 200 } },
    // The first command's output is a source for the next one.
    call("a", "c3", "shell", "27.2452*2"),
    { type: "tool_result", q: "a", rep: 1, call_id: "c3", ok: true, visible: "[mã thoát 0 · 0.4s · /w]\n68.113", duration_ms: 450, shell: { route: "math", exec_ms: 400 } },
    answer("a", "HPG tăng 6,9%.", 4),
    { type: "question", q: "b", rep: 1, group: "A", question: "CAGR?", now: "2026-03-10T10:00:00+07:00" },
    call("b", "d1", "shell", "python3 calc.py"),
    { type: "tool_result", q: "b", rep: 1, call_id: "d1", ok: false, visible: DENIED, duration_ms: 1, shell: { route: "denied" } },
    answer("b", "CAGR 8,1% (tự tính).", 2),
    // Cut by the run's request cap: says nothing about the harness.
    { type: "question", q: "c", rep: 1, group: "A", question: "x", now: "2026-03-10T10:00:00+07:00" },
    { ...answer("c", "", 1), abort: "cap" } as TraceEvent,
  ]
  const m = shellMetrics(readTrace(events.map((e) => JSON.stringify(e)).join("\n")))
  expect(m).toMatchObject({ attempts: 2, commands: 3, attempts_with_shell: 2, attempts_with_run: 1, attempts_all_refused: 1, self_computed: 1, requests_per_attempt: 3 })
  expect(m.routes).toMatchObject({ math: 2, denied: 1, "near-miss": 0 })
  expect(m.exec_ms).toEqual({ n: 2, mean: 300, p50: 200, max: 400 })
  expect(m.operands.total).toBe(5)
  expect(m.operands.traced).toBe(4)
  expect(m.operands.untraced.map((u) => u.value)).toEqual(["26.9"])
})

test("a trace written before the shell field has no shell commands to count", () => {
  const events: TraceEvent[] = [
    head,
    { type: "question", q: "a", rep: 1, group: "A", question: "x", now: "2026-03-10T10:00:00+07:00" },
    call("a", "c1", "shell", "1+1"),
    { type: "tool_result", q: "a", rep: 1, call_id: "c1", ok: true, visible: "2", duration_ms: 1 },
    answer("a", "2", 1),
  ]
  expect(shellMetrics(readTrace(events.map((e) => JSON.stringify(e)).join("\n")))).toMatchObject({ attempts: 1, commands: 0, attempts_with_shell: 0 })
})

// --- Replay of recorded commands against the grammar (no model, no shell) ---

test("the command forms of issue #268 against the grammar: where each one ends up today", async () => {
  // Provisional set, written from the five forms the issue lists until the real commands of that
  // run are in. A PR that widens the grammar or the near-miss moves these numbers, on purpose.
  const commands = parseCommands(await Bun.file(path.join(import.meta.dir, "fixtures", "shell-commands.jsonl")).text())
  const report = replayAll(commands)
  expect(report.commands).toBe(14)
  expect(report.total).toEqual({ run: 3, near: 1, ask: 10 })
  expect(report.forms["awk-one-line"]).toEqual({ run: 3, near: 0, ask: 0 })
  for (const form of ["awk-vars", "awk-printf-parens", "awk-multiline", "awk-long", "awk-newline-in-format"]) expect(report.forms[form]!.run).toBe(0)
})

test("the compute question set parses as questions and every question has a label", async () => {
  const text = await Bun.file(path.join(import.meta.dir, "..", "scripts", "eval", "questions", "compute.json")).text()
  const questions = parseQuestions(text)
  expect(questions).toHaveLength(12)
  expect(parseLabels(text).size).toBe(12)
})
