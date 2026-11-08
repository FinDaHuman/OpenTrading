import { createResource, createSignal, type JSX } from "solid-js"
import { cardsSwitchOn, loadConfig, memoryChoiceOf, saveConfig } from "../../core/config"
import { stillApplyLine } from "../../core/memory/binding/render"
import { closeMemory, createMemory, switchMemory, type MemoryChoice, type Runtime } from "../../core/runtime"
import { say } from "../notify"
import { color } from "../theme"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

/** The memory choices, in the order listed; the label is what the user picks by. */
export const MEMORY_CHOICES: { value: MemoryChoice; label: string; hint: string; said: string }[] = [
  { value: "none", label: "Tắt", hint: "không dùng memory", said: "Đã tắt memory. Dữ liệu đã lưu vẫn còn trên đĩa và sẽ dùng lại khi bật." },
  {
    value: "notebook",
    label: "Sổ ghi nhớ",
    hint: "ràng buộc, luận điểm, bài học trong memory.db; xem, xoá bằng /memory",
    said: "Đã bật sổ ghi nhớ (memory.db trong thư mục dữ liệu). Xem, xoá bằng /memory; model đọc bằng memory_read.",
  },
]

/**
 * Choosing the notebook again reopens it only when it failed to open (the retry path): a healthy one is
 * kept, since a new provider would forget what this session already sent the model. True when it changed.
 */
export async function saveMemoryChoice(runtime: Runtime, choice: MemoryChoice): Promise<boolean> {
  await saveConfig((current) => ({ memory: { ...current.memory, provider: choice } }))
  if (choice === runtime.memory.id && !(runtime.memory.problems?.() ?? []).length) {
    say(`Đang chọn «${MEMORY_CHOICES.find((c) => c.value === choice)!.label}»; không đổi gì.`, "info")
    return false
  }
  // The old store is closed before the new one opens: never two connections of this window on memory.db.
  closeMemory(runtime)
  switchMemory(runtime, createMemory(choice, runtime.home))
  const problem = runtime.memory.problems?.()[0]
  if (choice === "notebook" && problem) say(problem, "error", 15000)
  else say(MEMORY_CHOICES.find((c) => c.value === choice)!.said, "success", 8000)
  return true
}

/** Suggestion cards (spec 007): a switch of the notebook's own, like Codex's "Generate memories". */
export async function toggleCardsSwitch() {
  let on = false
  await saveConfig((current) => {
    on = current.memory?.cards === false
    return { memory: { ...current.memory, cards: on } }
  })
  say(
    on
      ? "Đã bật thẻ gợi ý: model có thể đề xuất lưu một ràng buộc, cách trình bày hay bài học; chỉ lưu khi bạn xác nhận trong form."
      : "Đã tắt thẻ gợi ý. Sổ ghi nhớ vẫn dùng như cũ.",
    "success",
    8000,
  )
}

/**
 * Memory on or off and the suggestion-card switch: /config › Memory and the Cài đặt tab of /memory.
 * `header` replaces the title (the tab row); `onChanged` runs after a choice was saved.
 */
export function MemorySettings(props: {
  runtime: Runtime
  hint: string
  header?: JSX.Element
  onChanged?: (what: MemoryChoice | "cards") => void
}) {
  const [config, { refetch }] = createResource(loadConfig)
  // The runtime's memory is replaced in place and is not reactive: `changed` makes the view read it again.
  const [changed, setChanged] = createSignal(0)
  const running = () => (changed(), props.runtime.memory.id)
  const memoryChoice = (): MemoryChoice => (config() ? memoryChoiceOf(config()!) : (running() as MemoryChoice))
  const memoryProblem = () => (running() === "notebook" ? props.runtime.memory.problems?.()[0] : undefined)
  /**
   * With the notebook off, constraints in the store still reach every agent: say so, and how to manage
   * them. Read again for each choice (a new source object), and shown only while the current choice, a
   * reactive value, is not the notebook: a resource keeps its last value when its source empties.
   */
  const [stillApplies] = createResource(
    () => (memoryChoice() !== "notebook" ? { choice: memoryChoice() } : undefined),
    async () => {
      const read = await props.runtime.constraints.read("main_agent")
      if (read.state === "failed") return `Không đọc được ràng buộc trong kho memory (${read.failure.file}): ${read.failure.reason}.`
      return read.state === "loaded" && read.lines.length > 0 ? stillApplyLine(read.lines.length) : undefined
    },
  )

  async function pick(value: MemoryChoice | "cards") {
    if (value === "cards") await toggleCardsSwitch()
    else await saveMemoryChoice(props.runtime, value)
    setChanged((n) => n + 1)
    await refetch()
    props.onChanged?.(value)
  }

  return (
    <DialogFrame title="Memory" header={props.header} hint={props.hint}>
      <text fg={color.tx3} wrapMode="word">
        Có hiệu lực ngay, không cần mở lại OpenTrading. Dữ liệu của lựa chọn khác vẫn giữ nguyên trên đĩa.
      </text>
      {memoryProblem() && (
        <text fg={color.tham} wrapMode="word">
          {memoryProblem()}
        </text>
      )}
      {memoryChoice() !== "notebook" && stillApplies() && (
        <text fg={color.tham} wrapMode="word">
          {stillApplies()}
        </text>
      )}
      <Picker
        items={[
          ...MEMORY_CHOICES.map((c) => ({
            label: c.label,
            hint: c.hint,
            mark: running() === c.value ? "●" : " ",
            value: c.value as MemoryChoice | "cards",
          })),
          // The switch belongs to the notebook that is running, not to what the config file says.
          ...(running() === "notebook"
            ? [
                {
                  label: "Cho phép thẻ gợi ý",
                  hint: cardsSwitchOn(config() ?? {})
                    ? "bật · model đề xuất lưu, bạn xác nhận trong form · enter để tắt"
                    : "tắt · enter để bật",
                  mark: cardsSwitchOn(config() ?? {}) ? "●" : "○",
                  value: "cards" as const,
                },
              ]
            : []),
        ]}
        onPick={(c) => void pick(c)}
      />
    </DialogFrame>
  )
}
