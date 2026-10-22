import os from "node:os"
import { For, Show } from "solid-js"
import { logo } from "./logo"
import { state } from "./state"
import { color } from "./theme"

const TIPS = [
  ["/connect", "nhập API key: Groq, Gemini, NVIDIA, OpenAI…"],
  ["/model", "chọn model"],
  ["/profile", "hồ sơ nhà đầu tư của bạn"],
  ["/mcp", "kết nối nguồn dữ liệu (MCP)"],
  ["/skills", "skill phân tích"],
  ["/help", "tất cả lệnh"],
]

/** `~` for the home folder, so the workspace line stays short. */
export function shortPath(p: string, home = os.homedir()) {
  const lower = (s: string) => (process.platform === "win32" ? s.toLowerCase() : s)
  return lower(p).startsWith(lower(home)) && /^[\\/]?$/.test(p.charAt(home.length)) ? `~${p.slice(home.length)}` : p
}

/** `workspace`: where the agent reads and writes; `fallback`: why it is not the folder we opened in. */
export function Home(props: { workspace?: string; fallback?: string }) {
  return (
    // Shrinks (and clips) when the command list needs the room, never the other way round.
    <box flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden" flexDirection="column" alignItems="center" justifyContent="center">
      {/* Solid card so the animated tape frames the wordmark instead of running through it. */}
      {/* flexShrink 0: when the "/" list takes the room, the outer box clips this card
          instead of squeezing its rows on top of each other ("/modelct"). */}
      <box
        flexShrink={0}
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
        <text fg={color.tx3}>
          {(() => {
            const live = state.mcp.filter((s) => s.state === "connected").length
            return `${live > 0 ? `${live} nguồn dữ liệu MCP đã kết nối` : "chưa kết nối nguồn dữ liệu — /mcp để thêm"} · không phải tư vấn đầu tư`
          })()}
        </text>

        <Show when={props.workspace}>
          {(dir) => (
            <text fg={color.tx3}>
              {`workspace ${shortPath(dir())}${props.fallback ? ` (mở ở ${props.fallback} nên dùng thư mục riêng)` : ""}`}
            </text>
          )}
        </Show>

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
