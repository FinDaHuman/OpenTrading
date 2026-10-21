import { useKeyboard } from "@opentui/solid"
import { createResource, createSignal, For, Show } from "solid-js"
import type { CatalogProvider } from "../../core/catalog"
import { loadConfig, saveConfig, type Config } from "../../core/config"
import { deskSettings } from "../../core/desk/settings"
import { DESK_SIZES, type DeskSize } from "../../core/desk/types"
import { EFFORT_LEVELS, EFFORT_SYMBOL, effectiveEffort, stepEffort, supportedEfforts, type Effort } from "../../core/effort"
import { say } from "../notify"
import { closeDialog, providerName, setState, state } from "../state"
import { color } from "../theme"
import { DialogFrame } from "./frame"

/**
 * /effort (the user picked "/effort + ctrl+t", 22/10; Claude Code's /effort): how hard each
 * kind of agent thinks, in one place instead of /config.
 *
 *   ❯ Phiên chính      ◂ ◐ medium ▸        model nhận: low · medium · high
 *     Subagent         ◂ theo phiên ▸
 *     Ultradesk        ◂ ● high ▸          agent trong mỗi run
 *     Quy mô ultradesk ◂ small ▸           mặc định trên thẻ duyệt
 *
 * ←/→ change and save at once; the next request uses it.
 */

type Row = "main" | "subagent" | "desk" | "deskSize"
const ROWS: Row[] = ["main", "subagent", "desk", "deskSize"]
const CHOICES: (Effort | undefined)[] = [undefined, ...EFFORT_LEVELS]

/** The current model, as effort.ts needs it; undefined before a model is chosen. */
export function currentTarget(): { provider: CatalogProvider; model: string } | undefined {
  const provider = state.provider ? (state.catalog[state.provider] as CatalogProvider | undefined) : undefined
  return provider && state.model ? { provider, model: state.model } : undefined
}

/** "◐ medium", or what an unset level means. */
export const effortText = (e: Effort | undefined, unset: string) => (e ? `${EFFORT_SYMBOL[e]} ${e}` : unset)

/** What the current model does with `wanted`: the levels it takes, or that it ignores effort. */
export function supportNote(wanted: Effort | undefined): { text: string; fg: string } {
  const target = currentTarget()
  if (!target) return { text: "chưa chọn model", fg: color.tx3 }
  const levels = supportedEfforts(target)
  if (levels.length === 0) return { text: "model này không có mức effort (lưu cho model khác)", fg: color.tx3 }
  const sent = effectiveEffort(target, wanted)
  const stepped = wanted && sent && sent !== wanted ? ` · ${wanted} chạy như ${sent}` : ""
  return { text: `model nhận: ${levels.join(" · ")}${stepped}`, fg: stepped ? color.tham : color.tx3 }
}

export function EffortDialog() {
  const [config, { refetch }] = createResource(loadConfig)
  const [row, setRow] = createSignal<Row>("main")

  const value = (r: Row, c: Config | undefined): Effort | DeskSize | undefined =>
    r === "main" ? c?.effort : r === "subagent" ? c?.subagents?.effort : r === "desk" ? c?.desk?.effort : deskSettings(c ?? {}).size

  async function change(r: Row, dir: 1 | -1) {
    const c = config() ?? (await loadConfig())
    if (r === "deskSize") {
      const list = DESK_SIZES
      const next = list[(list.indexOf(deskSettings(c).size) + dir + list.length) % list.length]!
      await saveConfig({ desk: { ...c.desk, size: next } })
    } else {
      const next = stepEffort(value(r, c) as Effort | undefined, CHOICES, dir)
      if (r === "main") {
        await saveConfig({ effort: next })
        setState("effort", next)
      } else if (r === "subagent") await saveConfig({ subagents: { ...c.subagents, effort: next } })
      else await saveConfig({ desk: { ...c.desk, effort: next } })
    }
    await refetch()
  }

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    evt.preventDefault()
    const at = ROWS.indexOf(row())
    if (evt.name === "up") return setRow(ROWS[(at + ROWS.length - 1) % ROWS.length]!)
    if (evt.name === "down" || evt.name === "tab") return setRow(ROWS[(at + 1) % ROWS.length]!)
    if (evt.name === "left" || evt.name === "right") {
      void change(row(), evt.name === "left" ? -1 : 1).catch((error) => say(`Không lưu được: ${error instanceof Error ? error.message : String(error)}`, "error"))
      return
    }
    if (evt.name === "escape" || evt.name === "return") closeDialog()
  })

  const lines = (): { row: Row; label: string; value: string; note: { text: string; fg: string } }[] => {
    const c = config()
    return [
      { row: "main", label: "Phiên chính", value: effortText(c?.effort, "auto"), note: supportNote(c?.effort) },
      { row: "subagent", label: "Subagent", value: effortText(c?.subagents?.effort, "theo phiên"), note: { text: "loại agent có effort riêng thì dùng của nó", fg: color.tx3 } },
      { row: "desk", label: "Ultradesk", value: effortText(c?.desk?.effort, "như subagent"), note: { text: "agent trong mỗi run; đổi riêng từng run trên thẻ duyệt", fg: color.tx3 } },
      { row: "deskSize", label: "Quy mô ultradesk", value: deskSettings(c ?? {}).size, note: { text: "mặc định trên thẻ duyệt (small → unrestricted)", fg: color.tx3 } },
    ]
  }
  const model = () => (state.provider && state.model ? `${providerName(state.provider)} · ${state.model}` : "chưa chọn model")

  return (
    <DialogFrame title={`Effort · ${model()}`} hint="↑↓ chọn · ←→ đổi (lưu ngay) · enter/esc đóng · ctrl+t đổi nhanh effort phiên chính">
      <Show when={config()} fallback={<text fg={color.tx3}>Đang đọc cấu hình…</text>}>
        <For each={lines()}>
          {(l) => (
            <box flexDirection="row" height={1} flexShrink={0}>
              <text wrapMode="none" flexShrink={0} fg={row() === l.row ? color.tang : color.tx}>
                {`${row() === l.row ? "❯ " : "  "}${l.label.padEnd(17)}`}
              </text>
              <text wrapMode="none" flexShrink={0} fg={row() === l.row ? color.tx : color.tx2}>
                <span style={{ bold: row() === l.row }}>{`◂ ${l.value} ▸`.padEnd(18)}</span>
              </text>
              <text wrapMode="none" flexShrink={1} fg={l.note.fg}>
                {`  ${l.note.text}`}
              </text>
            </box>
          )}
        </For>
        <text fg={color.tx3} marginTop={1} wrapMode="word">
          {`Effort cao: model nghĩ lâu hơn, trả lời chậm hơn và tốn token/quota hơn. auto = mặc định của provider. ${EFFORT_LEVELS.map((e) => `${EFFORT_SYMBOL[e]} ${e}`).join(" · ")}; mức model thiếu chạy như mức thấp hơn gần nhất.`}
        </text>
      </Show>
    </DialogFrame>
  )
}
