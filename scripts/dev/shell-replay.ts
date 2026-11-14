import { readFile } from "node:fs/promises"
import { parseCommands, replayAll, replayCommand } from "../eval/shell-replay"

/**
 * Replays recorded arithmetic commands against the math-only grammar: how many would run
 * unasked, be refused with the form to use, or reach the approval gate. Offline: no model, no key.
 *
 * File: one JSON object per line, { "shell": "bash" | "sh" | "pwsh" | "powershell", "command": "…", "form"?: "…" }.
 * Cách chạy: bun scripts/dev/shell-replay.ts commands.jsonl [--ask]
 */

const args = process.argv.slice(2)
const file = args[0]
if (!file || file.startsWith("--")) {
  console.error("Thiếu file lệnh (.jsonl).")
  process.exit(1)
}
const commands = parseCommands(await readFile(file, "utf8"))
const report = replayAll(commands)
const share = (n: number) => `${n} (${report.commands ? ((n / report.commands) * 100).toFixed(0) : 0}%)`
console.log(`${report.commands} lệnh · chạy ngay ${share(report.total.run)} · gợi ý dạng đúng ${share(report.total.near)} · tới cổng duyệt ${share(report.total.ask)}`)
for (const [form, n] of Object.entries(report.forms)) console.log(`  ${form.padEnd(24)} chạy ${n.run} · gợi ý ${n.near} · cổng ${n.ask}`)
if (args.includes("--ask")) for (const c of commands) if (replayCommand(c) === "ask") console.log(`\n[${c.shell}] ${c.command}`)
