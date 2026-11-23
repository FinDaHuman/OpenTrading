import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { startFailureScenario } from "../../test/fixtures/failure-scenario"

if (!process.argv.includes("--yes")) throw new Error("This experiment can send up to 60 model requests. Pass --yes to run it.")
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required.")

const root = path.resolve(import.meta.dir, "../..")
const modelFlag = process.argv.indexOf("--model")
const selectedModel = modelFlag < 0 ? undefined : process.argv[modelFlag + 1]
if (modelFlag >= 0 && (!selectedModel || !/^gemini-[a-z0-9.-]+$/.test(selectedModel))) throw new Error("--model needs a Gemini model id.")
const models = selectedModel ? [selectedModel] : ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite"]
const lateRecovery = process.argv.includes("--late-recovery")
const variants: readonly (readonly [number, number])[] = process.argv.includes("--compare-only") ? [[4, 8], [2, 4]] : [[4, 8], [2, 8], [2, 4]]
const home = await mkdtemp(path.join(os.tmpdir(), "ot-416-home-"))
const output = await mkdtemp(path.join(os.tmpdir(), "ot-416-evidence-"))
const server = startFailureScenario({ vcbFailures: lateRecovery ? 2 : 0 })
const questionFile = path.join(output, "questions.json")
const rows: { model: string; nudge: number; stop: number; requests?: number; outcome?: string; gaps?: string[]; text?: string; calls: string[]; exitCode: number }[] = []
try {
  await writeFile(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: { data: { type: "http", url: server.url, alwaysLoad: true } } }))
  await writeFile(questionFile, JSON.stringify([{ id: "ratios", group: "A", question: `Đây là dữ liệu giả của bài kiểm thử. Hãy dùng công cụ MCP lấy P/E và ROE của VCB và BID cho năm 2025. ${lateRecovery ? "Nguồn có thể lỗi tạm thời; thử lại để lấy dữ liệu nếu gặp lỗi. " : ""}Nêu rõ phần không lấy được, không tự suy đoán.`, now: "2026-01-01T10:00:00+07:00" }]))
  await mkdir(path.join(home, "cache"), { recursive: true })
  for (const model of models) {
    for (const [nudge, stop] of variants) {
      const name = `${model}-${nudge}-${stop}-3`
      const trace = path.join(output, `${name}.jsonl`)
      server.calls.length = 0
      console.log(`Starting ${name}; hard HTTP cap 10.`)
      const proc = Bun.spawn([process.execPath, "scripts/eval/run.ts", "--questions", questionFile, "--model", `google/${model}`, "--memory", "none", "--failure-streak", `nudge=${nudge},stop=${stop}`, "--breaker-threshold", "3", "--http-request-cap", "10", "--timeout-min", "2", "--out", trace, "--yes"], { cwd: root, env: { ...process.env, OPENTRADING_HOME: home }, stdout: "pipe", stderr: "pipe" })
      const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
      await writeFile(path.join(output, `${name}.log`), `${stdout}\n${stderr}`)
      const lines = (await readFile(trace, "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type: string; requests?: number; outcome?: string; data_gaps?: string[]; text?: string })
      const answer = lines.findLast((line) => line.type === "answer")
      rows.push({ model, nudge, stop, requests: answer?.requests, outcome: answer?.outcome, gaps: answer?.data_gaps, text: answer?.text, calls: [...server.calls], exitCode })
      await writeFile(path.join(output, "summary.json"), JSON.stringify({ syntheticData: true, lateRecovery, maxRequestsPerRun: 10, runs: rows }, null, 2))
      console.log(`Finished ${name}: exit ${exitCode}, ${answer?.requests ?? "unknown"} requests; trace ${trace}`)
    }
  }
} finally {
  server.stop()
  const relative = path.relative(os.tmpdir(), home)
  if (!relative.startsWith("ot-416-home-") || relative.includes(path.sep)) throw new Error(`Refusing to remove unexpected temporary home: ${home}`)
  await rm(home, { recursive: true, force: true })
  console.log(`Evidence: ${output}`)
}
