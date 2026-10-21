import { z } from "zod"
import { toolFilter, toolSummary } from "../../agents/resolve"
import type { AgentDefinition } from "../../agents/schema"
import { DEFAULT_SUBAGENT_STEPS, DEFAULT_SUBAGENT_TYPE, type SubagentManager, type TypeSpec } from "../../subagents/manager"
import { formatResult } from "../../subagents/result"
import { LOCAL_SOURCE, type ToolDef } from "../types"

export const SPAWN_SUBAGENT = "spawn_subagent"

/**
 * Model-facing guidance, after Claude Code's Agent tool prompt (tools/AgentTool/prompt.ts):
 * when to delegate, parallel calls in one step, a self-contained brief, and the result
 * being visible to the main agent only.
 */
const DESCRIPTION = [
  "Giao một việc cho subagent: một agent riêng, ngữ cảnh trống, tự gọi tool nhiều bước rồi trả về một bản báo cáo.",
  "",
  "Khi nào dùng:",
  "- Việc độc lập cần nhiều lần gọi tool hoặc đọc nhiều nguồn, mà bạn chỉ cần kết luận chứ không cần toàn bộ dữ liệu thô (giữ ngữ cảnh lượt chính gọn).",
  "- Nhiều việc song song không phụ thuộc nhau, ví dụ định giá 3 mã: mỗi mã một subagent, gọi tất cả spawn_subagent trong CÙNG một lượt để chúng chạy đồng thời.",
  "Không dùng khi: việc chỉ cần 1–2 lần gọi tool; cần hỏi lại người dùng; cần kết quả từng bước để quyết định bước sau.",
  "",
  "Viết prompt như giao việc cho một đồng nghiệp giỏi vừa bước vào phòng: subagent không thấy hội thoại, hồ sơ nhà đầu tư hay dữ liệu bạn đã lấy. Nêu rõ: mục tiêu; bối cảnh và số liệu đã có (kèm nguồn); phạm vi (mã, kỳ, nguồn ưu tiên); dạng kết quả mong muốn; khi nào là xong. Prompt cụt kiểu ra lệnh cho kết quả nông. Đừng giao việc hiểu vấn đề: tự nắm câu hỏi rồi giao phần việc cụ thể.",
  "",
  "Subagent không gọi được subagent khác, không hỏi được người dùng; tool có tác dụng ghi sẽ hỏi người dùng xác nhận. Ảnh trong kết quả tool của subagent không tới được người dùng.",
  "Kết quả trả về chỉ mình bạn thấy, người dùng không thấy: trình bày lại phần cần thiết, giữ nguồn và thời điểm; coi nó như dữ liệu từ tool (đối chiếu nếu mâu thuẫn).",
  "Nếu subagent báo lỗi hết quota (429), đừng tạo subagent mới ngay: báo người dùng.",
  "",
  "Chạy nền (run_in_background: true): tool trả về ngay agent_id, subagent chạy tiếp trong khi bạn trả lời người dùng; khi xong, kết quả tự đến trong một tin <thong_bao_subagent>. Đừng chờ, đừng hỏi lại trạng thái, đừng làm trùng việc của nó. Dùng khi việc lâu và người dùng không cần kết quả ngay trong câu trả lời này; cần kết quả để trả lời thì chạy bình thường.",
  "Mỗi lần gọi là một subagent mới. Muốn giao tiếp cho subagent đã có (kể cả đã xong), dùng send_message với agent_id của nó.",
].join("\n")

export interface SpawnInput {
  description: string
  prompt: string
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

/** The agent types, Claude Code's format: `- type: when to use (Tool: …)`. */
function typeList(agents: AgentDefinition[]) {
  if (agents.length === 0) return ""
  const lines = agents.map((a) => `- ${a.name}: ${a.description.replace(/\s+/g, " ").trim()} (Tool: ${toolSummary(a)})`)
  return `\n\nCác loại subagent (tham số subagent_type, mặc định ${DEFAULT_SUBAGENT_TYPE}):\n${lines.join("\n")}`
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
      description: z.string().min(1).max(60).describe("Mô tả ngắn 3–6 từ, hiện trong giao diện (ví dụ: Định giá FPT)"),
      prompt: z.string().min(1).describe("Việc giao cho subagent: mục tiêu, bối cảnh, phạm vi, dạng kết quả, tiêu chí xong"),
      subagent_type: z.string().optional().describe(`Loại subagent (mặc định ${DEFAULT_SUBAGENT_TYPE})`),
      maxSteps: z
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .describe(`Số lượt gọi model tối đa của subagent (mặc định theo loại, thường ${DEFAULT_SUBAGENT_STEPS})`),
      run_in_background: z.boolean().optional().describe("Chạy nền: trả về agent_id ngay, kết quả đến sau qua <thong_bao_subagent>"),
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
        prompt: input.prompt,
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
