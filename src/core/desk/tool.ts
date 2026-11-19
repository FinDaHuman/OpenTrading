import { z } from "zod"
import { loadConfig, saveConfig, type Config } from "../config"
import type { PermissionMode } from "../permission/mode"
import type { ToolDef } from "../tools/types"
import type { DeskApprovals, DeskDecision } from "./approval"
import type { DeskEngine } from "./engine"
import type { DeskOptIn } from "./keyword"
import { cleanLabel } from "./sanitize"
import { deskSettings } from "./settings"
import { DESK_SIZES, type DeskSize, type Estimate, type Playbook } from "./types"

export const DESK_RUN = "desk_run"

export interface DeskToolDeps {
  engine: DeskEngine
  approvals: DeskApprovals
  playbooks: () => Playbook[]
  /** How the current request opted into desk runs; undefined = it did not. */
  optIn: () => DeskOptIn | undefined
  mode: () => PermissionMode
  config?: () => Promise<Config>
}

/** One key per playbook (sang-loc → sang_loc) holding its typed args, plus the size. */
type Input = { size?: DeskSize } & Record<string, unknown>

/** The input key of a playbook: its name with _ (sang-loc → sang_loc). */
export const keyOf = (name: string) => name.replace(/-/g, "_")

/** The playbook the call chose (exactly one key set) and its arguments. */
export function chosen(playbooks: Playbook[], input: Input): { playbook: Playbook; args: unknown } {
  const set = playbooks.filter((p) => input[keyOf(p.meta.name)] !== undefined && input[keyOf(p.meta.name)] !== null)
  if (set.length !== 1) {
    throw new Error(`Fill exactly one playbook (one of: ${playbooks.map((p) => keyOf(p.meta.name)).join(", ") || "none"}); each key holds that playbook's arguments.`)
  }
  return { playbook: set[0]!, args: input[keyOf(set[0]!.meta.name)] }
}

function describe(playbooks: Playbook[]) {
  const lines = playbooks.map((p) => `- ${keyOf(p.meta.name)}: ${p.meta.whenToUse.replace(/\s+/g, " ").trim()}`)
  return [
    "Runs an ultradesk playbook: many research subagents on a fixed script (parallel gathering, cross-checking, synthesis), in the background; the result arrives later in <thong_bao_desk>.",
    "Use when the user turned ultradesk on (keyword, /desk on, a playbook command) or clearly asks for a large study that fits a playbook; the user approves before it runs.",
    "Do not use when a few tool calls can answer: a run costs far more requests.",
    lines.length > 0 ? `Fill exactly one key, holding that playbook's arguments:\n${lines.join("\n")}` : "No playbooks yet.",
  ].join("\n")
}

/** A one-line summary of the arguments for the approval card. */
export function argsSummary(playbook: Playbook, args: unknown): string {
  if (playbook.meta.summarize) return cleanLabel(playbook.meta.summarize(args as never), 80)
  return cleanLabel(JSON.stringify(args ?? {}), 80)
}

/**
 * desk_run: the main agent starts a playbook. The approval card shows unless the request opted
 * in (keyword, session mode, /<playbook>) AND the playbook was approved with "không hỏi lại"
 * before. Without an opt-in it always shows, whatever the permission mode: the tool is only
 * declared then because history called it before, and the model must not spend the day's
 * quota on its own.
 */
export function deskRunTool(deps: DeskToolDeps): ToolDef<Input> {
  const playbooks = deps.playbooks()
  // Each playbook's args as a typed key: providers (Gemini) and the model see the real schema.
  const shape = Object.fromEntries(playbooks.map((p) => [keyOf(p.meta.name), p.meta.args.optional().describe(`Run ${p.meta.name}`)]))
  return {
    name: DESK_RUN,
    description: describe(playbooks),
    input: z.object({
      ...shape,
      size: z.enum(DESK_SIZES as [DeskSize, ...DeskSize[]]).optional().describe("Size; empty = the user's setting"),
    }) as unknown as z.ZodType<Input>,
    readOnly: true,
    unlocked: true,
    timeoutMs: 0,
    // Only an opted-in request sees it (RunOptions.preload): never in tool_search results.
    onDemand: true,
    summarize: (input) => `${DESK_RUN}(${playbooks.filter((p) => input[keyOf(p.meta.name)] !== undefined).map((p) => p.meta.name).join(", ")})`,
    async prepare(input, ctx): Promise<DeskDecision> {
      const config = await (deps.config ?? loadConfig)()
      const settings = deskSettings(config)
      const { playbook, args } = chosen(playbooks, input)
      // Validates the arguments too: bad ones go back to the model before anyone is asked.
      const estimates = {} as Record<DeskSize, Estimate>
      for (const size of DESK_SIZES) {
        const { agents, requests } = await deps.engine.estimate(playbook.meta.name, args, size)
        estimates[size] = { agents, requests }
      }
      const size = input.size ?? settings.size
      const optIn = deps.optIn()
      const approved = (config.desk?.approved ?? []).includes(playbook.meta.name)
      if (optIn && approved) return { run: true, size, effort: settings.effort, remember: false }
      const decision = await deps.approvals.ask(
        {
          playbook: playbook.meta.name,
          description: playbook.meta.description,
          phases: playbook.meta.phases,
          summary: argsSummary(playbook, args),
          args,
          size,
          effort: settings.effort,
          estimates,
          warnRequests: settings.warnRequests,
          maxRequests: settings.maxRequests,
          model: settings.model?.model ? `${settings.model.provider ?? ""} · ${settings.model.model}`.replace(/^ · /, "") : "theo model của subagent",
          reason: optIn ? "first-time" : "no-opt-in",
        },
        ctx.signal,
      )
      // ▸▸ auto with an opt-in asks once per playbook (Claude Code: first workflow launch only).
      return optIn && deps.mode() === "auto" && decision.run ? { ...decision, remember: true } : decision
    },
    async execute(input, ctx) {
      const decision = ctx.prepared as DeskDecision
      const { playbook, args } = chosen(playbooks, input)
      const name = playbook.meta.name
      if (!decision.run) return `The user did not allow playbook ${name} to run. Answer the usual way or ask the user what they want.`
      if (decision.remember) {
        await saveConfig((current) => ({ desk: { ...current.desk, approved: [...new Set([...(current.desk?.approved ?? []), name])] } }))
      }
      // The card proposes desk.effort; only a level the user changed there belongs to this run
      // (an inherited one follows desk.effort on resume).
      const inherited = deskSettings(await (deps.config ?? loadConfig)()).effort
      const effort = decision.effort === inherited ? undefined : decision.effort
      const { id } = await deps.engine.start(name, args, { size: decision.size, effort })
      const estimate = await deps.engine.estimate(name, args, decision.size)
      return [
        `Started ultradesk run ${id}: playbook ${name}, size ${decision.size} (~${estimate.agents} agents, ~${estimate.requests} requests).`,
        "The run is in the background; the result will arrive in <thong_bao_desk>. Now just tell the user briefly that the run is going (follow it with /desk); do not redo the run's work yourself.",
      ].join("\n")
    },
  }
}
