import { afterAll, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Cassette, REPLAY_MISS } from "../scripts/eval/cassette"
import { McpManager } from "../src/core/mcp/manager"
import { ToolRegistry } from "../src/core/tools/registry"
import { type CallStats, startHttpServer } from "./fixtures/remote-mcp"

const cleanups: (() => unknown)[] = []
afterAll(async () => {
  for (const clean of cleanups.reverse()) await clean()
})

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ot-cassette-"))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function connect(url: string, cassette?: Cassette) {
  const home = await tempDir()
  await writeFile(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: { data: { type: "http", url } } }))
  const registry = new ToolRegistry()
  const manager = new McpManager(registry, {
    home,
    cwd: home,
    trustFile: path.join(home, "trust.json"),
    retryDelaysMs: [],
    reconnectDelaysMs: [10],
    callRetryDelaysMs: [],
    transport: cassette ? (name, real) => cassette.transport(name, real) : undefined,
  })
  cleanups.push(() => manager.stop())
  await manager.start()
  return { registry, manager }
}

const ctx = { signal: new AbortController().signal, callId: "c1" }
const newStats = (): CallStats => ({ calls: 0, inFlight: 0, maxInFlight: 0, notes: 0 })

async function errorOf(run: () => unknown) {
  try {
    await run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return "(no error)"
}

test("a recording replays with the server gone, and a new request says it is missing", async () => {
  const remote = startHttpServer()
  const file = path.join(await tempDir(), "tape.jsonl")
  const recording = await connect(remote.url, await Cassette.open(file, "record"))
  expect(await recording.registry.get("mcp__data__echo")!.execute({ text: "giá" }, ctx)).toBe("giá")
  await recording.manager.stop()
  remote.stop()

  const replay = await Cassette.open(file, "replay")
  const { registry, manager } = await connect("http://127.0.0.1:9/mcp", replay)
  expect(manager.status().find((s) => s.name === "data")?.state).toBe("connected")
  expect(await registry.get("mcp__data__echo")!.execute({ text: "giá" }, ctx)).toBe("giá")
  expect(replay.misses).toBe(0)
  expect(await errorOf(() => registry.get("mcp__data__echo")!.execute({ text: "khác" }, ctx))).toContain(REPLAY_MISS)
  expect(replay.misses).toBe(1)
})

test("recording keeps the first answer: a known request never reaches the server again", async () => {
  const stats = newStats()
  const remote = startHttpServer({ stats })
  cleanups.push(() => remote.stop())
  const file = path.join(await tempDir(), "tape.jsonl")
  const first = await connect(remote.url, await Cassette.open(file, "record"))
  await first.registry.get("mcp__data__slow")!.execute({ ms: 1 }, ctx)
  await first.manager.stop()
  const second = await connect(remote.url, await Cassette.open(file, "record"))
  await second.registry.get("mcp__data__slow")!.execute({ ms: 1 }, ctx)
  expect(stats.calls).toBe(1)
  const lines = (await readFile(file, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { method: string })
  expect(lines.filter((l) => l.method === "tools/call")).toHaveLength(1)
})

test("a failed call passes through but is not kept", async () => {
  const stats = newStats()
  const remote = startHttpServer({ stats })
  cleanups.push(() => remote.stop())
  const file = path.join(await tempDir(), "tape.jsonl")
  const cassette = await Cassette.open(file, "record")
  const { registry } = await connect(remote.url, cassette)
  expect(await errorOf(() => registry.get("mcp__data__upstream_down")!.execute({}, ctx))).toContain("upstream fetch failed")
  expect(await readFile(file, "utf8")).not.toContain("tools/call")
})

test("an outage in a data envelope is not kept, a settled answer is", async () => {
  const dir = await tempDir()
  const cassette = await Cassette.open(path.join(dir, "tape.jsonl"), "record")
  const envelope = (retryable: boolean) => ({ content: [{ type: "text", text: JSON.stringify({ data: {}, availability: "unavailable", retryable }) }] })
  cassette.keep("s", "tools/call", { name: "a", arguments: {} }, envelope(true))
  cassette.keep("s", "tools/call", { name: "b", arguments: {} }, envelope(false))
  expect(cassette.get("s", "tools/call", { name: "a", arguments: {} })).toBeUndefined()
  expect(cassette.get("s", "tools/call", { name: "b", arguments: {} })).toBeDefined()
})

test("request keys ignore argument order and progress tokens", async () => {
  const cassette = await Cassette.open(path.join(await tempDir(), "tape.jsonl"), "record")
  const result = { content: [] }
  cassette.keep("s", "tools/call", { name: "a", arguments: { x: 1, y: 2 } }, result)
  expect(cassette.get("s", "tools/call", { _meta: { progressToken: 7 }, arguments: { y: 2, x: 1 }, name: "a" })).toBe(result)
})

test("replay refuses a file that does not exist", async () => {
  const file = path.join(await tempDir(), "none.jsonl")
  expect(await errorOf(() => Cassette.open(file, "replay"))).toContain("ENOENT")
})
