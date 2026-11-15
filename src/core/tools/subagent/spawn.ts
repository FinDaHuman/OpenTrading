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
  "Giao một việc cho subagent: agent riêng, ngữ cảnh trống, tự gọi tool nhiều bước rồi trả một bản báo cáo chỉ bạn thấy (trình bày lại cho người dùng, giữ nguồn và thời điểm; mâu thuẫn thì đối chiếu).",
  "Dùng khi: việc độc lập cần nhiều lần gọi tool mà bạn chỉ cần kết luận; nhiều việc song song (gọi mọi spawn_subagent trong CÙNG một lượt). Không dùng khi: việc chỉ cần 1–2 lần gọi tool, cần hỏi người dùng, hay cần kết quả từng bước.",
  "Subagent không thấy hội thoại: purpose và context phải đủ để nó tự quyết; questions cụ thể (\"NIM 3 quý gần nhất?\"), không chung chung (\"Phân tích VCB\"). Harness ghép các trường thành một brief cố định.",
  "Subagent không gọi được subagent khác hay hỏi người dùng; tool ghi sẽ hỏi người dùng xác nhận; ảnh trong kết quả tool của nó không tới được người dùng.",
  "run_in_background: trả agent_id ngay, kết quả đến sau trong <thong_bao_subagent>; đừng chờ hay làm trùng. Giao thêm việc cho subagent đã có: send_message. Subagent báo hết quota (429) thì báo người dùng, đừng tạo subagent mới.",
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
  const more = others.length ? `\nLoại khác (gọi đích danh khi skill yêu cầu): ${others.join(", ")}.` : ""
  return `\n\nLoại subagent (subagent_type, mặc định ${DEFAULT_SUBAGENT_TYPE}):\n${lines.join("\n")}${more}`
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
      description: z.string().min(1).max(60).describe("3–6 từ, hiện trong giao diện (ví dụ: Định giá FPT)"),
      ...briefFields,
      subagent_type: z.string().optional().describe(`Mặc định ${DEFAULT_SUBAGENT_TYPE}`),
      maxSteps: z.number().int().min(1).max(30).optional().describe(`Trần lượt gọi model (mặc định theo loại, thường ${DEFAULT_SUBAGENT_STEPS})`),
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
        throw new Error(`Không có loại subagent "${type}". Các loại hiện có: ${agents.map((a) => a.name).join(", ") || DEFAULT_SUBAGENT_TYPE}.`)
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
          `Đã chạy nền subagent ${run.id} (${type} · ${input.description}).`,
          "Kết quả sẽ tự đến trong một tin <thong_bao_subagent> khi xong: đừng chờ, đừng hỏi lại trạng thái, đừng làm trùng việc của nó.",
          `Giao thêm việc: send_message với to="${run.id}". Dừng: stop_agent.`,
        ].join("\n")
      }
      const result = await run.done
      // Claude Code: partial output is still worth returning; with nothing at all, fail.
      if (result.status === "stopped" && ctx.signal.aborted) throw new Error("Đã dừng.")
      if (result.status === "failed" && !result.text) throw new Error(`Subagent lỗi: ${result.error ?? "không rõ nguyên nhân"}`)
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
      "Gửi thêm việc hoặc thông tin cho một subagent đã có, theo agent_id (trong <subagent_meta> hay kết quả chạy nền). Subagent giữ nguyên ngữ cảnh cũ. Đang chạy: nhận tin sau lượt hiện tại. Đã xong: chạy tiếp ở chế độ nền, kết quả đến qua <thong_bao_subagent>. Viết tin đủ rõ như giao việc mới.",
    input: z.object({
      to: z.string().min(1).describe("agent_id, ví dụ ag-k3f9x2"),
      message: z.string().min(1).describe("Nội dung giao thêm"),
    }),
    readOnly: true,
    // Only useful once a subagent exists: loaded with tool_search when needed.
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input) => `send_message(${input.to})`,
    async execute(input) {
      const outcome = await manager.continue(input.to.trim(), input.message, (type) => typeSpec(agents, type))
      return outcome === "queued"
        ? `Đã xếp tin cho subagent ${input.to}; nó nhận sau khi xong lượt hiện tại. Kết quả đến cùng thông báo khi nó xong.`
        : `Subagent ${input.to} đang chạy tiếp ở chế độ nền với tin này. Kết quả sẽ đến trong <thong_bao_subagent>.`
    },
  }
}

/** stop_agent: stop a running or queued subagent (its partial result is reported). */
export function stopAgentTool(manager: SubagentManager): ToolDef<{ id: string }> {
  return {
    name: "stop_agent",
    description: "Dừng một subagent đang chạy hoặc đang chờ slot, theo agent_id. Dùng khi việc của nó không còn cần nữa.",
    input: z.object({ id: z.string().min(1).describe("agent_id") }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input) => `stop_agent(${input.id})`,
    async execute(input) {
      const id = input.id.trim()
      if (manager.stop(id)) return `Đã dừng subagent ${id}.`
      const view = manager.get(id)
      if (view) return `Subagent ${id} không còn chạy (trạng thái: ${view.status}).`
      throw new Error(`Không có subagent "${id}".`)
    },
  }
}
