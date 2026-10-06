import { useKeyboard, usePaste } from "@opentui/solid"
import { createSignal, Match, Switch } from "solid-js"
import { COMPANY_MCP_TEMPLATE, acceptCompanyServer, saveMcpToken } from "../../core/mcp/onboard"
import { maskKey } from "../../core/auth"
import type { McpManager } from "../../core/mcp/manager"
import { dataDir } from "../../core/paths"
import { closeDialog, pushLine, setState } from "../state"
import { color } from "../theme"
import { DialogFrame } from "./frame"

/**
 * First-run onboarding: offer the company MCP server, paste the team token once.
 * Everything lands outside the repo (mcp.json + auth.json secret), like /connect.
 */
export function McpSetupDialog(props: { mcp: McpManager }) {
  const [token, setToken] = createSignal("")
  const [saving, setSaving] = createSignal(false)

  async function save() {
    const value = token().trim()
    if (!value || saving()) return
    setSaving(true)
    try {
      const home = dataDir()
      await saveMcpToken(value, home)
      const file = await acceptCompanyServer(home)
      await props.mcp.start() // re-read config and connect the new server
      pushLine({ kind: "info", text: `Đã lưu token (${maskKey(value)}) và cấu hình server vào ${file}.` })
      closeDialog()
    } finally {
      setSaving(false)
    }
  }

  function skip() {
    pushLine({
      kind: "info",
      text: "Đã bỏ qua. Cấu hình sau: ~/.opentrading/mcp.json (hướng dẫn docs/mcp.md) hoặc chạy lại /mcp-setup.",
    })
    closeDialog()
  }

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "escape") return skip()
    if (evt.name === "return") void save()
    else if (evt.name === "backspace") setToken((t) => t.slice(0, -1))
    else if (evt.ctrl && evt.name === "u") setToken("")
    else if (!evt.ctrl && !evt.meta && evt.sequence.length === 1 && evt.sequence > " ") setToken((t) => t + evt.sequence)
  })

  usePaste((evt) => setToken((t) => t + new TextDecoder().decode(evt.bytes).replace(/\s+/g, "")))

  return (
    <DialogFrame
      title="Kết nối MCP-server công ty"
      hint={saving() ? "đang lưu…" : "dán token · enter lưu & kết nối · esc bỏ qua"}
    >
      <text fg={color.tx2}>{`Server: ${COMPANY_MCP_TEMPLATE.mcpServers.opentrading.url}`}</text>
      <text fg={color.tx2}>{"Xin TEAM_TOKEN từ admin (MCP_BEARER_TEAM). Token chỉ lưu trên máy này."}</text>
      <box
        marginTop={1}
        border
        borderStyle="rounded"
        borderColor={token() ? color.tang : color.rule}
        paddingLeft={1}
        height={3}
      >
        <text fg={token() ? color.tx : color.tx3}>
          {token() ? `${"•".repeat(Math.min(token().length, 48))}  ${token().length} ký tự` : "dán token ở đây…"}
        </text>
      </box>
      <text fg={color.tx3}>
        {"Sẽ tạo ~/.opentrading/mcp.json + lưu token vào ~/.opentrading/auth.json"}
      </text>
      <Switch>
        <Match when={saving()}>
          <text fg={color.tham} marginTop={1}>{"đang kết nối server lần đầu (cold start có thể 20-40s)…"}</text>
        </Match>
      </Switch>
    </DialogFrame>
  )
}
