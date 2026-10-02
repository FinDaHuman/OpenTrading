import { useKeyboard } from "@opentui/solid"
import { createResource, For, Match, Switch } from "solid-js"
import { previewContext } from "../../core/agent"
import { describeError } from "../../core/chat"
import type { LayerReport } from "../../core/prompt/assemble"
import type { Runtime } from "../../core/runtime"
import { currentSession } from "../session"
import { closeDialog, state } from "../state"
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
  citations: "Trích nguồn",
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
}

const pad = (text: string, width: number) => (text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length))

/** What the next request would carry, layer by layer (HarnessPlan §10.2 observability). */
export function ContextDialog(props: { runtime: Runtime }) {
  const [preview] = createResource(() =>
    previewContext({
      input: "",
      skills: state.skills,
      sticky: state.activeSkills,
      prevClock: state.clock,
      registry: props.runtime.registry,
      memory: props.runtime.memory,
      sessionId: currentSession().id,
    }),
  )

  useKeyboard((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") closeDialog()
  })

  return (
    <DialogFrame title="Ngữ cảnh gửi cho model" hint="esc đóng" width={78}>
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
            return (
              <>
                <text fg={color.tx2}>{`${p().model} · hạng ${p().tier} · ~${total()} token (ước lượng, chưa gồm history)`}</text>
                <text fg={color.tham} marginTop={1}>
                  {`${pad("Tầng", 6)}${pad("Nội dung", 22)}${pad("Kênh", 11)}${pad("Token", 8)}Ghi chú`}
                </text>
                <For each={p().report}>
                  {(r) => (
                    <text fg={r.dropped ? color.tx3 : color.tx}>
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
