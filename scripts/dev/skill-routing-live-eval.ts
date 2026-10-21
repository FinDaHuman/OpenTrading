import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { generateText, tool } from "ai"
import { z } from "zod"
import { describeError, resolveTarget } from "../../src/core/chat"
import { lowThinking } from "../../src/core/permission/auto/classifier"
import { assemble, promptVersion } from "../../src/core/prompt/assemble"
import type { Tier } from "../../src/core/prompt/budget"
import { languageModel } from "../../src/core/providers"
import { availableSkills } from "../../src/core/skills/catalog"
import { loadSkills, skillRoots } from "../../src/core/skills/loader"
import { catalogRegistry, loadCases } from "../../test/helpers/routing-eval"

// Opt-in live smoke test, one bounded request per question/tier; no finance calls.
// --dry-run records every prompt without resolving credentials or calling a provider.
const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i < 0 ? undefined : process.argv[i + 1]
}
const root = path.resolve(import.meta.dir, "../..")
const dryRun = process.argv.includes("--dry-run")
const catalogOnly = process.argv.includes("--catalog-only")
const only = (arg("--only") ?? "278,279,280,282,283,284,288,289,290,291").split(",").map(Number)
const tiers = (arg("--tiers") ?? "A,B").split(",")
if (tiers.some((tier) => tier !== "A" && tier !== "B")) throw new Error("--tiers must be A, B or A,B")
const cases = (await loadCases(root)).filter((c) => only.includes(c.id))
if (new Set(only).size !== cases.length) throw new Error("Unknown or duplicate --only IDs")
const { skills, problems } = await loadSkills(skillRoots(root).filter((r) => r.source === "bundled"))
if (problems.length) throw new Error(JSON.stringify(problems))
const registry = await catalogRegistry(root)
const declaredTools = registry.list().map((t) => t.name)
const names = availableSkills(skills, new Set(declaredTools)).filter((s) => s.activation === "auto").map((s) => s.name)
const pick = arg("--model")
if (pick && !/^[^/]+\/.+/.test(pick)) throw new Error("--model must be provider/model")
const target = dryRun ? undefined : await resolveTarget(pick ? { provider: pick.split("/")[0], model: pick.split("/").slice(1).join("/") } : undefined)
const now = new Date()
const git = async (...args: string[]) => {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const output = await new Response(proc.stdout).text()
  if (await proc.exited) throw new Error(`git ${args[0]} failed`)
  return output.trim()
}
const trackedDiff = await git("diff", "HEAD", "--", ".")
const requests = cases.flatMap((c) => tiers.map((tier) => {
  const assembled = assemble({ tier: tier as Tier, tools: ["load_skill"], declaredTools, skills, sticky: [], input: c.q, now })
  const reminders = catalogOnly ? assembled.reminders.filter((r) => !r.startsWith("<goi_y_skill>")) : assembled.reminders
  return {
    id: c.id, tier, question: c.q, expected: c.skills ?? [],
    system: `${assembled.system}\n\nRouting evaluation: choose skill(s) by calling load_skill; if none fits call no_skill. Do not answer the financial question or call any data tools.`,
    prompt: [assembled.context, ...reminders, c.q].filter(Boolean).join("\n\n"),
    layers: assembled.report,
  }
}))
const settings = { temperature: 0, maxRetries: 0, maxOutputTokens: 1_024, timeoutMs: 45_000 }
const providerOptions = target ? lowThinking(target) : undefined
const evidence: Record<string, unknown> = {
  version: 1, createdAt: now.toISOString(), dryRun, catalogOnly,
  commit: await git("rev-parse", "HEAD"),
  trackedDiffSha256: createHash("sha256").update(trackedDiff).digest("hex"),
  promptVersion: promptVersion(),
  // Includes untracked evaluator code as well as the exact submitted payloads.
  evaluatorSha256: createHash("sha256").update(await Bun.file(import.meta.path).text()).digest("hex"),
  payloadSha256: createHash("sha256").update(JSON.stringify(requests)).digest("hex"),
  model: target ? `${target.provider.id}/${target.model}` : pick ?? "configured session model (not resolved)",
  settings, providerOptions, requests, results: [],
}
const tools = {
  load_skill: tool({ description: "Select a catalog skill by name. Stub: no execution.", inputSchema: z.object({ name: z.enum(names as [string, ...string[]]) }) }),
  no_skill: tool({ description: "No catalog skill is appropriate for this question.", inputSchema: z.object({}) }),
}
const out = path.resolve(arg("--out") ?? `/tmp/skill-routing-${now.toISOString().replace(/[:.]/g, "-")}.json`)
await mkdir(path.dirname(out), { recursive: true })
const results: unknown[] = []
let failed = 0
for (const request of dryRun ? [] : requests) {
  const started = Date.now()
  try {
    const result = await generateText({
      model: languageModel(target!.provider, target!.model, target!.apiKey),
      system: request.system, prompt: request.prompt, tools, toolChoice: "required",
      temperature: settings.temperature, maxRetries: settings.maxRetries, maxOutputTokens: settings.maxOutputTokens,
      providerOptions, abortSignal: AbortSignal.timeout(settings.timeoutMs),
    })
    const calls = result.toolCalls.map((call) => ({ name: call.toolName, input: call.input }))
    const selected = [...new Set(calls.flatMap((call) => call.name === "load_skill" ? [(call.input as { name: string }).name] : []))].sort()
    const abstained = calls.some((call) => call.name === "no_skill")
    const pass = (selected.length > 0 ? !abstained : abstained) && JSON.stringify(selected) === JSON.stringify([...request.expected].sort())
    if (!pass) failed++
    results.push({ id: request.id, tier: request.tier, pass, selected, calls, text: result.text, finishReason: result.finishReason, usage: result.usage, elapsedMs: Date.now() - started })
    console.log(`${pass ? "PASS" : "FAIL"} Q${request.id}/${request.tier}: ${selected.join(", ") || "no skill"}`)
  } catch (error) {
    failed++
    results.push({ id: request.id, tier: request.tier, pass: false, error: describeError(error), elapsedMs: Date.now() - started })
    console.log(`FAIL Q${request.id}/${request.tier}: provider error`)
  }
  evidence.results = results
  await writeFile(out, JSON.stringify(evidence, null, 2) + "\n")
}
evidence.results = results
evidence.summary = { planned: requests.length, completed: results.length, failed, passed: results.length - failed }
await writeFile(out, JSON.stringify(evidence, null, 2) + "\n")
console.log(`${dryRun ? "DRY RUN" : "LIVE"}: ${requests.length} requests; ${failed} failures. Evidence: ${out}`)
process.exitCode = failed ? 1 : 0
