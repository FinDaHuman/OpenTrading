import { createResource, For, Show } from "solid-js"
import { loadOpenTradingWordmark } from "./logo"
import { state } from "./state"
import { color } from "./theme"

const TIPS = [
  ["/connect", "nhập API key: Groq, Gemini, NVIDIA, OpenAI…"],
  ["/model", "chọn model"],
  ["/profile", "hồ sơ nhà đầu tư của bạn"],
  ["/skills", "skill phân tích"],
  ["/help", "tất cả lệnh"],
]

export function Home() {
  const [wordmark] = createResource(loadOpenTradingWordmark)

  return (
    // Shrinks (and clips) when the command list needs the room, never the other way round.
    <box flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden" flexDirection="column" alignItems="center" justifyContent="center">
      {/* Keep the supplied reference intact instead of redrawing it with terminal glyphs. */}
      <box
        id="home-card"
        width={60}
        flexDirection="column"
        alignItems="center"
        backgroundColor={color.bg}
        paddingLeft={0}
        paddingRight={0}
        paddingTop={0}
        paddingBottom={0}
      >
        <Show when={wordmark()}>
          <image
            id="open-trading-wordmark"
            source={wordmark()!}
            fit="fit"
            protocol="auto"
            width={60}
            height={4}
            flexShrink={1}
          />
        </Show>
        <text>
          <span style={{ fg: color.tang }}>{"▲ "}</span>
          <span style={{ fg: color.tx2 }}>Harness AI phân tích chứng khoán Việt Nam</span>
        </text>
        <text fg={color.tx3}>bản demo · chưa kết nối dữ liệu · không phải tư vấn đầu tư</text>

        <box flexDirection="column">
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
          <text fg={color.tham}>
            {!state.provider ? "● Chưa kết nối provider — gõ /connect để bắt đầu" : "● Chưa chọn model — gõ /model"}
          </text>
        </Show>
      </box>
    </box>
  )
}
