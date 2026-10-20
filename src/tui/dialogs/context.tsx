import { pad } from "../ui/text"
import { tokensOf } from "../../core/compact"
import { useKeys } from "../ui/keys"
import { createResource, For, Match, Show, Switch } from "solid-js"
import { groupDigits } from "../../core/subagents/result"
import { previewContext } from "../../core/agent"
import { describeError } from "../../core/chat"
import type { LayerReport } from "../../core/prompt/assemble"
import type { Runtime } from "../../core/runtime"
import { currentSession } from "../session"
import { closeDialog, contextLimits, state } from "../state"
import { color } from "../theme"
import { DialogFrame } from "./frame"

const CHANNEL: Record<LayerReport["channel"], string> = {
  system: "system",
  context: "ngữ cảnh",
  reminder: "nhắc nhở",
}

const LAYER_NAME: Record<string, string> = {
  identity: "Danh tính & bất biến",
  tools: "Cách dùng tool",
  tool_schemas: "Định nghĩa tool",
  tool_hoan: "Danh sách tool hoãn",
  huong_dan_mcp: "Hướng dẫn từ MCP server",
  citations: "Trình bày số liệu",
  style: "Văn phong",
  skills_always: "Skill luôn bật",
  skill_catalog: "Danh sách skill",
  ho_so_nha_dau_tu: "Hồ sơ nhà đầu tư",
  memory: "Memory",
  skill_dang_bat: "Skill bật tay",
  phien_giao_dich: "Đồng hồ phiên",
  goi_y_skill: "Gợi ý skill",
  memory_policy: "Cách dùng memory",
  memory_lien_quan: "Memory liên quan",
  hook_context: "Ngữ cảnh từ hook",
  viec_can_lam: "Việc cần làm",
}


/** What the next request would carry, layer by layer (HarnessPlan §10.2 observability). */
export function ContextDialog(props: { runtime: Runtime }) {
  const [preview] = createResource(() =>
    previewContext({
      input: "",
      skills: state.skills,
      sticky: state.activeSkills,
      prevClock: state.clock,
      history: state.history,
      registry: props.runtime.registry,
      memory: props.runtime.memory,
      serverInstructions: () => props.runtime.mcp.instructions(),
      sessionId: currentSession().id,
    }),
  )

  useKeys((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") closeDialog()
  })

  return (
    <DialogFrame title="Ngữ cảnh gửi cho model" hint="esc đóng">
      <Switch>
        <Match when={preview.loading}>
          <text fg={color.tx2}>Đang tính…</text>
        </Match>
        <Match when={preview.error}>
          <text fg={color.giam}>{describeError(preview.error)}</text>
        </Match>
        <Match when={preview()}>
          {(p) => {
            const total = () => p().report.reduce((sum, r) => sum + r.tokens, 0)
            const history = () => tokensOf(state.history)
            const limits = contextLimits()
            return (
              <>
                <text fg={color.tx2} wrapMode="none">{`${p().model} · hạng ${p().tier} · ~${total()} token (ước lượng, chưa gồm history)`}</text>
                <text fg={color.tx2} wrapMode="none">
                  {`History ~${groupDigits(history())} token · đang dùng ${
                    state.contextTokens !== undefined
                      ? `${groupDigits(state.contextTokens)} token${limits ? ` (${Math.round((state.contextTokens / limits.window) * 100)}%)` : ""} · ${
                          state.contextEstimated ? "ước lượng" : "theo provider"
                        }`
                      : "? token"
                  }`}
                </text>
                <Show when={limits}>
                  {(l) => (
                    <text fg={color.tx2} wrapMode="none">
                      {`Cửa sổ ${groupDigits(l().window)}${l().capped ? " (trần compactWindow)" : ""} · chừa ${groupDigits(l().reserve)} cho trả lời · ${
                        state.autoCompactOff ? "tự nén tắt" : `tự nén ở ${groupDigits(l().threshold)} (${state.compactPercent}% phần còn lại)`
                      }`}
                    </text>
                  )}
                </Show>
                <Show when={Object.keys(state.agents).length > 0}>
                  <text fg={color.tx2} wrapMode="none">{subagentLine()}</text>
                </Show>
                <text fg={color.tham} marginTop={1} wrapMode="none">
                  {`${pad("Tầng", 6)}${pad("Nội dung", 22)}${pad("Kênh", 11)}${pad("Token", 8)}Ghi chú`}
                </text>
                <For each={p().report}>
                  {(r) => (
                    <text fg={r.dropped ? color.tx3 : color.tx} wrapMode="none">
                      {`${pad(String(r.layer), 6)}${pad(LAYER_NAME[r.id] ?? r.id, 22)}${pad(CHANNEL[r.channel], 11)}${pad(`~${r.tokens}`, 8)}${
                        r.note ?? (r.dropped ? "bỏ (hết ngân sách)" : r.truncated ? "đã cắt bớt" : "")
                      }`}
                    </text>
                  )}
                </For>
                <text fg={color.tx3} marginTop={1} wrapMode="word">
                  Nội dung prompt nằm trong thư mục prompts/, hồ sơ trong INVESTOR.md (/profile), skill trong skills/. Nhắc nhở chỉ gửi khi thay đổi.
                </text>
              </>
            )
          }}
        </Match>
      </Switch>
    </DialogFrame>
  )
}

/** Subagents of this session: count and billed tokens (sum over their requests, not comparable to ctx %). */
function subagentLine() {
  const all = Object.values(state.agents)
  const tokens = all.reduce((n, a) => n + a.usage.input + a.usage.output, 0)
  return `Subagent: ${all.length} lần · ${groupDigits(tokens)} token tính phí (cộng mọi request của subagent, không tính vào ctx)`
}
