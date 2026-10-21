import { afterAll, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

const home = await mkdtemp(path.join(os.tmpdir(), "ot-desk-tool-"))
process.env.OPENTRADING_HOME = home

const { loadConfig, saveConfig } = await import("../src/core/config")
const { DeskApprovals } = await import("../src/core/desk/approval")
const { DeskEngine } = await import("../src/core/desk/engine")
const { deskKeywordRange, deskReminder, hasDeskKeyword } = await import("../src/core/desk/keyword")
const { DESK_NOTE, deskNotification } = await import("../src/core/desk/notification")
const { deskRunTool } = await import("../src/core/desk/tool")
const { splitNotices } = await import("../src/core/subagents/notification")
type Playbook = import("../src/core/desk/types").Playbook
type DeskOptIn = import("../src/core/desk/keyword").DeskOptIn
type PermissionMode = import("../src/core/permission/mode").PermissionMode
type StartSpec = import("../src/core/subagents/manager").StartSpec
type DeskDecision = import("../src/core/desk/approval").DeskDecision

afterAll(() => rm(home, { recursive: true, force: true }))
beforeEach(async () => {
  await saveConfig({ desk: undefined })
})

const playbook: Playbook = {
  meta: {
    name: "sang-loc",
    version: "1",
    description: "Sàng lọc nhiều mã",
    whenToUse: "So sánh, xếp hạng nhiều mã",
    args: z.object({ tickers: z.array(z.string()).min(1) }),
    agentTypes: ["tra-cuu"],
    phases: ["Thu thập", "Tổng hợp"],
    estimate: (args: { tickers: string[] }, size) => ({ agents: args.tickers.length + 1, requests: (args.tickers.length + 1) * (size === "small" ? 6 : 10) }),
    summarize: (args: { tickers: string[] }) => `${args.tickers.length} mã: ${args.tickers.join(", ")}`,
  },
  run: async (ctx) => ctx.agent("x"),
}

function harness(opts: { optIn?: DeskOptIn; mode?: PermissionMode } = {}) {
  const started: StartSpec[] = []
  const engine = new DeskEngine({
    starter: { start: (spec) => (started.push(spec), { id: "ag-1", done: Promise.resolve({ status: "completed", text: "ok", toolCount: 0, usage: { input: 0, output: 0 }, requests: 1, durationMs: 1 }) }) },
    agents: () => [{ name: "tra-cuu", description: "d", tools: ["@chi-doc"], body: "", file: "", source: "bundled" }],
    playbooks: () => [playbook],
    config: async () => ({ desk: { staggerMs: 0 } }),
  })
  const approvals = new DeskApprovals()
  const asked: unknown[] = []
  approvals.onChange((head) => head && asked.push(head))
  let optIn = opts.optIn
  const tool = deskRunTool({ engine, approvals, playbooks: () => [playbook], optIn: () => optIn, mode: () => opts.mode ?? "ask" })
  const ctx = { signal: new AbortController().signal, callId: "c1" }
  const prepare = (input: { playbook: string; args: Record<string, unknown> }) => tool.prepare!(input, ctx) as Promise<DeskDecision>
  /** The card shows once prepare has loaded the config and the estimates. */
  const card = async () => {
    for (let i = 0; i < 200 && !approvals.head(); i++) await Bun.sleep(2)
    return approvals.head()
  }
  return { engine, approvals, asked, tool, ctx, started, prepare, card, setOptIn: (o?: DeskOptIn) => (optIn = o) }
}

test("keyword: a whole word, any case, never inside another word", () => {
  expect(hasDeskKeyword("ultradesk: so sánh FPT và MWG")).toBe(true)
  expect(hasDeskKeyword("Chạy ULTRADESK cho ngành thép")).toBe(true)
  expect(hasDeskKeyword("ultradesking")).toBe(false)
  expect(hasDeskKeyword("xultradesk")).toBe(false)
  expect(hasDeskKeyword("ultra desk")).toBe(false)
  expect(deskKeywordRange("hãy ultradesk nhé")).toEqual({ start: 4, end: 13 })
})

test("reminder: why the request may run playbooks, and each playbook's use", () => {
  const text = deskReminder("keyword", [playbook])
  expect(text).toContain("gõ ultradesk")
  expect(text).toContain("- sang-loc: So sánh, xếp hạng nhiều mã")
  expect(deskReminder("session", [playbook])).toContain("/desk on")
})

test("desk_run without an opt-in always shows the card, even for an approved playbook", async () => {
  await saveConfig({ desk: { approved: ["sang-loc"] } })
  const h = harness({ mode: "auto" })
  const deciding = h.prepare({ playbook: "sang-loc", args: { tickers: ["FPT", "MWG"] } })
  expect(await h.card()).toMatchObject({ playbook: "sang-loc", summary: "2 mã: FPT, MWG", reason: "no-opt-in", size: "small" })
  expect(h.approvals.head()!.estimates.medium).toEqual({ agents: 3, requests: 30 })
  h.approvals.answer({ run: false, size: "small", remember: false })
  const decision = await deciding
  expect(decision.run).toBe(false)
  expect(await h.tool.execute({ playbook: "sang-loc", args: {} }, { ...h.ctx, prepared: decision })).toContain("không cho chạy")
  expect(h.started).toHaveLength(0)
})

test("opted in and approved before: no card; opted in, first time: the card, and 'không hỏi lại' is saved", async () => {
  const h = harness({ optIn: "keyword" })
  const first = h.prepare({ playbook: "sang-loc", args: { tickers: ["FPT"] } })
  expect((await h.card())?.reason).toBe("first-time")
  h.approvals.answer({ run: true, size: "medium", effort: "high", remember: true })
  const decision = await first
  const out = await h.tool.execute({ playbook: "sang-loc", args: { tickers: ["FPT"] } }, { ...h.ctx, prepared: decision })
  expect(out).toContain("Đã bắt đầu run ultradesk dk-")
  expect(out).toContain("quy mô medium")
  expect((await loadConfig()).desk?.approved).toEqual(["sang-loc"])

  const again = await h.prepare({ playbook: "sang-loc", args: { tickers: ["HPG"] } })
  expect(again).toMatchObject({ run: true, size: "small" })
  expect(h.asked).toHaveLength(1)
})

test("▸▸ auto with an opt-in asks once per playbook: yes remembers it", async () => {
  const h = harness({ optIn: "session", mode: "auto" })
  const deciding = h.prepare({ playbook: "sang-loc", args: { tickers: ["FPT"] } })
  await h.card()
  h.approvals.answer({ run: true, size: "small", remember: false })
  expect((await deciding).remember).toBe(true)
})

test("bad playbook or args go back to the model before any card", async () => {
  const h = harness({ optIn: "keyword" })
  await expect(h.prepare({ playbook: "khong-co", args: {} })).rejects.toThrow("Không có playbook")
  await expect(h.prepare({ playbook: "sang-loc", args: { tickers: [] } })).rejects.toThrow("không hợp lệ")
  expect(h.asked).toHaveLength(0)
})

test("an aborted turn takes its card away", async () => {
  const approvals = new DeskApprovals()
  const controller = new AbortController()
  const asking = approvals.ask({ playbook: "p", description: "", phases: [], summary: "", args: {}, size: "small", estimates: {} as never, warnRequests: 150, model: "", reason: "no-opt-in" }, controller.signal)
  expect(approvals.head()?.playbook).toBe("p")
  controller.abort()
  await expect(asking).rejects.toThrow()
  expect(approvals.head()).toBeUndefined()
})

test("a stored desk notice becomes a transcript notice on resume, not user text", () => {
  const view = {
    id: "dk-abc123",
    playbook: "sang-loc",
    version: "1",
    args: {},
    size: "small" as const,
    status: "done" as const,
    phases: [],
    agents: [],
    logs: [],
    createdAt: 0,
    endedAt: 1000,
    counters: { agents: 3, cached: 0, requests: 9, input: 100, output: 10 },
    result: "Bảng xếp hạng…",
  }
  const stored = `${deskNotification(view)}\n${DESK_NOTE}\n\nCâu hỏi tiếp`
  const { notices, rest } = splitNotices(stored)
  expect(notices).toEqual([{ agentId: "dk-abc123", type: "ultradesk", description: "sang-loc", status: "xong", stats: expect.stringContaining("3 agent") }])
  expect(rest).toBe("Câu hỏi tiếp")
})
