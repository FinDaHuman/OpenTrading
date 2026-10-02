import { useKeyboard } from "@opentui/solid"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import type { McpManager, McpServerStatus, McpState } from "../../core/mcp/manager"
import { closeDialog, pushLine, state } from "../state"
import { color } from "../theme"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

const MARK: Record<McpState, string> = {
  connected: "●",
  connecting: "…",
  failed: "✕",
  disabled: "○",
  untrusted: "?",
  "needs-auth": "!",
}

const STATE_LABEL: Record<McpState, string> = {
  connected: "đã kết nối",
  connecting: "đang kết nối",
  failed: "lỗi",
  disabled: "đã tắt",
  untrusted: "chờ cho phép",
  "needs-auth": "cần đăng nhập",
}

function hint(s: McpServerStatus) {
  if (s.state === "connected") return `${s.scope} · ${s.transport} · ${s.tools.length} tool${s.hiddenTools ? ` (ẩn ${s.hiddenTools})` : ""}`
  if (s.state === "failed") return `${s.scope} · ${s.error ?? "lỗi"}`
  return `${s.scope} · ${STATE_LABEL[s.state]}`
}

export function McpDialog(props: { mcp: McpManager }) {
  const [open, setOpen] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const server = createMemo(() => state.mcp.find((s) => s.name === open()))

  const [loginUrl, setLoginUrl] = createSignal<string>()
  let loginAbort: AbortController | undefined

  async function act() {
    const s = server()
    if (!s || busy()) return
    setBusy(true)
    try {
      if (s.state === "untrusted") {
        await props.mcp.trust(s.name)
        pushLine({ kind: "info", text: `Đã cho phép MCP server "${s.name}" (${s.target}).` })
      } else if (s.state === "needs-auth" && s.oauth) {
        loginAbort = new AbortController()
        await props.mcp.login(s.name, { onUrl: setLoginUrl, signal: loginAbort.signal })
        pushLine({ kind: "info", text: `Đã đăng nhập MCP server "${s.name}".` })
      } else if (s.state === "failed" || s.state === "connected" || s.state === "needs-auth") {
        await props.mcp.restart(s.name)
      }
    } catch (error) {
      pushLine({ kind: "error", text: `MCP "${s.name}": ${error instanceof Error ? error.message : String(error)}` })
    } finally {
      loginAbort = undefined
      setLoginUrl(undefined)
      setBusy(false)
    }
  }

  async function logout() {
    const s = server()
    if (!s || busy() || !s.oauth) return
    setBusy(true)
    try {
      await props.mcp.logout(s.name)
      pushLine({ kind: "info", text: `Đã đăng xuất MCP server "${s.name}".` })
    } finally {
      setBusy(false)
    }
  }

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "escape") {
      if (loginAbort) return loginAbort.abort()
      return open() ? setOpen(undefined) : closeDialog()
    }
    if (open() && evt.name === "return") void act()
    if (open() && evt.name === "x" && !busy()) void logout()
  })

  return (
    <Switch>
      <Match when={state.mcp.length === 0}>
        <DialogFrame title="MCP servers" hint="esc đóng" width={76}>
          <text fg={color.tx2}>Chưa cấu hình MCP server nào.</text>
          <text fg={color.tx3} marginTop={1}>
            Thêm server vào ~/.opentrading/mcp.json (global) hoặc .mcp.json ở thư mục đang chạy (project).
          </text>
          <text fg={color.tx3}>Xem hướng dẫn: docs/mcp.md</text>
        </DialogFrame>
      </Match>
      <Match when={server()}>
        {(s) => (
          <DialogFrame
            title={`MCP · ${s().name}`}
            width={80}
            hint={
              loginUrl()
                ? "đang chờ đăng nhập trên trình duyệt… · esc huỷ"
                : busy()
                  ? "đang xử lý…"
                  : s().state === "untrusted"
                    ? "enter cho phép chạy · esc quay lại"
                    : s().state === "needs-auth" && s().oauth
                      ? "enter đăng nhập · esc quay lại"
                      : s().state === "failed" || s().state === "connected" || s().state === "needs-auth"
                        ? `enter kết nối lại${s().oauth ? " · x đăng xuất" : ""} · esc quay lại`
                        : "esc quay lại"
            }
          >
            <text>
              <span style={{ fg: color.tx3 }}>{"Trạng thái  "}</span>
              <span style={{ fg: s().state === "connected" ? color.tang : s().state === "failed" ? color.giam : color.tham }}>
                {`${MARK[s().state]} ${STATE_LABEL[s().state]}`}
              </span>
            </text>
            <text fg={color.tx2}>{`Nguồn       ${s().scope} · ${s().file}`}</text>
            <text fg={color.tx2}>{`${s().transport === "http" ? "URL         " : "Lệnh        "}${s().target}`}</text>
            <Show when={s().error}>
              <text fg={color.giam} marginTop={1} wrapMode="word">
                {s().error}
              </text>
            </Show>
            <Show when={loginUrl()}>
              <text fg={color.tham} marginTop={1} wrapMode="word">
                Đã mở trình duyệt. Nếu không thấy, mở link này:
              </text>
              <text fg={color.tx} wrapMode="char">
                {loginUrl()}
              </text>
            </Show>
            <Show when={s().state === "untrusted"}>
              <text fg={color.tham} marginTop={1} wrapMode="word">
                Server này khai báo trong .mcp.json của project. Chỉ cho phép nếu bạn tin lệnh ở trên.
              </text>
              <Show when={s().exposure.vars.length > 0}>
                <text fg={color.giam} wrapMode="word">
                  {`Sẽ gửi giá trị của ${s().exposure.vars.join(", ")} (biến môi trường hoặc secret đã lưu) tới ${s().target}.`}
                </text>
              </Show>
              <Show when={s().exposure.headers.length > 0 || s().exposure.env.length > 0}>
                <text fg={color.tx2} wrapMode="word">
                  {[
                    s().exposure.headers.length > 0 ? `Header: ${s().exposure.headers.join(", ")}` : "",
                    s().exposure.env.length > 0 ? `Biến môi trường: ${s().exposure.env.join(", ")}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </text>
              </Show>
            </Show>
            <Show when={s().tools.length > 0}>
              <text fg={color.tham} marginTop={1}>{`Tool (${s().tools.length})`}</text>
              <For each={s().tools.slice(0, 12)}>{(t) => <text fg={color.tx2}>{`  ${t}`}</text>}</For>
              <Show when={s().tools.length > 12}>
                <text fg={color.tx3}>{`  … và ${s().tools.length - 12} tool khác (xem /tools)`}</text>
              </Show>
            </Show>
          </DialogFrame>
        )}
      </Match>
      <Match when={true}>
        <DialogFrame title={`MCP servers · ${state.mcp.length}`} width={80} hint="enter xem chi tiết · esc đóng">
          <Picker
            items={state.mcp.map((s) => ({ label: s.name, hint: hint(s), mark: MARK[s.state], value: s.name }))}
            onPick={setOpen}
            rows={10}
          />
        </DialogFrame>
      </Match>
    </Switch>
  )
}
