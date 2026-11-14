import { expect, test } from "bun:test"
import path from "node:path"
import { readTrace } from "../scripts/eval/read-trace"
import { parseQuestions } from "../scripts/eval/runner"
import { parseLabels, scoreAttempt } from "../scripts/eval/scoring"
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

test("an operand traces only to data the model read: not a status line, not a denial, and an integer only to itself", () => {
  const events: TraceEvent[] = [
    head,
    { type: "question", q: "a", rep: 1, group: "A", question: "Khối lượng các phiên: 12543200; 13876500; 11987300. Trung bình?", now: "2026-03-10T10:00:00+07:00" },
    // A denial that names a number, and a refused command: neither is data.
    call("a", "c0", "shell", "python3 vol.py 77"),
    { type: "tool_result", q: "a", rep: 1, call_id: "c0", ok: false, visible: `${DENIED} (mã 77)`, duration_ms: 1, shell: { route: "denied" } },
    // 13876500 mistyped as 13876400; 3 is a constant. 0.2s and exit code 0 are the tool's own line.
    call("a", "c1", "shell", "(12543200+13876400+11987300)/3"),
    { type: "tool_result", q: "a", rep: 1, call_id: "c1", ok: true, visible: "[mã thoát 0 · 0.2s · /w/20]\n12802300", duration_ms: 250, shell: { route: "math", exec_ms: 200 } },
    // 20 is only in the status line (as 0.2s × 100, and in the folder name); 77 only in the denial.
    call("a", "c2", "shell", "12802300/20 + 77"),
    { type: "tool_result", q: "a", rep: 1, call_id: "c2", ok: true, visible: "[mã thoát 0 · 0.1s · /w/20]\n640192", duration_ms: 150, shell: { route: "math", exec_ms: 100 } },
    answer("a", "Trung bình 12.802.300 cổ phiếu.", 3),
  ]
  const m = shellMetrics(readTrace(events.map((e) => JSON.stringify(e)).join("\n")))
  expect(m.operands.total).toBe(6)
  expect(m.operands.traced).toBe(3)
  expect(m.operands.untraced.map((u) => u.value)).toEqual(["13876400", "20", "77"])
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
  const synthetic = replayAll(commands.filter((c) => c.source !== "r0-gemini-flash-lite"))
  expect(synthetic.commands).toBe(14)
  // Grammar v2: every awk form of the issue runs (was run 3, near 1, ask 10). The python forms
  // are left: two multi-line ones still reach the gate.
  expect(synthetic.total).toEqual({ run: 11, near: 1, ask: 2 })
  for (const form of ["awk-one-line", "awk-vars", "awk-printf-parens", "awk-multiline", "awk-long", "awk-newline-in-format"]) expect([form, synthetic.forms[form]!.near + synthetic.forms[form]!.ask]).toEqual([form, 0])
  expect(synthetic.forms.python).toEqual({ run: 0, near: 1, ask: 2 })
})

test("the commands gemini-3.1-flash-lite really sent on 14/11 (run R0, both shells): what runs, and what a series still needs", async () => {
  const commands = parseCommands(await Bun.file(path.join(import.meta.dir, "fixtures", "shell-commands.jsonl")).text()).filter((c) => c.source === "r0-gemini-flash-lite")
  const report = replayAll(commands)
  expect(report.commands).toBe(24)
  // On the grammar before v2: run 17, ask 7. v2 takes the PowerShell command with variables.
  expect(report.total).toEqual({ run: 18, near: 0, ask: 6 })
  expect(report.forms["ps-expression"]).toEqual({ run: 9, near: 0, ask: 0 })
  expect(report.forms["awk-expression"]).toEqual({ run: 8, near: 0, ask: 0 })
  expect(report.forms["ps-vars"]).toEqual({ run: 1, near: 0, ask: 0 })
  // A series (MA20, 30 volumes, volatility, drawdown) was written as an array with a loop
  // (`split(…)` + `for` in awk, `@(…)` + `foreach` in PowerShell): not arithmetic-only yet.
  expect(report.forms["ps-series-loop"]).toEqual({ run: 0, near: 0, ask: 2 })
  expect(report.forms["awk-series-loop"]).toEqual({ run: 0, near: 0, ask: 4 })
})

/** A right answer to each compute question, written the way the prompt asks (Vietnamese number format). */
const RIGHT: Record<string, string> = {
  "compute-01-pct": "HPG tăng 6,903% giữa hai ngày.",
  "compute-02-cagr": "CAGR 4 năm là 15,223%.",
  "compute-03-logreturn": "Lợi suất log quy năm: 21,659%.",
  "compute-04-ma20": "MA20 = 25,880 nghìn đồng.",
  "compute-05-volume": "Phiên cuối bằng 94,18% khối lượng trung bình 30 phiên.",
  "compute-06-rs": "RS = 6,732 điểm %.",
  "compute-07-volatility": "Độ biến động quy năm là 16,255%.",
  "compute-08-eps": "EPS = 6.120,00 đồng.",
  "compute-09-pe": "P/E = 15,768 lần.",
  "compute-10-portfolio": "Lợi suất danh mục là 5,418%.",
  "compute-11-compound": "Số tiền cuối kỳ: 143.178.841 đồng.",
  "compute-12-drawdown": "Max drawdown là 13,707%.",
}
/** The same questions answered 1% off, and one answered with the inputs only. */
const WRONG: Record<string, string> = {
  "compute-01-pct": "HPG tăng 6,972% giữa hai ngày.",
  "compute-02-cagr": "CAGR 4 năm là 15,375%.",
  "compute-09-pe": "P/E = 15,926 lần.",
  "compute-11-compound": "Số tiền cuối kỳ: 144.610.630 đồng.",
  "compute-08-eps": "Lợi nhuận 1.315.800.000.000 đồng, 215.000.000 cổ phiếu.",
}

test("the compute labels mark a right answer right and a wrong one wrong, as the scorer reads them", async () => {
  const text = await Bun.file(path.join(import.meta.dir, "..", "scripts", "eval", "questions", "compute.json")).text()
  const labels = parseLabels(text)
  const scored = (id: string, said: string) => {
    const q = parseQuestions(text).find((x) => x.id === id)!
    const events: TraceEvent[] = [head, { type: "question", q: id, rep: 1, group: q.group, question: q.question, now: q.now }, answer(id, said, 2)]
    return scoreAttempt(readTrace(events.map((e) => JSON.stringify(e)).join("\n")).attempts[0]!, labels)!.correct
  }
  for (const [id, said] of Object.entries(RIGHT)) expect([id, scored(id, said)]).toEqual([id, true])
  for (const [id, said] of Object.entries(WRONG)) expect([id, scored(id, said)]).toEqual([id, false])
  expect(Object.keys(RIGHT)).toHaveLength(labels.size)
})

test("the compute question set parses as questions and every question has a label", async () => {
  const text = await Bun.file(path.join(import.meta.dir, "..", "scripts", "eval", "questions", "compute.json")).text()
  const questions = parseQuestions(text)
  expect(questions).toHaveLength(12)
  expect(parseLabels(text).size).toBe(12)
})
