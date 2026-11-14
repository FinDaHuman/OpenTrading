import { readFile, writeFile } from "node:fs/promises"
import { readTrace } from "../eval/read-trace"
import { shellMetrics } from "../eval/shell-metrics"
import { SHELL_ROUTES } from "../eval/shell-route"

/**
 * How the `shell` tool served the model's arithmetic in an eval trace (scripts/eval/run.ts):
 * commands run, refused with the form to use, denied; answers computed in the model's head;
 * operands that trace back to what the model read. Offline: no model, no key.
 *
 * Cách chạy: bun scripts/dev/shell-metrics.ts trace.jsonl [--untraced] [--out metrics.json]
 */

const args = process.argv.slice(2)
const file = args[0]
if (!file || file.startsWith("--")) {
  console.error("Thiếu file trace.")
  process.exit(1)
}
const trace = readTrace(await readFile(file, "utf8"))
const m = shellMetrics(trace)
const share = (n: number, of: number) => (of ? `${n}/${of} (${((n / of) * 100).toFixed(0)}%)` : `${n}/0`)
const shell = (trace.run.settings as { shell?: string } | undefined)?.shell ?? "không ghi"

console.log(`${trace.run.harness} · ${trace.run.model} · shell ${shell} · ${m.attempts} lượt`)
console.log(`\nLệnh shell: ${m.commands}`)
for (const route of SHELL_ROUTES) console.log(`  ${route.padEnd(10)} ${share(m.routes[route], m.commands)}`)
console.log(`\nLượt có gọi shell          ${share(m.attempts_with_shell, m.attempts)}`)
console.log(`  có ít nhất 1 lệnh chạy   ${share(m.attempts_with_run, m.attempts_with_shell)}`)
console.log(`  mọi lệnh đều không chạy  ${share(m.attempts_all_refused, m.attempts_with_shell)}`)
console.log(`Câu trả lời ghi "tự tính"  ${share(m.self_computed, m.attempts)}`)
console.log(`Request mỗi lượt           ${m.requests_per_attempt.toFixed(2)}`)
console.log(`Thời gian mỗi lệnh chạy    ${m.exec_ms.n ? `TB ${Math.round(m.exec_ms.mean)} ms · p50 ${m.exec_ms.p50} ms · max ${m.exec_ms.max} ms (${m.exec_ms.n} lệnh)` : "chưa có lệnh nào chạy"}`)
console.log(`Toán hạng truy được        ${share(m.operands.traced, m.operands.total)} (lệnh chỉ-toán và near-miss; bỏ hằng số)`)
if (args.includes("--untraced")) for (const u of m.operands.untraced) console.log(`  ${u.q}#${u.rep}  ${u.value}  ←  ${u.command.replace(/\s+/g, " ").slice(0, 160)}`)

const at = args.indexOf("--out")
if (at >= 0 && args[at + 1]) await writeFile(args[at + 1]!, JSON.stringify({ model: trace.run.model, shell, ...m }, null, 2))
