import { z } from "zod"
import { toolFilter, toolSummary } from "../../agents/resolve"
import type { AgentDefinition } from "../../agents/schema"
import { briefFields, renderBrief, type Brief } from "../../subagents/brief"
import { DEFAULT_SUBAGENT_STEPS, DEFAULT_SUBAGENT_TYPE, type SubagentManager, type TypeSpec } from "../../subagents/manager"
import { formatResult } from "../../subagents/result"
import { LOCAL_SOURCE, type ToolDef } from "../types"

export const SPAWN_SUBAGENT = "spawn_subagent"

/**
 * Model-facing guidance, covering what Claude Code's Agent tool covers (when to delegate, parallel
 * calls in one step, a self-contained brief, the result visible to the main agent only), one line each.
 */
const DESCRIPTION = [
  "Hands a task to a subagent: a separate agent with an empty context that calls tools over several steps and returns a report only you see (present it to the user, keeping sources and times; reconcile contradictions).",
  "Use when: an independent task needs many tool calls and you only need the conclusion; several tasks in parallel (make every spawn_subagent call in the SAME round). Do not use when: the task needs only 1–2 tool calls, needs to ask the user, or you need each step's result.",
  "The subagent cannot see the conversation: purpose and context must be enough for it to decide on its own; questions specific (\"NIM 3 quý gần nhất?\"), not vague (\"Phân tích VCB\"). The harness assembles the fields into a fixed brief.",
  "A subagent cannot call other subagents or ask the user; its write tools ask the user to confirm; images in its tool results never reach the user.",
  "run_in_background: returns the agent_id at once; the result arrives later in <thong_bao_subagent>; do not wait or duplicate its work. More work for an existing subagent: send_message. If a subagent reports quota exhausted (429), tell the user; do not start a new subagent.",
].join("\n")

export interface SpawnInput extends Brief {
  description: string
  subagent_type?: string
  maxSteps?: number
  run_in_background?: boolean
}

/** The settings an agent type brings to a run; undefined = no such type. */
export function typeSpec(agents: AgentDefinition[], type: string): TypeSpec | undefined {
  const def = agents.find((a) => a.name === type)
  // Without definitions (tests, a broken install) the default type still runs with every tool.
  if (!def) return agents.length === 0 && type === DEFAULT_SUBAGENT_TYPE ? {} : undefined
  return {
    maxSteps: def.maxSteps,
    agentPrompt: def.body,
    toolFilter: toolFilter(def),
    model: def.provider || def.model ? { provider: def.provider, model: def.model } : undefined,
    effort: def.effort,
  }
}

/**
 * The agent types, Claude Code's format (`- type: when to use (Tool: …)`) for the listed ones; the
 * rest (`listed: false`, called by name from skills and playbooks) by name only.
 */
function typeList(agents: AgentDefinition[]) {
  if (agents.length === 0) return ""
  const listed = agents.filter((a) => a.listed !== false)
  const lines = listed.map((a) => `- ${a.name}: ${a.description.replace(/\s+/g, " ").trim()} (Tool: ${toolSummary(a)})`)
  const others = agents.filter((a) => a.listed === false).map((a) => a.name)
  const more = others.length ? `\nOther types (call by name when a skill asks): ${others.join(", ")}.` : ""
  return `\n\nSubagent types (subagent_type, default ${DEFAULT_SUBAGENT_TYPE}):\n${lines.join("\n")}${more}`
}

/**
 * Starts a subagent through the manager and waits for its report. It holds no lock (a
 * child's write would wait forever behind this call's read lock) and has no timeout: the
 * manager stops a child that stalls, and slot or approval waits are not runtime.
 */
export function spawnSubagentTool(manager: SubagentManager, agents: AgentDefinition[] = []): ToolDef<SpawnInput> {
  return {
    name: SPAWN_SUBAGENT,
    description: DESCRIPTION + typeList(agents),
    input: z.object({
      description: z.string().min(1).max(60).describe("3–6 Vietnamese words, shown in the interface (e.g.: Định giá FPT)"),
      ...briefFields,
      subagent_type: z.string().optional().describe(`Default ${DEFAULT_SUBAGENT_TYPE}`),
      maxSteps: z.number().int().min(1).max(30).optional().describe(`Cap on model calls (default by type, usually ${DEFAULT_SUBAGENT_STEPS})`),
      run_in_background: z.boolean().optional(),
    }),
    readOnly: true,
    unlocked: true,
    timeoutMs: 0,
    summarize: (input) => `${input.subagent_type || DEFAULT_SUBAGENT_TYPE}(${input.description})`,
    async execute(input, ctx) {
      const type = input.subagent_type || DEFAULT_SUBAGENT_TYPE
      const spec = typeSpec(agents, type)
      if (!spec) {
        throw new Error(`No subagent type "${type}". Available types: ${agents.map((a) => a.name).join(", ") || DEFAULT_SUBAGENT_TYPE}.`)
      }
      const background = !!input.run_in_background
      const run = manager.start({
        ...spec,
        type,
        description: input.description,
        prompt: renderBrief(input),
        maxSteps: input.maxSteps ?? spec.maxSteps,
        parentCallId: ctx.callId,
        // A background run outlives this turn: Esc on the main answer does not stop it.
        parentSignal: background ? undefined : ctx.signal,
        background,
      })
      if (background) {
        return [
          `Subagent ${run.id} started in the background (${type} · ${input.description}).`,
          "The result will arrive by itself in a <thong_bao_subagent> message when done: do not wait, do not poll its status, do not duplicate its work.",
          `More work: send_message with to="${run.id}". Stop: stop_agent.`,
        ].join("\n")
      }
      const result = await run.done
      // Claude Code: partial output is still worth returning; with nothing at all, fail.
      if (result.status === "stopped" && ctx.signal.aborted) throw new Error("Stopped.")
      if (result.status === "failed" && !result.text) throw new Error(`Subagent failed: ${result.error ?? "unknown cause"}`)
      return formatResult(run, result)
    },
  }
}

/**
 * send_message (Claude Code's SendMessage): more work for an existing subagent. A running
 * one gets it after its current turn; a finished one resumes in the background with its
 * conversation and reports back with <thong_bao_subagent>.
 */
export function sendMessageTool(manager: SubagentManager, agents: AgentDefinition[] = []): ToolDef<{ to: string; message: string }> {
  return {
    name: "send_message",
    description:
      "Sends more work or information to an existing subagent, by agent_id (from <subagent_meta> or a background start). The subagent keeps its context. Running: it gets the message after its current turn. Finished: it continues in the background and the result arrives in <thong_bao_subagent>. Write the message as clearly as a new task.",
    input: z.object({
      to: z.string().min(1).describe("agent_id, e.g. ag-k3f9x2"),
      message: z.string().min(1).describe("The additional task"),
    }),
    readOnly: true,
    // Only useful once a subagent exists: spawn_subagent loads it (tools/loaded.ts).
    deferrable: true,
    deferByDefault: true,
    source: LOCAL_SOURCE,
    summarize: (input) => `send_message(${input.to})`,
    async execute(input) {
      const outcome = await manager.continue(input.to.trim(), input.message, (type) => typeSpec(agents, type))
      return outcome === "queued"
        ? `Message queued for subagent ${input.to}; it gets it after its current turn. The result comes with its completion notice.`
        : `Subagent ${input.to} is continuing in the background with this message. The result will arrive in <thong_bao_subagent>.`
    },
  }
}

/** stop_agent: stop a running or queued subagent (its partial result is reported). */
export function stopAgentTool(manager: SubagentManager): ToolDef<{ id: string }> {
  return {
    name: "stop_agent",
    description: "Stops a subagent that is running or waiting for a slot, by agent_id. Use when its work is no longer needed.",
    input: z.object({ id: z.string().min(1).describe("agent_id") }),
    readOnly: true,
    deferrable: true,
    deferByDefault: true,
    source: LOCAL_SOURCE,
    summarize: (input) => `stop_agent(${input.id})`,
    async execute(input) {
      const id = input.id.trim()
      if (manager.stop(id)) return `Stopped subagent ${id}.`
      const view = manager.get(id)
      if (view) return `Subagent ${id} is no longer running (status: ${view.status}).`
      throw new Error(`No subagent "${id}".`)
    },
  }
}
