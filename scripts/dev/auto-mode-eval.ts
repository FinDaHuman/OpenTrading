import path from "node:path"
import { resolveTarget } from "../../src/core/chat"
import { loadConfig } from "../../src/core/config"
import { classify } from "../../src/core/permission/auto/classifier"
import { caseInput, loadCases, type EvalCase } from "../../test/helpers/auto-eval"

/**
 * Run the auto-mode classifier on the labelled actions with a real model and report how often
 * it blocks what it should (recall) and blocks what it should not (false positives), overall
 * and per tag. Spends the user's quota: about 1 request per allowed case and 2 per blocked one.
 * Never run by the tests, and never calls a model without --yes.
 *
 * Cases with a `route` never reach the classifier in OpenTrading (the gate decides first); they
 * are skipped unless --unreachable.
 *
 * Cách chạy: bun scripts/dev/auto-mode-eval.ts --yes [--model provider/model] [--only 21,25,30] [--unreachable] [--all]
 *   --yes          thật sự gọi model (không có thì chỉ in số ca và số request ước tính)
 *   --model        model duyệt (mặc định: autoMode.model trong config, không có thì model của phiên)
 *   --only         chỉ chạy các ca có id này
 *   --unreachable  chạy cả các ca mà gate quyết định trước classifier (route)
 *   --all          in cả các ca đúng
 */

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(name)
const root = path.resolve(import.meta.dir, "../..")
const only = arg("--only")?.split(",").map(Number)
const all = loadCases(root).filter((c) => !only || only.includes(c.id))
const cases = all.filter((c) => only || flag("--unreachable") || !c.route)
const skipped = all.length - cases.length
const estimate = cases.reduce((n, c) => n + (c.expect === "block" ? 2 : 1), 0)

if (!flag("--yes")) {
  console.log(`${cases.length} ca (bỏ qua ${skipped} ca gate quyết định trước classifier) · ước tính ~${estimate} request.`)
  console.log("Thêm --yes để chạy thật với model duyệt.")
  process.exit(0)
}

const pick = arg("--model")
const configured = (await loadConfig()).autoMode
const override = pick ? { provider: pick.split("/")[0], model: pick.split("/").slice(1).join("/") } : configured?.model?.model ? configured.model : undefined
const target = await resolveTarget(override)
console.log(`Model duyệt: ${target.provider.id}/${target.model} · ${cases.length} ca (bỏ qua ${skipped}) · ~${estimate} request\n`)

interface Tally {
  tp: number
  fn: number
  fp: number
  tn: number
  unavailable: number
}
const tally = (): Tally => ({ tp: 0, fn: 0, fp: 0, tn: 0, unavailable: 0 })
const total = tally()
const byTag = new Map<string, Tally>()
const count = (t: Tally, c: EvalCase, got: string) => {
  if (got === "unavailable") t.unavailable++
  else if (c.expect === "block") got === "block" ? t.tp++ : t.fn++
  else got === "allow" ? t.tn++ : t.fp++
}

let requests = 0
const started = Date.now()
for (const c of cases) {
  const t0 = Date.now()
  const v = await classify({ ...caseInput(c), config: configured }, target, new AbortController().signal)
  requests += v.requests
  const got = v.kind === "allow" ? "allow" : v.kind === "block" ? "block" : "unavailable"
  count(total, c, got)
  for (const tag of [...(c.tags ?? []), ...(c.route ? [`route:${c.route}`] : [])]) {
    if (!byTag.has(tag)) byTag.set(tag, tally())
    count(byTag.get(tag)!, c, got)
  }
  const ok = got === c.expect
  if (!ok || flag("--all")) {
    const detail = v.kind === "block" ? ` [${v.rule ?? "?"}] ${v.reason}` : v.kind === "unavailable" ? ` (${v.why})` : ""
    console.log(`${ok ? "ok  " : "SAI "} #${c.id} cần ${c.expect}, được ${got}${detail} · ${Date.now() - t0}ms · ${c.note}`)
  }
}
const pct = (a: number, b: number) => (b === 0 ? "-" : `${((100 * a) / b).toFixed(0)}% (${a}/${b})`)
console.log("")
console.log(`Chặn đúng (recall): ${pct(total.tp, total.tp + total.fn)} · bỏ lọt: ${pct(total.fn, total.tp + total.fn)}`)
console.log(`Chặn nhầm (FPR):    ${pct(total.fp, total.fp + total.tn)}`)
console.log(`Không có kết quả:   ${total.unavailable}`)
for (const [tag, t] of [...byTag].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`  ${tag.padEnd(18)} bỏ lọt ${pct(t.fn, t.tp + t.fn)} · chặn nhầm ${pct(t.fp, t.fp + t.tn)}${t.unavailable ? ` · không kết quả ${t.unavailable}` : ""}`)
}
console.log(`Request: ${requests} · thời gian: ${((Date.now() - started) / 1000).toFixed(0)}s`)
