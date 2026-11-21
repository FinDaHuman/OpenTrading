import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { generateText, jsonSchema, tool } from "ai"
import { z } from "zod"

/**
 * Opt-in live check of subagent-type choice (#334): one request per question, the static prompt
 * plus `spawn_subagent` only (its real description and schema, no execution), tool choice
 * required; scores the `subagent_type` of every call against the expected ones. `--root` takes
 * the prompt and the tool from another checkout, so main and a branch run the same questions.
 * Calls a provider only with --yes; otherwise it prints the plan.
 *
 * Cách chạy: bun scripts/dev/subagent-routing-live-eval.ts --model google/gemini-3.1-flash-lite
 *            [--root ../OT-main] [--out file.json] [--yes]
 */

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i < 0 ? undefined : process.argv[i + 1]
}
const root = path.resolve(arg("--root") ?? path.join(import.meta.dir, "../.."))
const live = process.argv.includes("--yes")
const pick = arg("--model")
if (!pick || !/^[^/]+\/.+/.test(pick)) throw new Error("--model provider/model is required")

/** Expected types; a question naming two tasks expects both (order free). */
const CASES: { id: string; q: string; want: string[] }[] = [
  { id: "s1", q: "Dùng subagent soi chất lượng lợi nhuận và dòng tiền của HPG 8 quý gần nhất.", want: ["co-ban"] },
  { id: "s2", q: "Giao cho một subagent định giá FPT bằng DCF và so với các công ty cùng ngành.", want: ["dinh-gia"] },
  { id: "s3", q: "Nhờ subagent đọc kỹ thuật VNM trên khung ngày và tuần, kiểm tra phân kỳ RSI.", want: ["ky-thuat"] },
  { id: "s4", q: "Cho một subagent gom tin tức ngành thép trong tháng qua, kèm ngày và nguồn từng tin.", want: ["tin-tuc"] },
  { id: "s5", q: "Dùng subagent tra nhanh giá đóng cửa và khối lượng hôm nay của SSI.", want: ["tra-cuu"] },
  { id: "s6", q: "Giao subagent nghiên cứu nhiều bước: ngành bán lẻ hưởng lợi gì từ việc giảm VAT, so MWG với PNJ.", want: ["nghien-cuu"] },
  { id: "s7", q: "Chạy song song hai subagent: một xem sức khỏe tài chính MBB, một gom tin tức MBB tuần này.", want: ["co-ban", "tin-tuc"] },
  { id: "s8", q: "Nhờ subagent kiểm tra lợi nhuận quý gần nhất của VIC có phải là tiền thật không.", want: ["co-ban"] },
  { id: "s9", q: "Dùng subagent xem P/E và P/B hiện tại của ACB.", want: ["tra-cuu"] },
  { id: "s10", q: "Giao subagent đánh giá biên an toàn của DGC so với giá trị nội tại.", want: ["dinh-gia"] },
]

const { loadAgents } = await import(path.join(root, "src/core/agents/loader.ts"))
const { spawnSubagentTool } = await import(path.join(root, "src/core/tools/subagent/spawn.ts"))
const { assemble } = await import(path.join(root, "src/core/prompt/assemble.ts"))
const { loadCalendar } = await import(path.join(root, "src/core/prompt/market-clock.ts"))
const { agents } = await loadAgents([{ dir: path.join(root, "agents"), source: "bundled" }])
const spawn = spawnSubagentTool({} as never, agents)
const now = new Date()
const system = assemble({ tier: "B", tools: ["spawn_subagent"], skills: [], sticky: [], input: "", now, calendar: loadCalendar() }).system
const tools = { spawn_subagent: tool({ description: spawn.description, inputSchema: jsonSchema(z.toJSONSchema(spawn.input) as never) }) }

console.log(`${CASES.length} requests · ${pick} · root ${root}`)
if (!live) {
  console.log("Plan only: add --yes to call the model (uses your quota).")
  process.exit(0)
}

const { resolveTarget, describeError } = await import("../../src/core/chat")
const { languageModel } = await import("../../src/core/providers")
const { lowThinking } = await import("../../src/core/permission/auto/classifier")
const target = await resolveTarget({ provider: pick.split("/")[0]!, model: pick.split("/").slice(1).join("/") })
const results: unknown[] = []
let passed = 0
for (const c of CASES) {
  try {
    const result = await generateText({
      model: languageModel(target.provider, target.model, target.apiKey),
      system,
      prompt: c.q,
      tools,
      toolChoice: "required",
      temperature: 0,
      maxRetries: 0,
      maxOutputTokens: 2_048,
      providerOptions: lowThinking(target),
      abortSignal: AbortSignal.timeout(60_000),
    })
    const got = result.toolCalls.map((call) => (call.input as { subagent_type?: string }).subagent_type || "nghien-cuu").sort()
    const pass = JSON.stringify(got) === JSON.stringify([...c.want].sort())
    if (pass) passed++
    results.push({ id: c.id, pass, want: c.want, got, inputs: result.toolCalls.map((call) => call.input), usage: result.usage })
    console.log(`${pass ? "PASS" : "FAIL"} ${c.id}: ${got.join(", ") || "-"} (want ${c.want.join(", ")})`)
  } catch (error) {
    results.push({ id: c.id, pass: false, error: describeError(error) })
    console.log(`FAIL ${c.id}: provider error`)
  }
}
const out = path.resolve(arg("--out") ?? `subagent-routing-${now.toISOString().replace(/[:.]/g, "-")}.json`)
await mkdir(path.dirname(out), { recursive: true })
await writeFile(out, JSON.stringify({ model: pick, root, createdAt: now.toISOString(), passed, total: CASES.length, results }, null, 2) + "\n")
console.log(`${passed}/${CASES.length} · evidence ${out}`)
