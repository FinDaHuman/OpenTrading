import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { agentRoots, loadAgents } from "../../src/core/agents/loader"
import { resolveTarget } from "../../src/core/chat"
import { loadConfig } from "../../src/core/config"
import { dataDir } from "../../src/core/paths"
import { initRuntime, setAgents } from "../../src/core/runtime"
import { loadSkills, skillRoots } from "../../src/core/skills/loader"
import pkg from "../../package.json"
import { Cassette } from "./cassette"
import { ledgerFile, RequestLedger, spentToday } from "./ledger"
import { parseAblations, parseQuestions, prepareHome, runEval, skillsFor } from "./runner"
import { traceFile } from "./trace"

/**
 * Runs a question set through the real agent loop and writes a JSONL trace. Spends the user's
 * quota, so it calls a model only with --yes, and it is never run by the tests.
 *
 * Cách chạy: bun scripts/eval/run.ts --questions file.json --model provider/model
 *            [--only id1,id2] [--repeat 1] [--timeout-min 15] [--max-requests 500]
 *            [--out trace.jsonl] [--yes]
 *            [--mcp-record tape.jsonl | --mcp-replay tape.jsonl] [--ablate a,b]
 *   --max-requests  trần request của model này trong ngày, cộng dồn qua các lần chạy
 *   --mcp-record    ghi câu trả lời MCP; câu đã có trong file thì không gọi server nữa
 *   --mcp-replay    chỉ dùng file đã ghi, không gọi server MCP
 *   --ablate        tắt từng phần của harness để đo (xem docs/eval/runner.md)
 */

const REQUESTS_PER_QUESTION = 5
/** The free daily quota of the models this is usually run on. */
const DEFAULT_MAX_REQUESTS = 500

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const stop = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const file = arg("--questions") ?? stop("Thiếu --questions <file.json>.")
const pick = arg("--model") ?? stop("Thiếu --model provider/model: mỗi lần chạy phải nêu rõ model.")
const slash = pick.indexOf("/")
if (slash <= 0) stop("--model phải có dạng provider/model.")
const model = { provider: pick.slice(0, slash), model: pick.slice(slash + 1) }
const only = arg("--only")?.split(",")
const repeat = Number(arg("--repeat") ?? 1)
const minutes = Number(arg("--timeout-min") ?? 15)
const cap = Number(arg("--max-requests") ?? DEFAULT_MAX_REQUESTS)
const record = arg("--mcp-record")
const replay = arg("--mcp-replay")
if (record && replay) stop("Chỉ dùng một trong --mcp-record và --mcp-replay.")
const tape = record ?? replay
const ablate = arg("--ablate")?.split(",") ?? []
const ablated = parseAblations(ablate)
const questions = parseQuestions(await readFile(file, "utf8")).filter((q) => !only || only.includes(q.id))
if (questions.length === 0) stop("Không còn câu hỏi nào sau --only.")

console.log(`${questions.length} câu × ${repeat} lần · ${pick}`)
const realHome = dataDir()
const ledger = ledgerFile(realHome)
console.log(`Dự kiến khoảng ${questions.length * repeat * REQUESTS_PER_QUESTION} request. Hôm nay đã dùng ${await spentToday(ledger, pick)}/${cap}.`)
// Never spends quota by accident: without --yes it only prints the plan above.
if (!process.argv.includes("--yes")) {
  console.log("Chỉ in ước tính. Thêm --yes để chạy thật (tốn quota của bạn).")
  process.exit(0)
}

const out = path.resolve(arg("--out") ?? path.join(realHome, "exports", `eval-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`))
const cassette = tape ? await Cassette.open(path.resolve(tape), record ? "record" : "replay") : undefined
const home = await mkdtemp(path.join(os.tmpdir(), "ot-eval-"))
const work = path.join(home, "work")
const commit = (await Bun.$`git rev-parse --short HEAD`.cwd(import.meta.dir).quiet().nothrow().text()).trim()
await mkdir(work)
await prepareHome(realHome, home, model, ablated)
process.env.OPENTRADING_HOME = home
const requests = await RequestLedger.open(ledger, pick, cap)
// The home holds a copy of the keys, and requests already sent are spent quota.
process.on("SIGINT", () => {
  void requests
    .flush()
    .finally(() => rm(home, { recursive: true, force: true }))
    .finally(() => process.exit(130))
})

const { skills } = await loadSkills(skillRoots(work, { project: false }))
const runtime = initRuntime({ home, cwd: work, skills: () => skillsFor(skills, ablated), mcpTransport: cassette && ((server, real) => cassette.transport(server, real)) })
try {
  setAgents(runtime, (await loadAgents(agentRoots(work, { project: false }))).agents)
  await runtime.mcp.start()
  // A run with no data server only measures the model: stop before spending anything.
  if (!runtime.registry.list().some((t) => t.source?.startsWith("mcp:"))) throw new Error("Không có tool MCP nào: kiểm tra kết nối MCP.")
  const target = await resolveTarget(model)
  const { effort, toolSearch, maxSteps } = await loadConfig()
  const settings = { effort, toolSearch, maxSteps, ablate, mcp: cassette?.mode ?? "live", ...(tape ? { mcp_tape: path.basename(tape), mcp_answers: cassette!.size } : {}) }
  await runEval({ runtime, skills, target, questions, repeat, timeoutMs: minutes * 60_000, write: traceFile(out), version: pkg.version, commit, settings, ledger: requests, ablated })
  console.log(`Trace: ${out}`)
  if (cassette?.misses) console.log(`${cassette.misses} yêu cầu MCP không có trong bản ghi: lần chạy này không hoàn toàn trên dữ liệu cố định.`)
} finally {
  await runtime.mcp.stop()
  await rm(home, { recursive: true, force: true })
}
