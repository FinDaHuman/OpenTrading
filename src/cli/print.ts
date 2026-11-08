import { setConversation } from "../core/conversation"
import path from "node:path"
import type { ModelMessage } from "ai"
import { runAgent } from "../core/agent"
import { agentRoots, loadAgents } from "../core/agents/loader"
import { describeError, resolveTarget, type Target } from "../core/chat"
import { loadConfig, memoryChoiceOf } from "../core/config"
import { FolderTrust, projectExtras } from "../core/folder-trust"
import { MODE_LABEL, startMode } from "../core/permission/mode"
import { promptVersion } from "../core/prompt/assemble"
import { onModelRequest } from "../core/requests"
import { closeMemory, createMemory, initRuntime, setAgents, type Runtime } from "../core/runtime"
import { Session, sessionsDir } from "../core/session/store"
import { loadSkills, skillRoots } from "../core/skills/loader"
import type { PrintFormat } from "./args"

/**
 * `ot -p "câu hỏi"`: one turn through the same agent loop as the TUI, without the TUI. The
 * reference harnesses have the same command (`claude -p`, `codex exec`, `opencode run`), so a
 * benchmark can drive all of them the same way.
 *
 * - Nobody can answer a prompt: every call that would ask is refused (the gate is not
 *   interactive), so the model reads a denial. `--yolo` runs them instead (▸▸▸ bypass), except
 *   what bypass still keeps for the user, which is refused too.
 * - stdout holds only the answer (text) or one JSON object (json); progress goes to stderr.
 * - The turn is saved as a session like any other (`ot -r <id>` opens it later).
 * - Exit code: 0 answered, 1 otherwise (no answer, an error, bad arguments).
 */

export interface PrintOptions {
  prompt?: string
  yolo?: boolean
  /** `provider/model`. */
  model?: string
  format: PrintFormat
}

export interface PrintResult {
  type: "result"
  answer: string
  /** "completed", or how the turn ended (agent.ts `done.outcome`). */
  outcome: string
  unanswered: boolean
  provider: string
  model: string
  permission_mode: string
  session_id: string
  /** Absolute path of the session file; absent when it could not be written. */
  session_file?: string
  /** Model requests sent, the main agent's and its subagents' (and their retries). */
  requests: number
  steps: number
  input_tokens: number
  output_tokens: number
  duration_ms: number
  data_gaps: string[]
  errors: string[]
}

/** The answer the turn kept: a draft the stop gate sent back is streamed but not in it. */
function finalText(messages: ModelMessage[]) {
  const content = messages.findLast((m) => m.role === "assistant")?.content
  if (typeof content === "string") return content
  return (content ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ""
  return (await Bun.stdin.text()).trim()
}

const err = (line: string) => process.stderr.write(`${line}\n`)
/** stdout, flushed before the caller exits: a runner reads it through a pipe. */
const print = (text: string) => new Promise<void>((resolve) => process.stdout.write(text, () => resolve()))

/** Run one turn and print it. Returns the exit code. */
export async function runPrint(opts: PrintOptions, deps: { runtime?: Runtime; target?: Target; stdin?: () => Promise<string> } = {}): Promise<number> {
  const prompt = (opts.prompt ?? (await (deps.stdin ?? readStdin)())).trim()
  if (!prompt) {
    err('Thiếu câu hỏi: ot -p "câu hỏi", hoặc đưa câu hỏi qua stdin.')
    return 1
  }
  const config = await loadConfig()
  // A folder's own skills and agents only once the user trusted it in the TUI: --yolo is about
  // approvals, not about letting a downloaded repo steer the prompt. Project `.mcp.json` servers
  // keep their own per-server approval (mcp/trust.ts): untrusted ones never start here.
  const folder = deps.runtime?.mcp.cwd ?? process.cwd()
  const extras = await projectExtras(folder)
  const trusted = !extras || (await new FolderTrust().isTrusted(folder))
  if (!trusted) err(`Bỏ qua skill/agent riêng của ${extras!.dir}: thư mục chưa được tin (mở bằng TUI một lần để chọn).`)
  const { skills } = await loadSkills(skillRoots(folder, { project: trusted }))
  const runtime =
    deps.runtime ?? initRuntime({ skills: () => skills, memory: createMemory(memoryChoiceOf(config)), workspaceDirs: config.workspace?.dirs, scratchpad: false })
  const gate = runtime.permissions
  gate.setMode(startMode(config.permissions))
  if (opts.yolo) {
    // The setter ignores bypass until the flag made it reachable.
    gate.bypassAvailable = true
    gate.setMode("bypass")
    err(`${MODE_LABEL.bypass} (--yolo): ghi file, chạy lệnh và tool ghi chạy luôn, không ai duyệt. Vẫn chặn: luật deny/ask, file khoá, .git/.opentrading/.ssh, ngoài workspace.`)
  }
  await gate.refreshRules()
  setAgents(runtime, (await loadAgents(agentRoots(folder, { project: trusted }))).agents)

  const errors: string[] = []
  let requests = 0
  const stopMeter = onModelRequest(() => {
    requests++
  })
  const session = Session.create()
  const started = Date.now()
  const result = { text: "", outcome: "failed", unanswered: false, steps: 0, input: 0, output: 0, gaps: [] as string[], messages: [] as ModelMessage[] }
  let target: Target | undefined
  const controller = new AbortController()
  const onSigint = () => controller.abort()
  process.on("SIGINT", onSigint)
  try {
    const slash = opts.model?.indexOf("/") ?? -1
    target = deps.target ?? (await resolveTarget(opts.model ? { provider: opts.model.slice(0, slash), model: opts.model.slice(slash + 1) } : undefined))
    await runtime.mcp.start()
    setConversation(session.id)
    const before = new Set(runtime.subagents.list().map((v) => v.id))
    for await (const event of runAgent({
      history: [],
      input: prompt,
      skills,
      registry: runtime.registry,
      target,
      signal: controller.signal,
      sessionId: session.id,
      hooks: runtime.hooks,
      memory: runtime.memory,
      constraints: runtime.constraints,
      redaction: runtime.redaction,
      serverInstructions: () => runtime.mcp.instructions(),
    })) {
      if (event.type === "tool-start") err(`⚙ ${event.label}`)
      else if (event.type === "tool-end" && !event.ok) err(`✕ ${event.output.split("\n")[0]!.slice(0, 200)}`)
      else if (event.type === "notice") err(event.text)
      else if (event.type === "error") {
        errors.push(event.message)
        err(event.message)
      } else if (event.type === "step") result.steps++
      else if (event.type === "step-usage") {
        result.input += event.inputTokens
        result.output += event.outputTokens
      } else if (event.type === "done") {
        result.outcome = event.outcome ?? "completed"
        // A failed or stopped turn closes with a marker for the transcript, not an answer.
        const text = finalText(event.messages).trim()
        result.text = result.outcome !== "completed" && (text === "(lỗi)" || text === "(đã dừng)") ? "" : text
        result.unanswered = event.unanswered ?? false
        result.gaps = event.dataGaps ?? []
        result.messages = event.messages
      }
    }
    // Background subagents end with the turn: nobody is left to read their results.
    runtime.subagents.stopAll()
    await runtime.subagents.flush()
    for (const view of runtime.subagents.list()) {
      if (before.has(view.id)) continue
      result.input += view.usage.input
      result.output += view.usage.output
    }
  } catch (error) {
    const message = describeError(error)
    errors.push(message)
    err(message)
  } finally {
    process.off("SIGINT", onSigint)
    stopMeter()
    await runtime.mcp.stop()
  }

  let sessionFile: string | undefined
  if (result.messages.length > 0) {
    const receipt = await session.appendTurn(result.messages, {
      cwd: process.cwd(),
      provider: target?.provider.id,
      model: target?.model,
      promptVersion: promptVersion(),
      skills: skills.map((s) => ({ name: s.name, version: s.version })),
      unanswered: result.unanswered,
      dataGaps: result.gaps,
    })
    if (receipt.error) err(`Không lưu được phiên: ${receipt.error.message}`)
    if (session.file) sessionFile = path.join(sessionsDir(), session.file)
  }
  const answered = result.text.length > 0 && !result.unanswered && errors.length === 0
  if (opts.format === "json") {
    const out: PrintResult = {
      type: "result",
      answer: result.text,
      outcome: result.outcome,
      unanswered: result.unanswered,
      provider: target?.provider.id ?? "",
      model: target?.model ?? "",
      permission_mode: gate.mode,
      session_id: session.id,
      ...(sessionFile ? { session_file: sessionFile } : {}),
      requests,
      steps: result.steps,
      input_tokens: result.input,
      output_tokens: result.output,
      duration_ms: Date.now() - started,
      data_gaps: result.gaps,
      errors,
    }
    await print(`${JSON.stringify(out)}\n`)
  } else if (result.text) await print(`${result.text}\n`)
  if (!deps.runtime) closeMemory(runtime)
  return answered ? 0 : 1
}
