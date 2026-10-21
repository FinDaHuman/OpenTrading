import { expect, test } from "bun:test"
import { z } from "zod"
import { type AllowRule, PermissionGate, type RuleStore } from "../src/core/permission"
import { startMode } from "../src/core/permission/mode"
import { ToolRegistry } from "../src/core/tools/registry"
import type { ToolDef } from "../src/core/tools/types"
import { RwLock, runTool } from "../src/core/tools/wrap"

function memoryStore(initial: AllowRule[] = []): RuleStore & { rules: AllowRule[] } {
  const store = {
    rules: [...initial],
    async load() {
      return store.rules
    },
    async save(rules: AllowRule[]) {
      store.rules = rules
    },
  }
  return store
}

const write = (name = "mcp__gh__create_issue", scope = "gh@abc"): ToolDef => ({
  name,
  description: "Tạo issue",
  input: z.object({}),
  readOnly: false,
  permissionScope: scope,
  displayName: "gh · create_issue",
  execute: async () => "đã tạo",
})
const ctx = (signal = new AbortController().signal) => ({ signal, callId: "c" })
const tick = () => new Promise((r) => setTimeout(r, 5))

test("read-only and approval:never tools never ask; headless denies writes", async () => {
  const gate = new PermissionGate(memoryStore())
  const signal = new AbortController().signal
  expect(await gate.check({ ...write(), readOnly: true }, {}, signal)).toEqual({ allow: true })
  expect(await gate.check({ ...write(), approval: "never" }, {}, signal)).toEqual({ allow: true })
  expect(await gate.check(write(), {}, signal)).toEqual({ allow: false, reason: "headless" })
})

test("a denied call becomes a tool error the model reads, with the user's note", async () => {
  const gate = new PermissionGate(memoryStore())
  gate.interactive = true
  const running = runTool(write(), {}, ctx(), new RwLock(), gate).catch((e: Error) => e.message)
  await tick()
  const head = gate.head()!
  expect(head.label).toBe("gh · create_issue")
  await gate.respond(head.id, "deny", "dùng repo khác")
  expect(await running).toBe("Người dùng từ chối chạy tool này. Lời nhắn của người dùng: dùng repo khác")
})

test("waiting for the user does not count against the tool timeout", async () => {
  const gate = new PermissionGate(memoryStore())
  gate.interactive = true
  const running = runTool({ ...write(), timeoutMs: 30 }, {}, ctx(), new RwLock(), gate)
  await new Promise((r) => setTimeout(r, 80)) // longer than the timeout
  await gate.respond(gate.head()!.id, "once")
  expect(await running).toEqual({ output: "đã tạo" })
})

test("parallel calls queue; 'for this session' lets the queued ones through without a second prompt", async () => {
  const gate = new PermissionGate(memoryStore())
  gate.interactive = true
  const shown: number[] = []
  gate.onChange((head) => head && shown.push(head.id))
  const lock = new RwLock()
  const a = runTool(write(), { n: 1 }, ctx(), lock, gate)
  const b = runTool(write(), { n: 2 }, ctx(), lock, gate)
  const other = runTool(write("mcp__gh__delete_repo"), {}, ctx(), lock, gate)
  await tick()
  expect(gate.head()!.input).toEqual({ n: 1 })
  await gate.respond(gate.head()!.id, "session")
  expect(await a).toEqual({ output: "đã tạo" })
  expect(await b).toEqual({ output: "đã tạo" })
  // A different tool still asks.
  expect(gate.head()!.tool).toBe("mcp__gh__delete_repo")
  expect(shown).toHaveLength(2)
  await gate.respond(gate.head()!.id, "deny")
  expect(await other.catch((e: Error) => e.message)).toContain("từ chối")
  // Later calls to the session-allowed tool run without asking.
  expect(await runTool(write(), {}, ctx(), lock, gate)).toEqual({ output: "đã tạo" })
})

test("aborting the turn denies what is waiting", async () => {
  const gate = new PermissionGate(memoryStore())
  gate.interactive = true
  const controller = new AbortController()
  const running = runTool(write(), {}, ctx(controller.signal), new RwLock(), gate).catch((e: Error) => e.message)
  await tick()
  expect(gate.head()).toBeDefined()
  controller.abort()
  expect(await running).toBe("Lời gọi tool đã bị huỷ.")
  expect(gate.head()).toBeUndefined()
})

test("'always' is saved per server identity: a different server with the same name asks again", async () => {
  const store = memoryStore()
  const gate = new PermissionGate(store)
  gate.interactive = true
  const first = runTool(write(), {}, ctx(), new RwLock(), gate)
  await tick()
  await gate.respond(gate.head()!.id, "always")
  await first
  expect(store.rules).toEqual([{ tool: "mcp__gh__create_issue", scope: "gh@abc" }])

  // New process: the saved rule applies to the same server…
  const fresh = new PermissionGate(store)
  fresh.interactive = true
  expect(await fresh.check(write(), {}, new AbortController().signal)).toEqual({ allow: true })
  // …but not to a project server that reuses the name with another URL.
  const impostor = fresh.check(write("mcp__gh__create_issue", "gh@other"), {}, new AbortController().signal)
  await tick()
  expect(fresh.head()?.tool).toBe("mcp__gh__create_issue")
  await fresh.respond(fresh.head()!.id, "deny")
  expect((await impostor).allow).toBe(false)
})

test("'always' whose save fails: the call is denied with the reason, nothing is granted, the queue moves on", async () => {
  const store = memoryStore()
  store.save = async () => {
    throw new Error("EACCES: permission denied")
  }
  const gate = new PermissionGate(store)
  gate.interactive = true
  const heads: (number | undefined)[] = []
  gate.onChange((head) => heads.push(head?.id))
  const running = runTool(write(), {}, ctx(), new RwLock(), gate).catch((e: Error) => e.message)
  await tick()
  await gate.respond(gate.head()!.id, "always")
  const message = await running
  expect(message).toContain("không lưu được quyền")
  expect(message).toContain("EACCES")
  expect(gate.head()).toBeUndefined()
  expect(heads.at(-1)).toBeUndefined()
  // No session grant was left behind: the next call asks again.
  const again = gate.check(write(), {}, new AbortController().signal)
  await tick()
  expect(gate.head()?.tool).toBe("mcp__gh__create_issue")
  await gate.respond(gate.head()!.id, "deny")
  expect((await again).allow).toBe(false)
})

test("a write cancelled while it waits for the lock never runs", async () => {
  const lock = new RwLock()
  const holder = await lock.acquire(true)
  let ran = 0
  const def: ToolDef = { ...write(), approval: "never", execute: async () => (ran++, "đã ghi") }
  const controller = new AbortController()
  const waiting = runTool(def, {}, ctx(controller.signal), lock).catch((e: Error) => e.message)
  // A reader queued behind the cancelled writer gets in once the holder leaves.
  const reader = runTool({ ...def, readOnly: true }, {}, ctx(), lock)
  await tick()
  controller.abort()
  expect(await waiting).toBe("Đã huỷ.")
  holder()
  expect(await reader).toEqual({ output: "đã ghi" })
  await tick()
  expect(ran).toBe(1) // the reader only
})

test("wildcard rules cover a whole server", async () => {
  const gate = new PermissionGate(memoryStore([{ tool: "mcp__gh__*", scope: "gh@abc" }]))
  gate.interactive = true
  expect(await gate.check(write("mcp__gh__anything"), {}, new AbortController().signal)).toEqual({ allow: true })
})

test("the registry passes its gate to every tool call", async () => {
  const registry = new ToolRegistry()
  registry.gate = new PermissionGate(memoryStore())
  registry.register(write())
  const set = registry.toToolSet().tools
  const out = await (set["mcp__gh__create_issue"] as unknown as { execute: (i: unknown, o: { toolCallId: string; messages: [] }) => Promise<unknown> })
    .execute({}, { toolCallId: "t", messages: [] })
    .catch((e: Error) => e.message)
  expect(out).toContain("không có giao diện để hỏi")
})

test("startMode: a session opens in the configured mode, but never in ▸▸ auto the user has not accepted", () => {
  expect(startMode(undefined)).toBe("read-only")
  expect(startMode({ defaultMode: "ask" })).toBe("ask")
  expect(startMode({ defaultMode: "auto" })).toBe("ask")
  expect(startMode({ defaultMode: "auto", autoAcknowledged: false })).toBe("ask")
  expect(startMode({ defaultMode: "auto", autoAcknowledged: true })).toBe("auto")
  expect(startMode({ defaultMode: "nonsense" })).toBe("read-only")
})
