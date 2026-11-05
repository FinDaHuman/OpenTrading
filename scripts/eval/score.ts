import { readFile, writeFile } from "node:fs/promises"
import { readTrace } from "./read-trace"
import { compare, parseLabels, scoreTrace } from "./scoring"

/**
 * Scores a trace from scripts/eval/run.ts in code, offline: no model, no key, no quota.
 *
 * Cách chạy: bun scripts/eval/score.ts trace.jsonl --labels questions.json
 *            [--against other.jsonl] [--out score.json]
 */

const args = process.argv.slice(2)
const arg = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const file = args[0]
if (!file || file.startsWith("--")) {
  console.error("Thiếu file trace.")
  process.exit(1)
}
const labels = parseLabels(arg("--labels") ? await readFile(arg("--labels")!, "utf8") : "[]")
const report = scoreTrace(readTrace(await readFile(file, "utf8")), labels)

const percent = (r: { n: number; mean: number; ci: [number, number] }) =>
  r.n ? `${(r.mean * 100).toFixed(1)}% [${(r.ci[0] * 100).toFixed(1)}–${(r.ci[1] * 100).toFixed(1)}] (${r.n} câu)` : "chưa có dữ liệu"

console.log(`${report.harness} · ${report.model} · ${report.all.attempts} lượt chấm, ${report.unscored} lượt bị cắt không chấm${report.stopped ? " · dừng vì chạm trần request" : ""}`)
for (const [name, s] of [["Tất cả", report.all], ...Object.entries(report.groups).map(([g, v]) => [`Nhóm ${g}`, v] as const)] as const) {
  console.log(`\n${name}`)
  console.log(`  đúng            ${percent(s.correct)}`)
  console.log(`  số không có gốc ${percent(s.untraced)}`)
  console.log(`  có nguồn        ${percent(s.cited)}`)
  console.log(`  sai đơn vị      ${s.wrong_unit} / ${s.figures} số`)
  console.log(`  mỗi lượt        ${s.requests.toFixed(1)} request · ${Math.round(s.tokens)} token · ${s.seconds.toFixed(1)}s`)
  if (s.replay_misses) console.log(`  thiếu bản ghi   ${s.replay_misses}: không hoàn toàn trên dữ liệu cố định`)
}

const against = arg("--against")
const paired = against ? compare(report.scores, scoreTrace(readTrace(await readFile(against, "utf8")), labels).scores) : undefined
if (paired) console.log(`\nSo với ${against}: ${paired.pairs} cặp, chỉ bản này đúng ${paired.only_first}, chỉ bản kia đúng ${paired.only_second}, McNemar p=${paired.p.toFixed(4)}`)

const out = arg("--out")
if (out) await writeFile(out, JSON.stringify({ ...report, ...(paired ? { paired } : {}) }, null, 2))
