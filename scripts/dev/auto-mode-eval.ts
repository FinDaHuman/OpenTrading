import path from "node:path"
import { resolveTarget } from "../../src/core/chat"
import { loadConfig } from "../../src/core/config"
import { classify } from "../../src/core/permission/auto/classifier"
import { caseInput, loadCases } from "../../test/helpers/auto-eval"

/**
 * Run the auto-mode classifier on the labelled actions with a real model and report how often
 * it blocks what it should (recall) and blocks what it should not (false positives).
 * Spends the user's quota: about 1 request per allowed case and 2 per blocked one (~90 for
 * the 60 cases). Never run by the tests.
 *
 * Cách chạy: bun scripts/dev/auto-mode-eval.ts [--model provider/model] [--only 21,25,30] [--all]
 *   --model   model duyệt (mặc định: autoMode.model trong config, không có thì model của phiên)
 *   --only    chỉ chạy các ca có id này
 *   --all     in cả các ca đúng
 */

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const root = path.resolve(import.meta.dir, "../..")
const only = arg("--only")?.split(",").map(Number)
const cases = loadCases(root).filter((c) => !only || only.includes(c.id))
const pick = arg("--model")
const configured = (await loadConfig()).autoMode
const override = pick ? { provider: pick.split("/")[0], model: pick.split("/").slice(1).join("/") } : configured?.model?.model ? configured.model : undefined
const target = await resolveTarget(override)
console.log(`Model duyệt: ${target.provider.id}/${target.model} · ${cases.length} ca\n`)

let requests = 0
let tp = 0
let fn = 0
let fp = 0
let tn = 0
let unavailable = 0
const started = Date.now()
for (const c of cases) {
  const t0 = Date.now()
  const v = await classify({ ...caseInput(c), config: configured }, target, new AbortController().signal)
  requests += v.requests
  const got = v.kind === "allow" ? "allow" : v.kind === "block" ? "block" : "unavailable"
  if (got === "unavailable") unavailable++
  else if (c.expect === "block") got === "block" ? tp++ : fn++
  else got === "allow" ? tn++ : fp++
  const ok = got === c.expect
  if (!ok || process.argv.includes("--all")) {
    const detail = v.kind === "block" ? ` [${v.rule ?? "?"}] ${v.reason}` : v.kind === "unavailable" ? ` (${v.why})` : ""
    console.log(`${ok ? "ok  " : "SAI "} #${c.id} cần ${c.expect}, được ${got}${detail} · ${Date.now() - t0}ms · ${c.note}`)
  }
}
const pct = (a: number, b: number) => (b === 0 ? "-" : `${((100 * a) / b).toFixed(0)}% (${a}/${b})`)
console.log("")
console.log(`Chặn đúng (recall): ${pct(tp, tp + fn)} · bỏ lọt: ${pct(fn, tp + fn)}`)
console.log(`Chặn nhầm (FPR):    ${pct(fp, fp + tn)}`)
console.log(`Không có kết quả:   ${unavailable}`)
console.log(`Request: ${requests} · thời gian: ${((Date.now() - started) / 1000).toFixed(0)}s`)
