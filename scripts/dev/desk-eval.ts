import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { generateText } from "ai"
import { runAgent } from "../../src/core/agent"
import { loadAgents } from "../../src/core/agents/loader"
import { resolveTarget } from "../../src/core/chat"
import { loadConfig } from "../../src/core/config"
import { deskSettings } from "../../src/core/desk/settings"
import { dataDir } from "../../src/core/paths"
import { languageModel } from "../../src/core/providers"
import { initRuntime, setAgents } from "../../src/core/runtime"
import { loadSkills } from "../../src/core/skills/loader"
import {
  caseProblems,
  loadDeskCases,
  projectedRequests,
  runDeskEval,
  summarize,
  WORTH,
  type ArmResult,
  type DeskEvalCase,
} from "../../test/helpers/desk-eval"

/**
 * Ultradesk eval for ADR 0006: each case is answered by today's default path (the main agent
 * with every tool, subagents included, on the question as typed) and by its playbook (the same
 * request as desk_run args), then an LLM judge scores both blind. Spends the user's quota — about 50 requests per case at the small size — and
 * is never run by the tests. Approvals: read-only per-call prompts (web_fetch domains) are
 * allowed once, anything else is denied, so an unattended run never hangs.
 *
 * Cách chạy: bun scripts/dev/desk-eval.ts [--only 1,6,11] [--playbook sang-loc] [--size small]
 *            [--arm both|desk|single] [--judge provider/model] [--out file.json] [--yes]
 *   --only      chỉ chạy các ca có id này
 *   --playbook  chỉ chạy các ca của playbook này
 *   --size      quy mô desk (mặc định: desk.size trong config, thường là small)
 *   --arm       chỉ chạy một nhánh (không chấm)
 *   --judge     model chấm (mặc định: model của phiên); nên dùng model mạnh hơn hai nhánh
 *   --out       nơi ghi kết quả JSON (mặc định ~/.opentrading/exports/desk-eval-<thời điểm>.json)
 *   --yes       chạy thật; không có cờ này thì chỉ in số ca và request dự kiến rồi thoát
 */

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const root = path.resolve(import.meta.dir, "../..")
const all = loadDeskCases(root)
const problems = caseProblems(all)
if (problems.length > 0) {
  console.error(`Bộ ca lỗi:\n${problems.join("\n")}`)
  process.exit(1)
}
const only = arg("--only")?.split(",").map(Number)
const cases = all.filter((c) => (!only || only.includes(c.id)) && (!arg("--playbook") || c.playbook === arg("--playbook")))
const armArg = arg("--arm") ?? "both"
const arms = { single: armArg !== "desk", desk: armArg !== "single" }
const config = await loadConfig()
const size = arg("--size") ?? deskSettings(config).size
const projected = projectedRequests(cases, arms, size)
const session = await resolveTarget()
const judgePick = arg("--judge")
const judgeTarget = judgePick ? await resolveTarget({ provider: judgePick.split("/")[0], model: judgePick.split("/").slice(1).join("/") }) : session
console.log(`${cases.length} ca · quy mô ${size} · nhánh ${armArg} · model phiên ${session.provider.id}/${session.model} · judge ${judgeTarget.provider.id}/${judgeTarget.model}`)
console.log(`Dự kiến tối đa ~${projected} request (quota ngày của gói miễn phí thường là 500).`)
// Never spends quota by accident: without --yes it only prints the plan above.
if (!process.argv.includes("--yes")) {
  console.log("Chỉ in ước tính. Thêm --yes để chạy thật (tốn quota của bạn); thu hẹp bằng --only / --playbook.")
  process.exit(0)
}

const { skills } = await loadSkills()
const runtime = initRuntime({ skills: () => skills })
setAgents(runtime, (await loadAgents()).agents)
// Unattended: read-only per-call approvals (web_fetch domains) once, everything else denied.
runtime.permissions.onChange((head) => {
  if (!head) return
  const def = runtime.registry.get(head.tool)
  void runtime.permissions.respond(head.id, def?.readOnly && head.choices.includes("once") ? "once" : "deny", "desk-eval: không có người duyệt")
})
await runtime.mcp.start()

async function single(c: DeskEvalCase): Promise<ArmResult> {
  const started = Date.now()
  // Subagents a skill spawns are part of the default path: their requests count too.
  const before = new Set(runtime.subagents.list().map((v) => v.id))
  let text = ""
  let requests = 0
  let tokens = 0
  let error: string | undefined
  for await (const event of runAgent({ history: [], input: c.question, skills, registry: runtime.registry, serverInstructions: () => runtime.mcp.instructions() })) {
    if (event.type === "text-delta") text += event.text
    else if (event.type === "step") requests++
    else if (event.type === "step-usage") tokens += event.inputTokens + event.outputTokens
    else if (event.type === "error") error = event.message
  }
  for (const v of runtime.subagents.list()) {
    if (before.has(v.id) || v.deskRunId) continue
    requests += v.requests ?? 0
    tokens += v.usage.input + v.usage.output
  }
  return { text: text.trim(), requests, tokens, seconds: Math.round((Date.now() - started) / 1000), error }
}

async function desk(c: DeskEvalCase): Promise<ArmResult> {
  const started = Date.now()
  const { done } = await runtime.desk.start(c.playbook, c.args, { size: (c.size ?? size) as never })
  const view = await done
  const text = typeof view.result === "string" ? view.result : view.result === undefined ? "" : JSON.stringify(view.result, null, 2)
  return {
    text,
    requests: view.counters.requests,
    tokens: view.counters.input + view.counters.output,
    seconds: Math.round((Date.now() - started) / 1000),
    error: view.status === "failed" ? view.error : view.cut ? `run bị cắt (${view.cut})` : undefined,
  }
}

async function judge(prompt: string) {
  // No blind SDK retries: a daily-quota 429 must not be repeated.
  const result = await generateText({ model: languageModel(judgeTarget.provider, judgeTarget.model, judgeTarget.apiKey), prompt, temperature: 0, maxRetries: 0 })
  return { text: result.text, requests: 1 }
}

const rows = await runDeskEval(cases, { single, desk, judge, log: (line) => console.log(line) }, arms)
const s = summarize(rows)
const pct = (x: number) => `${(100 * x).toFixed(0)}%`
console.log("")
for (const [name, p] of Object.entries(s.perPlaybook)) {
  console.log(`${name.padEnd(11)} chấm ${p.judged} · desk ${p.deskMean.toFixed(2)} vs mặc định ${p.singleMean.toFixed(2)} · request desk ${p.deskRequests} / mặc định ${p.singleRequests}`)
}
console.log("")
console.log(`Chấm được ${s.judged}/${rows.length} ca (ca có nhánh lỗi/bị cắt không chấm) · điểm trung bình desk ${s.deskMean.toFixed(2)} vs mặc định ${s.singleMean.toFixed(2)} (chênh ${(s.deskMean - s.singleMean).toFixed(2)})`)
console.log(`Thắng: desk ${s.deskWins} · mặc định ${s.singleWins} · hoà ${s.ties} (desk thắng ${s.judged ? pct(s.deskWins / s.judged) : "-"})`)
console.log(`Request: desk ${s.requests.desk} · mặc định ${s.requests.single} · judge ${s.requests.judge}`)
const unreferenced = cases.filter((c) => c.playbook === "kiem-chung" && !c.tham_chieu).length
if (unreferenced > 0) console.log(`Lưu ý: ${unreferenced} ca kiem-chung chưa có tham_chieu: điểm chinh_xac của chúng chưa nói lên đúng/sai.`)
console.log(
  s.worth
    ? `=> Đạt ngưỡng ADR 0006 (chênh ≥ ${WORTH.minDelta}, desk thắng ≥ ${pct(WORTH.minWinRate)}): có cơ sở chuyển ADR sang accepted và làm chặng 2.`
    : `=> Chưa đạt ngưỡng ADR 0006 (chênh ≥ ${WORTH.minDelta}, desk thắng ≥ ${pct(WORTH.minWinRate)}): giữ ADR ở proposed, chưa làm chặng 2.`,
)

const out = arg("--out") ?? path.join(dataDir(), "exports", `desk-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
await mkdir(path.dirname(out), { recursive: true })
await writeFile(out, JSON.stringify({ size, arms: armArg, session: `${session.provider.id}/${session.model}`, judge: `${judgeTarget.provider.id}/${judgeTarget.model}`, summary: s, rows }, null, 2))
console.log(`Kết quả: ${out}`)
await runtime.desk.flush()
await runtime.mcp.stop()
