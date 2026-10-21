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

interface Input {
  playbook: string
  args: Record<string, unknown>
  size?: DeskSize
}

function describe(playbooks: Playbook[]) {
  const lines = playbooks.map((p) => {
    const schema = JSON.stringify(z.toJSONSchema(p.meta.args, { io: "input", unrepresentable: "any" }))
    return `- ${p.meta.name}: ${p.meta.description.replace(/\s+/g, " ").trim()} args: ${schema}`
  })
  return [
    "Chạy một playbook ultradesk: nhiều subagent nghiên cứu theo kịch bản cố định (thu thập song song, kiểm chứng chéo, tổng hợp), chạy nền. Kết quả về sau trong <thong_bao_desk>.",
    "Chỉ dùng khi người dùng bật ultradesk (keyword, /desk on hoặc lệnh playbook) hoặc yêu cầu rõ một nghiên cứu lớn; người dùng duyệt trước khi chạy. Tốn nhiều request hơn trả lời trực tiếp.",
    lines.length > 0 ? `Playbook:\n${lines.join("\n")}` : "Chưa có playbook nào.",
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
 * before. Without an opt-in it always shows, whatever the permission mode (a model that found
 * the tool by tool_search must not spend the day's quota on its own).
 */
export function deskRunTool(deps: DeskToolDeps): ToolDef<Input> {
  const playbooks = deps.playbooks()
  const names = playbooks.map((p) => p.meta.name)
  return {
    name: DESK_RUN,
    description: describe(playbooks),
    input: z.object({
      playbook: names.length > 0 ? z.enum(names as [string, ...string[]]) : z.string(),
      args: z.record(z.string(), z.unknown()).describe("Tham số của playbook, đúng schema ở mô tả"),
      size: z.enum(DESK_SIZES as [DeskSize, ...DeskSize[]]).optional().describe("Quy mô; bỏ trống = cài đặt của người dùng"),
    }),
    readOnly: true,
    unlocked: true,
    timeoutMs: 0,
    deferrable: true,
    searchHint: "ultradesk playbook nhiều agent sàng lọc tranh biện kiểm chứng ngành nghiên cứu sâu",
    summarize: (input) => `${DESK_RUN}(${input.playbook})`,
    async prepare(input, ctx): Promise<DeskDecision> {
      const config = await (deps.config ?? loadConfig)()
      const settings = deskSettings(config)
      const playbook = deps.engine.playbook(input.playbook)
      if (!playbook) throw new Error(`Không có playbook "${input.playbook}". Có: ${names.join(", ") || "(chưa có)"}.`)
      // Validates the arguments too: bad ones go back to the model before anyone is asked.
      const estimates = {} as Record<DeskSize, Estimate>
      for (const size of DESK_SIZES) {
        const { agents, requests } = await deps.engine.estimate(input.playbook, input.args, size)
        estimates[size] = { agents, requests }
      }
      const size = input.size ?? settings.size
      const optIn = deps.optIn()
      const approved = (config.desk?.approved ?? []).includes(input.playbook)
      if (optIn && approved) return { run: true, size, effort: settings.effort, remember: false }
      const decision = await deps.approvals.ask(
        {
          playbook: playbook.meta.name,
          description: playbook.meta.description,
          phases: playbook.meta.phases,
          summary: argsSummary(playbook, input.args),
          args: input.args,
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
      if (!decision.run) return `Người dùng không cho chạy playbook ${input.playbook}. Trả lời bằng cách thông thường hoặc hỏi người dùng muốn làm gì.`
      if (decision.remember) {
        const current = await (deps.config ?? loadConfig)()
        const approved = [...new Set([...(current.desk?.approved ?? []), input.playbook])]
        await saveConfig({ desk: { ...current.desk, approved } })
      }
      const { id } = await deps.engine.start(input.playbook, input.args, { size: decision.size, effort: decision.effort })
      const estimate = await deps.engine.estimate(input.playbook, input.args, decision.size)
      return [
        `Đã bắt đầu run ultradesk ${id}: playbook ${input.playbook}, quy mô ${decision.size} (~${estimate.agents} agent, ~${estimate.requests} request).`,
        "Run chạy nền; kết quả sẽ tới trong <thong_bao_desk>. Bây giờ chỉ báo ngắn cho người dùng là run đang chạy (theo dõi bằng /desk), đừng tự làm lại việc của run.",
      ].join("\n")
    },
  }
}
