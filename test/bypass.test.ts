import { expect, test } from "bun:test"
import { z } from "zod"
import type { Target } from "../src/core/chat"
import { type AllowRule, PermissionGate, type RuleStore } from "../src/core/permission"
import { AutoReviewer } from "../src/core/permission/auto"
import { cycleMode, modeNote, startMode } from "../src/core/permission/mode"
import type { ToolDef } from "../src/core/tools/types"

function store(lists: { deny?: { tool: string }[]; ask?: { tool: string }[] } = {}): RuleStore {
  let rules: AllowRule[] = []
  return {
    load: async () => rules,
    save: async (next) => {
      rules = next
    },
    lists: async () => ({ deny: lists.deny ?? [], ask: lists.ask ?? [] }),
  }
}

const signal = () => new AbortController().signal
const target: Target = { provider: { id: "groq", name: "Groq", npm: "@ai-sdk/groq", env: [], models: { m: { id: "m", name: "m" } } } as unknown as Target["provider"], model: "m", apiKey: "k" }

/** A reviewer whose classifier counts its calls: bypass must never spend one. */
function countingReviewer() {
  const calls = { n: 0 }
  const auto = new AutoReviewer({
    target: async () => target,
    config: async () => undefined,
    environment: () => [],
    classifier: {
      call: async () => {
        calls.n++
        return "<block>no</block>"
      },
    },
  })
  return { auto, calls }
}

const tool = (over: Partial<ToolDef> = {}): ToolDef => ({ name: "write_file", description: "", input: z.object({}), readOnly: false, execute: async () => "ok", ...over })
const fileWrite = tool({ effect: "file", autoReview: true, askFor: () => "edit:/w" })
const shell = tool({ name: "shell", effect: "shell", autoReview: true })
const mcpWrite = tool({ name: "mcp__gh__create_issue", permissionScope: "gh@abc" })

async function bypassGate(lists?: Parameters<typeof store>[0]) {
  const gate = new PermissionGate(store(lists))
  await gate.refreshRules()
  gate.bypassAvailable = true
  gate.setMode("bypass")
  return gate
}

test("bypass needs --yolo: setMode refuses it otherwise, and config never opens in it", () => {
  const gate = new PermissionGate(store())
  gate.setMode("bypass")
  expect(gate.mode).toBe("read-only")
  gate.bypassAvailable = true
  gate.setMode("bypass")
  expect(gate.mode).toBe("bypass")
  expect(startMode({ defaultMode: "bypass" })).toBe("read-only")
})

test("Shift+Tab reaches bypass only when the session started with --yolo", () => {
  expect(cycleMode("auto")).toBe("read-only")
  expect(cycleMode("auto", { bypass: true })).toBe("bypass")
  expect(cycleMode("bypass", { bypass: true })).toBe("read-only")
  expect(cycleMode("ask", { auto: false, bypass: true })).toBe("bypass")
  expect(modeNote("bypass")).toContain("▸▸▸ bỏ qua quyền")
})

test("bypass runs writes, shell and MCP writes headless, and never calls the classifier", async () => {
  const gate = await bypassGate()
  const { auto, calls } = countingReviewer()
  gate.auto = auto
  expect(gate.interactive).toBe(false)
  for (const def of [fileWrite, shell, mcpWrite]) expect(await gate.check(def, {}, signal())).toEqual({ allow: true })
  expect(calls.n).toBe(0)
  expect(gate.head()).toBeUndefined()
})

test("bypass still stops what it must: blocked calls, deny rules, user-only scopes, ask rules", async () => {
  const gate = await bypassGate({ deny: [{ tool: "mcp__gh__*" }], ask: [{ tool: "shell" }] })
  expect(await gate.check(tool({ blockFor: () => "ổ gốc" }), {}, signal())).toMatchObject({ allow: false, reason: "blocked" })
  expect(await gate.check(mcpWrite, {}, signal())).toMatchObject({ allow: false, reason: "rule" })
  expect(await gate.check(shell, {}, signal())).toMatchObject({ allow: false, reason: "headless" })
  for (const scope of ["secret:/w/.env", "protected:/w/.git/config", "outside:/etc", "unc://srv/share", "lap-lai"])
    expect(await gate.check(tool({ effect: "file", askFor: () => scope }), {}, signal())).toMatchObject({ allow: false, reason: "headless" })
})

test("in the TUI a user-only scope still prompts in bypass", async () => {
  const gate = await bypassGate()
  gate.interactive = true
  const pending = gate.check(tool({ effect: "file", askFor: () => "protected:/w/.opentrading/config.json" }), {}, signal())
  await new Promise((r) => setTimeout(r, 5))
  const head = gate.head()!
  expect(head.mode).toBe("bypass")
  expect(head.choices).toEqual(["once", "deny"])
  await gate.respond(head.id, "deny")
  expect(await pending).toMatchObject({ allow: false, reason: "user" })
})
