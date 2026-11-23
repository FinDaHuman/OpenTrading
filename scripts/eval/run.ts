import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { agentRoots, loadAgents } from "../../src/core/agents/loader"
import { resolveTarget } from "../../src/core/chat"
import { loadConfig } from "../../src/core/config"
import { EFFORT_LEVELS, isEffort, type Effort } from "../../src/core/effort"
import { dataDir } from "../../src/core/paths"
import { initRuntime, setAgents } from "../../src/core/runtime"
import { loadSkills, skillRoots } from "../../src/core/skills/loader"
import { detectShell } from "../../src/core/tools/shell/run"
import { MIN_REQUEST_BUDGET } from "../../src/core/request-budget"
import pkg from "../../package.json"
import { Cassette } from "./cassette"
import { ledgerFile, RequestLedger, spentToday } from "./ledger"
import { describeRouting } from "../../src/core/openrouter-routing"
import { parseAblations, parseQuestions, prepareHome, routingFromFlags, runEval, servedSummary, skillsFor } from "./runner"
import { traceFile, type TraceEvent } from "./trace"
import { parseFailureThresholds } from "./failure-thresholds"
import { requestCap } from "./request-cap"
import type { BreakerEvent } from "../../src/core/mcp/breaker"

/**
 * Runs a question set through the real agent loop and writes a JSONL trace. Spends the user's
 * quota, so it calls a model only with --yes, and it is never run by the tests.
 *
 * Cách chạy: bun scripts/eval/run.ts --questions file.json --model provider/model
 *            [--only id1,id2] [--repeat 1] [--timeout-min 15] [--max-requests 500]
 *            [--out trace.jsonl] [--yes]
 *            --memory notebook|none
 *            [--mcp-record tape.jsonl | --mcp-replay tape.jsonl] [--ablate a,b] [--yolo]
 *   --max-requests  trần request của model này trong ngày, cộng dồn qua các lần chạy
 *   --turn-requests trần request của mỗi câu (như trần của benchmark); gần chạm thì model tổng kết
 *   --http-request-cap trần cứng mọi request model của tiến trình, kể cả retry và side-model
 *   --failure-streak nudge=2,stop=4  đổi ngưỡng nhắc/dừng chỉ trong eval
 *   --breaker-threshold 3  đổi số lỗi kết nối trước khi breaker mở chỉ trong eval
 *   --mcp-record    ghi câu trả lời MCP; câu đã có trong file thì không gọi server nữa
 *   --mcp-replay    chỉ dùng file đã ghi, không gọi server MCP
 *   --ablate        tắt từng phần của harness để đo (xem docs/eval/runner.md)
 *   --effort        mức suy luận của lần chạy (low|medium|high|xhigh|max), ghi vào config tạm; không nêu thì
 *                   dùng mặc định của model, không đọc effort trong config của người chạy (#338)
 *   --investor      file hồ sơ nhà đầu tư cố định, chép thành INVESTOR.md của lần chạy; trace ghi sha256
 *   --memory        notebook: mỗi câu một sổ ghi nhớ rỗng (prompt có hướng dẫn memory, tool memory_read);
 *                   none: không memory (mặc định của sản phẩm). Bắt buộc nêu rõ, như --model.
 *   --yolo          chế độ ▸▸▸ bỏ qua quyền thay cho danh sách duyệt hẹp (chỉ web_fetch)
 *   --result-files  thư mục trong thư mục làm việc (vd ot-data): mỗi kết quả dữ liệu cũng ghi thành rN.json
 *                   cho script đọc, như config results.exportDir (#309 A2); không có cờ thì không ghi
 *   --or-provider   (chỉ model openrouter/…) ghim provider theo thứ tự, vd deepseek hoặc deepinfra/fp8 → provider.order
 *   --or-no-fallback  không cho OpenRouter chuyển sang provider khác → allow_fallbacks: false
 *   --or-quant      chỉ dùng các mức quantization này, vd fp8 → provider.quantizations
 *                   Ghim chỉ lấy từ cờ, không từ config của bạn. Trace ghi served_by (provider thật) mỗi câu.
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
const profileArg = arg("--profile")
if (profileArg !== undefined && profileArg !== "machine" && profileArg !== "terminal") stop("--profile chỉ nhận machine hoặc terminal.")
const profile = profileArg === "machine" ? ("machine" as const) : undefined
const turnRequests = arg("--turn-requests") === undefined ? undefined : Number(arg("--turn-requests"))
if (turnRequests !== undefined && !(Number.isInteger(turnRequests) && turnRequests >= MIN_REQUEST_BUDGET)) stop(`--turn-requests cần số nguyên từ ${MIN_REQUEST_BUDGET} trở lên.`)
for (const flag of ["--failure-streak", "--breaker-threshold", "--http-request-cap"]) {
  if (process.argv.includes(flag) && (!arg(flag) || arg(flag)!.startsWith("--"))) stop(`Thiếu giá trị ${flag}.`)
}
const thresholds = parseFailureThresholds(arg("--failure-streak"), arg("--breaker-threshold"))
const httpCapText = arg("--http-request-cap")
const httpCap = httpCapText === undefined ? undefined : /^\d+$/.test(httpCapText) ? Number(httpCapText) : NaN
if (httpCap !== undefined && (!Number.isSafeInteger(httpCap) || httpCap < 1)) stop("--http-request-cap cần số nguyên dương.")
const record = arg("--mcp-record")
const replay = arg("--mcp-replay")
if (record && replay) stop("Chỉ dùng một trong --mcp-record và --mcp-replay.")
const tape = record ?? replay
const pin = routingFromFlags(model.provider, { orProvider: arg("--or-provider"), noFallback: process.argv.includes("--or-no-fallback"), quant: arg("--or-quant") })
if (pin.error) stop(pin.error)
const routing = pin.routing
const ablate = arg("--ablate")?.split(",") ?? []
const ablated = parseAblations(ablate)
const yolo = process.argv.includes("--yolo")
const resultFiles = arg("--result-files")
const effortArg = arg("--effort")
if (effortArg !== undefined && !isEffort(effortArg)) stop(`--effort chỉ nhận ${EFFORT_LEVELS.join(", ")} (nhận "${effortArg}").`)
const investorArg = arg("--investor")
const investor = investorArg ? path.resolve(investorArg) : undefined
if (investor && !(await Bun.file(investor).exists())) stop(`Không thấy file --investor: ${investor}`)
const memoryArg = arg("--memory") ?? stop("Thiếu --memory notebook|none: mỗi lần chạy phải nêu rõ có memory hay không.")
const memory = memoryArg === "notebook" || memoryArg === "none" ? memoryArg : stop(`--memory chỉ nhận notebook hoặc none (nhận "${memoryArg}").`)
const questions = parseQuestions(await readFile(file, "utf8")).filter((q) => !only || only.includes(q.id))
if (questions.length === 0) stop("Không còn câu hỏi nào sau --only.")

console.log(`${questions.length} câu × ${repeat} lần · ${pick}${model.provider === "openrouter" ? ` · ${describeRouting(routing)}` : ""}`)
for (const warning of pin.warnings) console.log(`Cảnh báo: ${warning}`)
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
const { investorSha256 } = await prepareHome(realHome, home, model, ablated, routing, { ...(effortArg ? { effort: effortArg as Effort } : {}), ...(investor ? { investor } : {}) })
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
const breakerEvents: { server: string; event: BreakerEvent }[] = []
const runtime = initRuntime({ home, cwd: work, resultFiles, skills: () => skillsFor(skills, ablated), mcpTransport: cassette && ((server, real) => cassette.transport(server, real)), mcpBreakerThreshold: thresholds.breaker, onMcpBreakerEvent: (server, event) => breakerEvents.push({ server, event }) })
const hardCap = httpCap === undefined ? undefined : requestCap(httpCap)
try {
  setAgents(runtime, (await loadAgents(agentRoots(work, { project: false }))).agents)
  await runtime.mcp.start()
  // A run with no data server only measures the model: stop before spending anything.
  if (!runtime.registry.list().some((t) => t.source?.startsWith("mcp:"))) throw new Error("Không có tool MCP nào: kiểm tra kết nối MCP.")
  const target = await resolveTarget(model)
  const { effort, toolSearch, maxSteps } = await loadConfig()
  // The shell decides which arithmetic form runs unasked (awk on bash/sh, expressions on PowerShell).
  const settings = { effort, failure_thresholds: thresholds, ...(httpCap !== undefined ? { http_request_cap: httpCap } : {}), ...(investorSha256 ? { investor_sha256: investorSha256 } : {}), toolSearch, maxSteps, ablate, memory, shell: detectShell().kind, profile: profile ?? "terminal", ...(turnRequests !== undefined ? { turn_requests: turnRequests } : {}), permissions: yolo ? "bypass" : "unattended", ...(resultFiles ? { result_files: resultFiles } : {}), mcp: cassette?.mode ?? "live", ...(routing ? { openrouter_routing: routing } : {}), ...(tape ? { mcp_tape: path.basename(tape), mcp_answers: cassette!.size } : {}) }
  // Tallied from this run's own answers: --out may name a file that already holds earlier runs.
  const answers: TraceEvent[] = []
  const toFile = traceFile(out)
  const write = (event: TraceEvent) => {
    if (event.type === "answer") answers.push(event)
    toFile(event)
  }
  await runEval({ runtime, skills, target, questions, repeat, timeoutMs: minutes * 60_000, write, version: pkg.version, commit, settings, ledger: requests, ablated, yolo, memory, failureThresholds: thresholds, breakerEvents, ...(hardCap && httpCap !== undefined ? { httpCap: { get capped() { return hardCap.capped }, get refused() { return hardCap.refused }, get sent() { return hardCap.sent }, cap: httpCap } } : {}), ...(profile ? { profile } : {}), ...(turnRequests !== undefined ? { turnRequests } : {}) })
  console.log(`Trace: ${out}`)
  const served = servedSummary(answers)
  if (Object.keys(served).length > 0) console.log(`Provider đã trả lời (số bước): ${Object.entries(served).map(([by, n]) => `${by} ${n}`).join(", ")}`)
  if (cassette?.misses) console.log(`${cassette.misses} yêu cầu MCP không có trong bản ghi: lần chạy này không hoàn toàn trên dữ liệu cố định.`)
} finally {
  hardCap?.stop()
  await runtime.mcp.stop()
  await rm(home, { recursive: true, force: true })
}
