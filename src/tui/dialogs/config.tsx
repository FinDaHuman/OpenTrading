import { useKeys } from "../ui/keys"
import { MODE_LABEL, type PermissionMode } from "../../core/permission/mode"
import { createResource, createSignal, Match, Switch } from "solid-js"
import { loadConfig, saveConfig } from "../../core/config"
import { configFile } from "../../core/paths"
import { createMemory, switchMemory, type Runtime } from "../../core/runtime"
import { DEFAULT_MAX_CONCURRENT } from "../../core/subagents/manager"
import { AUTO_MODEL } from "../../core/subagents/model-pick"
import { DEFAULT_MAX_STEPS } from "../../core/agent"
import { isEffort } from "../../core/effort"
import { clampPercent, DEFAULT_COMPACT_PERCENT, MIN_COMPACT_WINDOW } from "../../core/compact"
import { fmtTokens, groupDigits } from "../../core/subagents/result"
import { blocked, closeDialog, contextLimits, providerName, setState, state } from "../state"
import { say } from "../notify"
import { color } from "../theme"
import { DialogFrame } from "./frame"
import { Picker, type PickerItem } from "./picker"
import { modelChoices, type ModelChoice } from "./model-choices"
import { describeScroll, nextScrollSetting, scrollSetting } from "../scroll"

/** Presets of `autoCompactPercent`; "cap" opens the token entry, "uncap" drops the cap. */
type CompactLevel = number | "cap" | "uncap"
const COMPACT_PERCENTS = [95, 90, 80, 70]

const DEFAULT_MODE_NEXT: Record<PermissionMode, PermissionMode> = { "read-only": "ask", ask: "auto", auto: "read-only" }

type Setting = "memory" | "toolSearch" | "autoCompact" | "compactLevel" | "maxSteps" | "effort" | "subagentMax" | "subagentModel" | "webModel" | "autoModel" | "defaultMode" | "tips" | "terminalNotify" | "scroll"
type SubagentModel = { provider: string; model: string } | "inherit" | "auto"

const TOOL_SEARCH_NEXT = { auto: "on", on: "off", off: "auto" } as const

const TOOL_SEARCH_HINT = {
  auto: "Tự động · hoãn tool khi > 40 tool hoặc > 10% context; model nạp bằng tool_search",
  on: "Luôn hoãn tool (MCP và tool có sẵn) · model nạp bằng tool_search",
  off: "Tắt · gửi mọi tool (tối đa 128)",
} as const

/** Settings that used to require editing ~/.opentrading/config.json by hand. Applied live. */
export function ConfigDialog(props: { runtime: Runtime }) {
  const [config, { refetch }] = createResource(loadConfig)
  /** A setting with its own sub-view (number entry, model list); undefined = the list. */
  const [editing, setEditing] = createSignal<"maxSteps" | "subagentMax" | "subagentModel" | "webModel" | "autoModel" | "compactLevel" | "compactWindow">()
  const [error, setError] = createSignal("")

  useKeys((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") editing() ? setEditing(undefined) : closeDialog()
  })

  const maxConcurrent = () => config()?.subagents?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT
  const maxSteps = () => config()?.maxSteps ?? DEFAULT_MAX_STEPS
  const webModel = () => {
    const w = config()?.webModel
    return w?.model ? `${providerName(w.provider ?? state.provider)} · ${w.model}` : undefined
  }
  const autoModel = () => {
    const a = config()?.autoMode?.model
    return a?.model ? `${providerName(a.provider ?? state.provider)} · ${a.model}` : undefined
  }
  const defaultMode = () => config()?.permissions?.defaultMode ?? "read-only"
  const subagentModel = () => {
    const s = config()?.subagents
    if (s?.model === AUTO_MODEL) return "Tự động (chọn model lite rẻ)"
    return s?.model ? `${providerName(s.provider ?? state.provider)} · ${s.model}` : undefined
  }

  /**
   * Models of connected providers that can call tools (a subagent without tools is useless),
   * grouped as in /model (favourites, recent, per provider); `chosen` is marked ●.
   */
  const ref = (c: { provider?: string; model?: string } | undefined) =>
    c?.model && c.model !== AUTO_MODEL ? { provider: c.provider ?? state.provider ?? "", model: c.model } : undefined
  const toolModels = (chosen: { provider?: string; model?: string } | undefined): PickerItem<SubagentModel>[] =>
    modelChoices({
      prefs: state.modelPrefs,
      current: ref(chosen),
      // The models already chosen stay listed even if the filters would hide them.
      keep: [ref(config()?.subagents), ref(config()?.webModel), ref(config()?.autoMode?.model)],
    }) as PickerItem<SubagentModel>[]
  /** A favourite that cannot be used now is said, not saved. */
  const usable = (c: SubagentModel) => {
    const why = typeof c === "object" ? (c as ModelChoice).unavailable : undefined
    if (why) say(`Không dùng được ${(c as ModelChoice).model}: ${why}.`, "error")
    return !why
  }

  async function saveMax(text: string) {
    const n = Number(text.trim())
    if (!Number.isInteger(n) || n < 1) return setError("Nhập một số nguyên từ 1 trở lên.")
    const current = await loadConfig()
    await saveConfig({ subagents: { ...current.subagents, maxConcurrent: n } })
    props.runtime.subagents.setMax(n)
    setState("agentSlots", props.runtime.subagents.limiter.stats())
    setError("")
    setEditing(undefined)
    await refetch()
  }

  async function saveSteps(text: string) {
    const n = Number(text.trim())
    if (!Number.isInteger(n) || n < 2 || n > 50) return setError("Nhập một số nguyên từ 2 đến 50.")
    await saveConfig({ maxSteps: n })
    setError("")
    setEditing(undefined)
    await refetch()
  }

  /** Where auto-compaction fires for the current model, e.g. "nén ở ~977k / 1M". */
  const compactAt = () => {
    const limits = contextLimits()
    return limits ? `nén ở ~${fmtTokens(limits.threshold)} / ${fmtTokens(limits.window)}` : "nén gần đầy cửa sổ của model"
  }

  async function saveLevel(level: CompactLevel) {
    if (level === "cap") return setEditing("compactWindow")
    if (level === "uncap") {
      await saveConfig({ compactWindow: undefined })
      setState("compactCap", undefined)
    } else {
      await saveConfig({ autoCompactPercent: level })
      setState("compactPercent", clampPercent(level))
    }
    setEditing(undefined)
    await refetch()
  }

  async function saveCap(text: string) {
    const raw = text.trim().replace(/[.,_\s]/g, "")
    const n = raw === "" ? undefined : Number(raw)
    if (n !== undefined && (!Number.isInteger(n) || n < MIN_COMPACT_WINDOW)) return setError(`Nhập số token từ ${groupDigits(MIN_COMPACT_WINDOW)} trở lên, hoặc để trống để bỏ trần.`)
    await saveConfig({ compactWindow: n })
    setState("compactCap", n)
    setError("")
    setEditing(undefined)
    await refetch()
  }

  async function saveWebModel(choice: Exclude<SubagentModel, "auto">) {
    await saveConfig({ webModel: choice === "inherit" ? undefined : choice })
    setEditing(undefined)
    await refetch()
  }

  async function saveAutoModel(choice: Exclude<SubagentModel, "auto">) {
    const current = await loadConfig()
    await saveConfig({ autoMode: { ...current.autoMode, model: choice === "inherit" ? undefined : choice } })
    setEditing(undefined)
    await refetch()
  }

  async function saveModel(choice: SubagentModel) {
    const current = await loadConfig()
    const { provider: _p, model: _m, ...rest } = current.subagents ?? {}
    const next = choice === "inherit" ? rest : choice === "auto" ? { ...rest, provider: undefined, model: AUTO_MODEL } : { ...rest, ...choice }
    await saveConfig({ subagents: next })
    setEditing(undefined)
    await refetch()
  }

  async function toggle(setting: Setting) {
    if (
      setting === "maxSteps" ||
      setting === "subagentMax" ||
      setting === "subagentModel" ||
      setting === "webModel" ||
      setting === "autoModel" ||
      setting === "compactLevel"
    )
      return setEditing(setting)
    if (setting === "defaultMode") {
      const current = await loadConfig()
      const next = DEFAULT_MODE_NEXT[defaultMode()]
      await saveConfig({ permissions: { ...current.permissions, defaultMode: next } })
      await refetch()
      return
    }
    if (setting === "effort") return setState("dialog", "effort")
    if (setting === "autoCompact") {
      const off = config()?.autoCompact !== "off"
      await saveConfig({ autoCompact: off ? "off" : "auto" })
      setState("autoCompactOff", off)
      await refetch()
      return
    }
    if (setting === "terminalNotify") {
      const current = await loadConfig()
      const on = current.ui?.terminalNotify === false
      await saveConfig({ ui: { ...current.ui, terminalNotify: on } })
      setState("terminalNotify", on)
      await refetch()
      return
    }
    if (setting === "scroll") {
      const current = await loadConfig()
      const next = nextScrollSetting(scrollSetting(current.ui))
      await saveConfig({ ui: { ...current.ui, scrollSpeed: next.speed, scrollAcceleration: next.accelerate } })
      setState("scroll", next)
      await refetch()
      return
    }
    if (setting === "tips") {
      const current = await loadConfig()
      const on = current.ui?.tips === false
      await saveConfig({ ui: { ...current.ui, tips: on } })
      setState("tips", on)
      await refetch()
      return
    }
    if (setting === "toolSearch") {
      const next = TOOL_SEARCH_NEXT[config()?.toolSearch ?? "auto"]
      await saveConfig({ toolSearch: next })
      await refetch()
      return
    }
    const next = props.runtime.memory.id === "file" ? "none" : "file"
    await saveConfig({ memory: { provider: next } })
    switchMemory(props.runtime, createMemory(next))
    say(
      next === "file"
        ? "Đã bật memory (lưu file ở ~/.opentrading/memory). Nói \"Ghi nhớ: …\" để lưu; xem và duyệt bằng /memory."
        : "Đã tắt memory. Các memory đã lưu vẫn còn trên đĩa và sẽ dùng lại khi bật.",
      "success",
      8000,
    )
    await refetch()
  }

  return (
    <Switch>
      <Match when={editing() === "subagentMax"}>
        <DialogFrame title="Subagent chạy song song" hint="enter lưu · esc quay lại">
          <text fg={color.tx3}>{`Số subagent chạy cùng lúc (cả chạy nền), hiện tại ${maxConcurrent()}. Vượt quá thì xếp hàng chờ.`}</text>
          <text fg={color.tx3}>Gói miễn phí (ví dụ Gemini) giới hạn số request mỗi phút: nên để thấp.</text>
          <input
            focused={!blocked()}
            placeholder={String(maxConcurrent())}
            textColor={color.tx}
            focusedTextColor={color.tx}
            backgroundColor={color.panel2}
            focusedBackgroundColor={color.panel2}
            onSubmit={(v: unknown) => typeof v === "string" && void saveMax(v)}
          />
          <text fg={color.giam}>{error()}</text>
        </DialogFrame>
      </Match>
      <Match when={editing() === "compactLevel"}>
        <DialogFrame title="Ngưỡng tự nén" hint="enter chọn · esc quay lại">
          <text fg={color.tx3} wrapMode="word">
            Mặc định dùng hết cửa sổ của model. Tự nén khi context tới % này của (cửa sổ − phần chừa cho câu trả lời). Thấp hơn: rẻ hơn mỗi lượt, nén sớm hơn.
          </text>
          <Picker
            items={[
              ...COMPACT_PERCENTS.map((p) => ({
                label: `${p}%${p === DEFAULT_COMPACT_PERCENT ? " (mặc định)" : ""}`,
                mark: state.compactPercent === p ? "●" : " ",
                value: p as CompactLevel,
              })),
              {
                label: "Trần theo token…",
                hint: state.compactCap ? `hiện tại ${groupDigits(state.compactCap)}` : "vd. 200000 cho Gemini gói miễn phí",
                mark: state.compactCap ? "●" : " ",
                value: "cap" as CompactLevel,
              },
              ...(state.compactCap ? [{ label: "Bỏ trần token", hint: "dùng hết cửa sổ của model", mark: " ", value: "uncap" as CompactLevel }] : []),
            ]}
            onPick={(level) => void saveLevel(level)}
          />
        </DialogFrame>
      </Match>
      <Match when={editing() === "compactWindow"}>
        <DialogFrame title="Trần cửa sổ context" hint="enter lưu · esc quay lại">
          <text fg={color.tx3} wrapMode="word">
            Số token tối đa coi là cửa sổ (thấp hơn cửa sổ của model thì mới có tác dụng); ngưỡng tự nén và ctx % tính theo trần này. Để trống để bỏ trần.
          </text>
          <text fg={color.tx3} wrapMode="word">
            Gemini gói miễn phí nhận tối đa 250K token đầu vào mỗi phút: request lớn hơn luôn bị 429, nên đặt khoảng 200000.
          </text>
          <input
            focused={!blocked()}
            placeholder={state.compactCap ? String(state.compactCap) : "200000"}
            textColor={color.tx}
            focusedTextColor={color.tx}
            backgroundColor={color.panel2}
            focusedBackgroundColor={color.panel2}
            onSubmit={(v: unknown) => typeof v === "string" && void saveCap(v)}
          />
          <text fg={color.giam}>{error()}</text>
        </DialogFrame>
      </Match>
      <Match when={editing() === "maxSteps"}>
        <DialogFrame title="Số bước mỗi lượt" hint="enter lưu · esc quay lại">
          <text fg={color.tx3}>{`Số lần model được gọi trong một lượt hỏi (mỗi lần có thể chạy nhiều tool song song), hiện tại ${maxSteps()}. Bước cuối luôn phải trả lời.`}</text>
          <text fg={color.tx3}>Tăng khi câu hỏi nghiên cứu dài bị dừng giữa chừng; mỗi bước là một request tới model.</text>
          <input
            focused={!blocked()}
            placeholder={String(maxSteps())}
            textColor={color.tx}
            focusedTextColor={color.tx}
            backgroundColor={color.panel2}
            focusedBackgroundColor={color.panel2}
            onSubmit={(v: unknown) => typeof v === "string" && void saveSteps(v)}
          />
          <text fg={color.giam}>{error()}</text>
        </DialogFrame>
      </Match>
      <Match when={editing() === "webModel"}>
        <DialogFrame title="Model cho tìm kiếm / đọc web" hint="enter chọn · esc quay lại">
          <text fg={color.tx3}>Dùng cho web_search (tìm kiếm của chính provider: Gemini, Anthropic, OpenAI), web_fetch có prompt và đặt tiêu đề phiên. Model rẻ giúp tiết kiệm quota.</text>
          <Picker
            items={[
              { label: "Theo model của phiên (mặc định)", mark: webModel() ? " " : "●", value: "inherit" as SubagentModel },
              ...toolModels(config()?.webModel),
            ]}
            onPick={(c) => usable(c) && void saveWebModel(c as Exclude<SubagentModel, "auto">)}
            groupJump
            rows={12}
            placeholder="gõ tên model để lọc…"
          />
        </DialogFrame>
      </Match>
      <Match when={editing() === "autoModel"}>
        <DialogFrame title="Model duyệt auto mode" hint="enter chọn · esc quay lại">
          <text fg={color.tx3} wrapMode="word">
            Ở chế độ ▸▸ tự động, model này duyệt từng lệnh / lần ghi file thay bạn (khoảng 1 request mỗi lần, thêm 1 khi bị nghi ngờ). Model yếu duyệt kém hơn: dễ chặn nhầm hoặc cho qua nhầm.
          </text>
          <Picker
            items={[
              { label: "Theo model của phiên (mặc định)", mark: autoModel() ? " " : "●", value: "inherit" as SubagentModel },
              ...toolModels(config()?.autoMode?.model),
            ]}
            onPick={(c) => usable(c) && void saveAutoModel(c as Exclude<SubagentModel, "auto">)}
            groupJump
            rows={12}
            placeholder="gõ tên model để lọc…"
          />
        </DialogFrame>
      </Match>
      <Match when={editing() === "subagentModel"}>
        <DialogFrame title="Model cho subagent" hint="enter chọn · esc quay lại">
          <Picker
            items={[
              { label: "Theo model của phiên (mặc định)", mark: subagentModel() ? " " : "●", value: "inherit" as SubagentModel },
              {
                label: "Tự động (chọn model lite rẻ)",
                hint: "tìm model nhỏ, gọi được tool từ các provider đã kết nối",
                mark: config()?.subagents?.model === AUTO_MODEL ? "●" : " ",
                value: "auto" as SubagentModel,
              },
              ...toolModels(config()?.subagents),
            ]}
            onPick={(c) => usable(c) && void saveModel(c)}
            groupJump
            rows={12}
            placeholder="gõ tên model để lọc… (chỉ model gọi được tool)"
          />
        </DialogFrame>
      </Match>
      <Match when={true}>
        <DialogFrame title="Cài đặt" hint="enter đổi · esc đóng">
          <Picker
            items={[
              {
                label: "Memory",
                hint:
                  (config()?.memory?.provider ?? props.runtime.memory.id) === "file"
                    ? "Bật · lưu file ở ~/.opentrading/memory"
                    : "Tắt · enter để bật",
                mark: props.runtime.memory.id === "file" ? "●" : "○",
                value: "memory" as Setting,
              },
              {
                label: "Tìm tool",
                hint: TOOL_SEARCH_HINT[config()?.toolSearch ?? "auto"],
                mark: (config()?.toolSearch ?? "auto") === "off" ? "○" : "●",
                value: "toolSearch" as Setting,
              },
              {
                label: "Tự nén hội thoại",
                hint:
                  config()?.autoCompact === "off"
                    ? "Tắt · chỉ nén khi gõ /compact"
                    : `Tự động · ${compactAt()}: dọn kết quả tool cũ, rồi tóm tắt nếu cần (1 request)`,
                mark: config()?.autoCompact === "off" ? "○" : "●",
                value: "autoCompact" as Setting,
              },
              {
                label: "Ngưỡng tự nén",
                hint: `${state.compactPercent}%${state.compactCap ? ` · trần ${fmtTokens(state.compactCap)} token` : " · hết cửa sổ của model"} · enter để đổi`,
                mark: "●",
                value: "compactLevel" as Setting,
              },
              {
                label: "Số bước mỗi lượt",
                hint: `${maxSteps()} bước gọi model · enter để đổi`,
                mark: "●",
                value: "maxSteps" as Setting,
              },
              {
                label: "Effort",
                hint: `phiên ${config()?.effort ?? "auto"} · subagent ${config()?.subagents?.effort ?? "theo phiên"} · ultradesk ${config()?.desk?.effort ?? "như subagent"} · enter mở /effort (ctrl+t đổi nhanh)`,
                mark: isEffort(config()?.effort) ? "●" : "○",
                value: "effort" as Setting,
              },
              {
                label: "Subagent chạy song song",
                hint: `${maxConcurrent()} cùng lúc (cả chạy nền) · vượt thì xếp hàng · enter để đổi`,
                mark: "●",
                value: "subagentMax" as Setting,
              },
              {
                label: "Model cho subagent",
                hint: subagentModel() ?? "Theo model của phiên · enter để chọn model khác (vd. rẻ hơn)",
                mark: subagentModel() ? "●" : "○",
                value: "subagentModel" as Setting,
              },
              {
                label: "Model cho tìm kiếm / đọc web",
                hint: webModel() ?? "Mặc định: model của phiên · enter để chọn model rẻ hơn",
                mark: webModel() ? "●" : "○",
                value: "webModel" as Setting,
              },
              {
                label: "Chế độ quyền khi mở",
                hint: `${MODE_LABEL[defaultMode()]} · enter để đổi (trong phiên: shift+tab)`,
                mark: "●",
                value: "defaultMode" as Setting,
              },
              {
                label: "Model duyệt auto mode",
                hint: autoModel() ?? "Mặc định: model của phiên · enter để chọn",
                mark: autoModel() ? "●" : "○",
                value: "autoModel" as Setting,
              },
              {
                label: "Báo khi xong / cần duyệt",
                hint:
                  config()?.ui?.terminalNotify === false
                    ? "Tắt · enter để bật"
                    : "Bật · thông báo khi bạn đang ở cửa sổ khác; vòng tiến trình trên tab Windows Terminal",
                mark: config()?.ui?.terminalNotify === false ? "○" : "●",
                value: "terminalNotify" as Setting,
              },
              {
                label: "Tốc độ lăn chuột",
                hint: `${describeScroll(scrollSetting(config()?.ui))} · enter để đổi (3 → 5 → 8 → tăng tốc)`,
                mark: "●",
                value: "scroll" as Setting,
              },
              {
                label: "Mẹo khi chờ",
                hint: config()?.ui?.tips === false ? "Tắt · enter để bật" : "Bật · một mẹo dưới dòng đang làm khi lượt chạy lâu",
                mark: config()?.ui?.tips === false ? "○" : "●",
                value: "tips" as Setting,
              },
            ]}
            onPick={(s) => void toggle(s)}
            rows={14}
          />
          <text fg={color.tx3} marginTop={1}>{`File cấu hình: ${configFile()}`}</text>
        </DialogFrame>
      </Match>
    </Switch>
  )
}
