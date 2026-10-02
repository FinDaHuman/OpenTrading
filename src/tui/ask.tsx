import { useKeyboard } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { AskBroker, AskRequest } from "../core/ask"
import { color } from "./theme"
import { truncate } from "./ui/text"
import { useTerminalDimensions } from "@opentui/solid"

/**
 * Questions from the model (ask_user), in place of the prompt input. After Claude Code's
 * AskUserQuestion: a tab per question header plus "Gửi" when there is more than one
 * question (or a multi-select), numbered options with descriptions, a last option to type
 * your own answer, a review screen before sending. One single-choice question sends on
 * pick. Esc declines (the model is told to stop and wait).
 */

const OTHER = "Khác (tự nhập)"

interface Answer {
  picked: number[]
  other: string
}

export function AskPrompt(props: { broker: AskBroker; request: AskRequest }) {
  const dims = useTerminalDimensions()
  const questions = () => props.request.questions
  const tabbed = () => questions().length > 1 || questions().some((q) => q.multiSelect)
  const [tab, setTab] = createSignal(0) // questions().length = review
  const [cursor, setCursor] = createSignal(0)
  const [typing, setTyping] = createSignal(false)
  const [answers, setAnswers] = createStore<Answer[]>(questions().map(() => ({ picked: [], other: "" })))
  let draft = ""

  const reviewing = () => tabbed() && tab() === questions().length
  const current = () => questions()[tab()]
  const optionCount = () => (current()?.options.length ?? 0) + 1 // + "Khác"
  const answerText = (i: number) => {
    const q = questions()[i]!
    const a = answers[i]!
    const labels = a.picked.map((p) => q.options[p]!.label)
    if (a.other.trim()) labels.push(a.other.trim())
    return labels.join(", ")
  }
  const answered = (i: number) => answerText(i) !== ""
  const unanswered = createMemo(() => questions().filter((_, i) => !answered(i)).length)

  function send() {
    const out: Record<string, string> = {}
    questions().forEach((q, i) => {
      if (answered(i)) out[q.question] = answerText(i)
    })
    props.broker.respond(props.request.id, out)
  }
  const decline = () => props.broker.respond(props.request.id, undefined)

  function next() {
    setTab((t) => Math.min(t + 1, tabbed() ? questions().length : 0))
    setCursor(0)
  }

  function pick(index: number) {
    const q = current()
    if (!q) return
    if (index === q.options.length) {
      draft = answers[tab()]!.other
      return setTyping(true)
    }
    if (q.multiSelect) {
      setAnswers(
        tab(),
        produce((a) => {
          a.picked = a.picked.includes(index) ? a.picked.filter((p) => p !== index) : [...a.picked, index]
        }),
      )
      return
    }
    setAnswers(tab(), { picked: [index], other: "" })
    if (!tabbed()) return send()
    next()
  }

  function submitOther() {
    const text = draft.trim()
    setTyping(false)
    // Enter on an empty box means "nothing typed yet", not "cancel everything".
    if (!text) return
    const q = current()!
    setAnswers(tab(), q.multiSelect ? { other: text } : { picked: [], other: text })
    if (!tabbed()) return send()
    if (!q.multiSelect) next()
  }

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    if (typing()) {
      if (evt.name === "escape") {
        evt.preventDefault()
        setTyping(false)
      }
      return // the text box owns the other keys; enter submits through onSubmit
    }
    evt.preventDefault()
    const name = evt.name ?? ""
    if (name === "escape") return decline()
    if (tabbed() && (name === "left" || name === "right" || name === "tab" || name === "h" || name === "l")) {
      const back = name === "left" || name === "h" || (name === "tab" && evt.shift)
      setTab((t) => (t + (back ? questions().length : 1)) % (questions().length + 1))
      return setCursor(0)
    }
    if (reviewing()) {
      if (name === "up" || name === "down" || name === "k" || name === "j") setCursor((c) => 1 - c)
      else if (name === "1") send()
      else if (name === "2") decline()
      else if (name === "return") cursor() === 0 ? send() : decline()
      return
    }
    const n = optionCount()
    if (name === "up" || name === "k") setCursor((c) => (c + n - 1) % n)
    else if (name === "down" || name === "j") setCursor((c) => (c + 1) % n)
    else if (name === "space" && current()?.multiSelect) pick(cursor())
    else if (name === "return") {
      if (current()?.multiSelect && cursor() < n - 1) pick(cursor())
      else pick(cursor())
    } else if (/^[1-9]$/.test(name) && Number(name) <= n) {
      setCursor(Number(name) - 1)
      pick(Number(name) - 1)
    }
  })

  const width = () => Math.max(20, dims().width - 12)

  return (
    <box
      flexShrink={0}
      marginLeft={2}
      marginRight={2}
      border={["top"]}
      borderStyle="rounded"
      borderColor={color.san}
      title=" Câu hỏi cho bạn "
      titleAlignment="left"
      backgroundColor={color.panel2}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      <Show when={tabbed()}>
        <text marginTop={1} wrapMode="none">
          <For each={questions()}>
            {(q, i) => (
              <span style={{ fg: tab() === i() ? color.bg : answered(i()) ? color.tang : color.tx3, bg: tab() === i() ? color.san : undefined }}>
                {` ${answered(i()) ? "☒" : "☐"} ${q.header} `}
              </span>
            )}
          </For>
          <span style={{ fg: reviewing() ? color.bg : color.tx2, bg: reviewing() ? color.san : undefined }}>{" ✔ Gửi "}</span>
        </text>
      </Show>

      <Show
        when={!reviewing() && current()}
        fallback={
          <box flexDirection="column" marginTop={1}>
            <text fg={color.tx}>
              <span style={{ bold: true }}>Xem lại câu trả lời</span>
            </text>
            <Show when={unanswered() > 0}>
              <text fg={color.tham}>{`△ Còn ${unanswered()} câu chưa trả lời`}</text>
            </Show>
            <For each={questions()}>
              {(q, i) => (
                <box flexDirection="column" marginTop={1}>
                  <text fg={color.tx2} wrapMode="none">
                    {`• ${truncate(q.question, width())}`}
                  </text>
                  <text fg={answered(i()) ? color.tang : color.tx3} wrapMode="none">
                    {`  → ${answered(i()) ? truncate(answerText(i()), width()) : "(chưa trả lời)"}`}
                  </text>
                </box>
              )}
            </For>
            <text fg={cursor() === 0 ? color.tang : color.tx} marginTop={1}>
              {`${cursor() === 0 ? "❯" : " "} 1. Gửi câu trả lời`}
            </text>
            <text fg={cursor() === 1 ? color.tang : color.tx}>{`${cursor() === 1 ? "❯" : " "} 2. Huỷ`}</text>
          </box>
        }
      >
        {(q) => (
          <box flexDirection="column" marginTop={1}>
            <text fg={color.tx} wrapMode="word">
              <span style={{ bold: true }}>{q().question}</span>
            </text>
            <For each={[...q().options, { label: OTHER, description: undefined }]}>
              {(option, i) => {
                const active = () => cursor() === i()
                const isOther = () => i() === q().options.length
                const chosen = () => (isOther() ? answers[tab()]!.other.trim() !== "" : answers[tab()]!.picked.includes(i()))
                return (
                  <box flexDirection="column" marginTop={i() === 0 ? 1 : 0}>
                    <text wrapMode="none">
                      <span style={{ fg: active() ? color.tang : color.tx3 }}>{active() ? "❯ " : "  "}</span>
                      <span style={{ fg: color.tx3 }}>{`${i() + 1}. `}</span>
                      <span style={{ fg: color.tang }}>{q().multiSelect ? (chosen() ? "[✔] " : "[ ] ") : ""}</span>
                      <span style={{ fg: active() ? color.tang : color.tx, bold: active() }}>{option.label}</span>
                      <span style={{ fg: color.tang }}>{!q().multiSelect && chosen() ? "  ✔" : ""}</span>
                      <span style={{ fg: color.tx2 }}>{isOther() && answers[tab()]!.other ? `  "${truncate(answers[tab()]!.other, 40)}"` : ""}</span>
                    </text>
                    <Show when={option.description}>
                      <text fg={color.tx3} wrapMode="none">
                        {`     ${truncate(option.description!, width() - 5)}`}
                      </text>
                    </Show>
                  </box>
                )
              }}
            </For>
            <Show when={typing()}>
              <box flexDirection="row" marginTop={1}>
                <text fg={color.san}>{"✎ Câu trả lời của bạn: "}</text>
                <input
                  flexGrow={1}
                  focused
                  value={answers[tab()]!.other}
                  placeholder="gõ rồi enter"
                  textColor={color.tx}
                  focusedTextColor={color.tx}
                  backgroundColor={color.panel2}
                  focusedBackgroundColor={color.panel2}
                  onInput={(v: string) => (draft = v)}
                  onSubmit={submitOther}
                />
              </box>
            </Show>
          </box>
        )}
      </Show>

      <text fg={color.tx3} marginTop={1} wrapMode="none">
        {typing()
          ? "enter lưu câu trả lời · esc quay lại"
          : reviewing()
            ? "↑↓ chọn · enter xác nhận · ←→ đổi câu · esc huỷ"
            : `↑↓ chọn · ${current()?.multiSelect ? "space/enter bật tắt · → câu tiếp" : "enter chọn"} · 1-${optionCount()} chọn nhanh${tabbed() ? " · ←→/tab đổi câu" : ""} · esc huỷ`}
      </text>
    </box>
  )
}
