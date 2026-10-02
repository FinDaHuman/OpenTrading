import { expect, test } from "bun:test"
import { requestApproval, resetApprovals, setApprovalHandler, type ApprovalRequest } from "../src/core/approvals"
import { switchPresetTool } from "../src/core/runtime"
import { ToolRegistry } from "../src/core/tools/registry"

test("no handler → allow by default (headless/scripts)", async () => {
  resetApprovals()
  expect(await requestApproval({ kind: "test", title: "x" })).toBe("once")
})

test("handler decision is passed through; 'always' is cached and skips later asks", async () => {
  resetApprovals()
  const asks: ApprovalRequest[] = []
  const off = setApprovalHandler(async (req) => {
    asks.push(req)
    return asks.length === 1 ? "always" : "deny"
  })
  const req = { kind: "k", title: "t", detail: "d" }
  expect(await requestApproval(req)).toBe("always")
  expect(await requestApproval(req)).toBe("always") // cached, handler not asked again
  expect(asks.length).toBe(1)
  // different key asks again
  expect(await requestApproval({ ...req, detail: "other" })).toBe("deny")
  off()
})

test("deny passes through without caching", async () => {
  resetApprovals()
  let n = 0
  const off = setApprovalHandler(async () => {
    n++
    return "deny"
  })
  const req = { kind: "k", title: "t" }
  expect(await requestApproval(req)).toBe("deny")
  expect(await requestApproval(req)).toBe("deny")
  expect(n).toBe(2)
  off()
})

const stubMcp = (statuses: unknown[], setPreset: (name: string, preset: string) => Promise<void>) =>
  ({
    status: () => statuses,
    setPreset,
    onChange: () => () => {},
  }) as never as Parameters<typeof switchPresetTool>[1]

const registry = () => new ToolRegistry()

test("switch_preset: no live server reports it; deny answers honestly; allow switches", async () => {
  const toolOf = (statuses: unknown[], setPreset: (name: string, preset: string) => Promise<void>) => {
    const reg = registry()
    switchPresetTool(reg, stubMcp(statuses, setPreset)).register()
    return reg.get("switch_preset")!
  }

  // no server
  expect(await toolOf([], async () => {}).execute({ preset: "market" }, ctx())).toContain("Chưa có MCP server")

  resetApprovals()
  // deny
  const off = setApprovalHandler(async () => "deny")
  let switched = ""
  const denyTool = toolOf(
    [{ name: "opentrading", state: "connected", preset: "scan", tools: ["a", "b"], presetCounts: { all: 2 } }],
    async (n, p) => {
      switched = `${n}:${p}`
    },
  )
  const answer = (await denyTool.execute({ preset: "market" }, ctx())) as string
  expect(answer).toContain("không cho phép")
  expect(switched).toBe("")
  off()

  // allow once
  resetApprovals()
  let switched2 = ""
  const allowTool = toolOf(
    [{ name: "opentrading", state: "connected", preset: "scan", tools: ["mcp__opentrading__vs_financeinfo"], presetCounts: { all: 1 } }],
    async (n, p) => {
      switched2 = `${n}:${p}`
    },
  )
  const ok = (await allowTool.execute({ preset: "market" }, ctx())) as string
  expect(switched2).toBe("opentrading:market")
  expect(ok).toContain("Đã đổi preset")
  expect(ok).toContain("market")
})

const ctx = () => ({ signal: new AbortController().signal, callId: "t1" })
