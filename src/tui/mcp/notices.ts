import type { McpServerStatus } from "../../core/mcp/manager"
import { notify } from "../notify"
import { truncate } from "../ui/text"

/**
 * Toasts for MCP servers that change state: one that fails says so (with its error), and
 * coming back retires that toast. Servers that stay as they were say nothing.
 */
export function announceMcp(before: readonly Pick<McpServerStatus, "name" | "state">[], after: readonly Pick<McpServerStatus, "name" | "state" | "error">[]) {
  for (const s of after) {
    const was = before.find((x) => x.name === s.name)?.state
    if (s.state === was) continue
    if (s.state === "failed") {
      notify({
        key: `mcp:${s.name}`,
        level: "error",
        title: `MCP ${s.name} không kết nối được`,
        text: `${s.error ? `${truncate(s.error.split("\n")[0]!, 120)} · ` : ""}/mcp để xem`,
      })
    } else if (s.state === "connected" && was === "failed") {
      notify({ key: `mcp-ok:${s.name}`, level: "success", text: `MCP ${s.name} đã kết nối lại`, invalidates: [`mcp:${s.name}`] })
    }
  }
}
