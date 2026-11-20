import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Workspace } from "../src/core/fs/workspace"
import { ToolRegistry } from "../src/core/tools/registry"
import { scoreTools } from "../src/core/tools/search"
import { doctorLocalTool, sessionHistoryTools } from "../src/core/tools/session/history"
import { globFilesTool, grepFilesTool } from "../src/core/tools/fs/search"
import { sendMessageTool, stopAgentTool } from "../src/core/tools/subagent/spawn"
import { webSearchTool } from "../src/core/tools/web/search"

/** The real local tools a terminal turn defers or searches (#316, #317), not stand-ins. */
function registry() {
  const root = mkdtempSync(path.join(os.tmpdir(), "ot-search-defaults-"))
  const ws = new Workspace(root, { home: root, data: path.join(root, ".opentrading") })
  const r = new ToolRegistry()
  for (const def of [
    webSearchTool(),
    sendMessageTool({} as never),
    stopAgentTool({} as never),
    globFilesTool(ws),
    grepFilesTool(ws),
    doctorLocalTool({ mcpStatus: () => [] } as never),
    ...sessionHistoryTools(),
  ])
    r.register(def)
  return r
}

test('tool_search "tin tức" ranks web_search first, not send_message ("thông tin") (#316)', () => {
  const r = registry()
  for (const query of ["tin tức", "tin tức FPT", "thời sự", "news"]) {
    const hits = scoreTools(r, r.list(), query)
    expect(hits[0]?.def.name).toBe("web_search")
  }
})

test("glob_files and doctor_local stay visible below the defer threshold; grep, sessions, send/stop do not (#317)", () => {
  const r = registry()
  const built = r.toToolSet({ defer: "default" })
  expect(built.names).toContain("glob_files")
  expect(built.names).toContain("doctor_local")
  expect(built.names).toContain("web_search")
  for (const name of ["grep_files", "session_list", "send_message", "stop_agent"]) expect(built.deferred).toContain(name)
  // Past the threshold (defer: true) every deferrable tool still goes out by name only.
  const all = r.toToolSet({ defer: true })
  for (const name of ["glob_files", "doctor_local", "web_search"]) expect(all.deferred).toContain(name)
})
