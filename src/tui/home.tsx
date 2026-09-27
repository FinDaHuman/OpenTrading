import { For, Show } from "solid-js"
import { logo } from "./logo"
import { state } from "./state"
import { color } from "./theme"

const TIPS = [
  ["/connect", "nhập API key: Groq, Gemini, NVIDIA, OpenAI…"],
  ["/model", "chọn model"],
  ["/skills", "bật skill phân tích"],
  ["/help", "tất cả lệnh"],
]

export function Home() {
  return (
    <box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
      {/* Solid card so the animated tape frames the wordmark instead of running through it. */}
      <box
        flexDirection="column"
        alignItems="center"
        backgroundColor={color.bg}
        paddingLeft={4}
        paddingRight={4}
        paddingTop={1}
        paddingBottom={1}
      >
        <For each={logo.left}>
          {(row, i) => (
            <text>
              <span style={{ fg: color.tx }}>{row}</span>
              <span style={{ fg: color.tang }}>{"  " + logo.right[i()]}</span>
            </text>
          )}
        </For>
        <text marginTop={1}>
          <span style={{ fg: color.tang }}>{"▲ "}</span>
          <span style={{ fg: color.tx2 }}>Harness AI phân tích chứng khoán Việt Nam</span>
        </text>
        <text fg={color.tx3}>bản demo v0 · chưa kết nối dữ liệu thị trường · không phải tư vấn đầu tư</text>

        <box marginTop={1} flexDirection="column">
          <For each={TIPS}>
            {([cmd, desc]) => (
              <text>
                <span style={{ fg: color.tang }}>{cmd!.padEnd(12)}</span>
                <span style={{ fg: color.tx3 }}>{desc}</span>
              </text>
            )}
          </For>
        </box>

        <Show when={!state.provider || !state.model}>
          <text fg={color.tham} marginTop={1}>
            {!state.provider ? "● Chưa kết nối provider — gõ /connect để bắt đầu" : "● Chưa chọn model — gõ /model"}
          </text>
        </Show>
      </box>
    </box>
  )
}
