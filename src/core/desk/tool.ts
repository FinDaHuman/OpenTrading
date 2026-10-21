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
    throw new Error(`Điền đúng một playbook (một trong: ${playbooks.map((p) => keyOf(p.meta.name)).join(", ") || "chưa có"}), mỗi key là tham số của playbook đó.`)
  }
  return { playbook: set[0]!, args: input[keyOf(set[0]!.meta.name)] }
}

function describe(playbooks: Playbook[]) {
  const lines = playbooks.map((p) => `- ${keyOf(p.meta.name)}: ${p.meta.whenToUse.replace(/\s+/g, " ").trim()}`)
  return [
    "Chạy một playbook ultradesk: nhiều subagent nghiên cứu theo kịch bản cố định (thu thập song song, kiểm chứng chéo, tổng hợp), chạy nền; kết quả về sau trong <thong_bao_desk>.",
    "Dùng khi người dùng bật ultradesk (keyword, /desk on, lệnh playbook) hoặc yêu cầu rõ một nghiên cứu lớn khớp playbook; người dùng duyệt trước khi chạy.",
    "Không dùng khi câu hỏi trả lời được bằng vài tool: một run tốn nhiều request hơn hẳn.",
    lines.length > 0 ? `Điền đúng một key, là tham số của playbook đó:\n${lines.join("\n")}` : "Chưa có playbook nào.",
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
  const shape = Object.fromEntries(playbooks.map((p) => [keyOf(p.meta.name), p.meta.args.optional().describe(`Chạy ${p.meta.name}`)]))
  return {
    name: DESK_RUN,
    description: describe(playbooks),
    input: z.object({
      ...shape,
      size: z.enum(DESK_SIZES as [DeskSize, ...DeskSize[]]).optional().describe("Quy mô; bỏ trống = cài đặt của người dùng"),
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
      if (!decision.run) return `Người dùng không cho chạy playbook ${name}. Trả lời bằng cách thông thường hoặc hỏi người dùng muốn làm gì.`
      if (decision.remember) {
        const current = await (deps.config ?? loadConfig)()
        const approved = [...new Set([...(current.desk?.approved ?? []), name])]
        await saveConfig({ desk: { ...current.desk, approved } })
      }
      const { id } = await deps.engine.start(name, args, { size: decision.size, effort: decision.effort })
      const estimate = await deps.engine.estimate(name, args, decision.size)
      return [
        `Đã bắt đầu run ultradesk ${id}: playbook ${name}, quy mô ${decision.size} (~${estimate.agents} agent, ~${estimate.requests} request).`,
        "Run chạy nền; kết quả sẽ tới trong <thong_bao_desk>. Bây giờ chỉ báo ngắn cho người dùng là run đang chạy (theo dõi bằng /desk), đừng tự làm lại việc của run.",
      ].join("\n")
    },
  }
}
