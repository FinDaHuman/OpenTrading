import { afterAll, afterEach, beforeEach, expect, setDefaultTimeout, spyOn, test } from "bun:test"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// Config, keys and sessions go to a scratch home; no request leaves the process.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-print-"))
// Not inside the home: a folder under OpenTrading's data dir becomes its own workspace.
const work = await mkdtemp(path.join(os.tmpdir(), "ot-print-work-"))
const savedHome = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home
process.env.OPENTRADING_RETRY_SCALE = "0"
setDefaultTimeout(20_000)
for (const env of ["GROQ_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "NVIDIA_API_KEY"]) delete process.env[env]

const model = (id: string) => ({ id, name: id, tool_call: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 131072, output: 8000 } })
const CATALOG = { groq: { id: "groq", name: "Groq", env: ["GROQ_API_KEY"], npm: "@ai-sdk/groq", models: { m: model("m"), other: model("other") } } }

/** Each model request takes the next scripted reply: a tool call or a text answer. */
type Reply = { text: string } | { tool: string; args: object }
let replies: Reply[] = []
const seen: { model: string }[] = []
const chunk = (delta: object, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  if (url.endsWith("/chat/completions")) {
    seen.push({ model: JSON.parse(String(init?.body)).model })
    const reply = replies.shift() ?? { text: "Xong." }
    const body =
      "tool" in reply
        ? chunk({ role: "assistant", tool_calls: [{ index: 0, id: `t${seen.length}`, type: "function", function: { name: reply.tool, arguments: JSON.stringify(reply.args) } }] }) + chunk({}, "tool_calls")
        : chunk({ role: "assistant", content: "" }) + chunk({ content: reply.text }) + chunk({}, "stop")
    return new Response(`${body}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
  }
  throw new Error(`no network in tests: ${url}`)
}) as typeof fetch

const { parseCli } = await import("../src/cli/args")
const { runPrint } = await import("../src/cli/print")
const { initRuntime, createMemory } = await import("../src/core/runtime")
const { saveConfig } = await import("../src/core/config")
const { setKey } = await import("../src/core/auth")

let out: string[] = []
let errOut: string[] = []
const restores: (() => void)[] = []

beforeEach(async () => {
  await saveConfig({ provider: "groq", model: "m", update: { check: false }, mcp: { servers: {} } } as never)
  await setKey("groq", "gsk_test_1234567890abcdefgh")
  replies = []
  seen.length = 0
  out = []
  errOut = []
  const o = spyOn(process.stdout, "write").mockImplementation(((s: string, done?: () => void) => (out.push(String(s)), done?.(), true)) as never)
  const e = spyOn(process.stderr, "write").mockImplementation(((s: string) => (errOut.push(String(s)), true)) as never)
  restores.push(() => o.mockRestore(), () => e.mockRestore())
})
afterEach(() => {
  for (const r of restores.splice(0)) r()
})
afterAll(async () => {
  globalThis.fetch = realFetch
  if (savedHome === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = savedHome
  await rm(home, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
})

const runtime = () => initRuntime({ home, cwd: work, skills: () => [], memory: createMemory("off" as never), scratchpad: false })

test("parseCli: -p takes the question, flags in any order; stdin when it is missing or '-'", () => {
  expect(parseCli(["-p", "Giá FPT?", "--yolo", "--output-format", "json", "--model", "openrouter/deepseek/x"])).toEqual({
    kind: "print",
    prompt: "Giá FPT?",
    yolo: true,
    format: "json",
    model: "openrouter/deepseek/x",
  })
  expect(parseCli(["./work", "-p"])).toEqual({ kind: "print", dir: "./work", format: "text" })
  expect(parseCli(["-p", "-", "--yolo"])).toEqual({ kind: "print", format: "text", yolo: true })
  expect(parseCli(["-p", "x", "--output-format", "xml"]).kind).toBe("error")
  expect(parseCli(["-p", "x", "--model", "m"]).kind).toBe("error")
  expect(parseCli(["-p", "x", "-c"]).kind).toBe("error")
  expect(parseCli(["--model", "groq/m"]).kind).toBe("error")
})

test("text: stdout is only the answer, exit 0, and the turn is saved as a session", async () => {
  replies = [{ text: "FPT đóng cửa 120.000 đ." }]
  const code = await runPrint({ prompt: "Giá FPT?", format: "text" }, { runtime: runtime() })
  expect(code).toBe(0)
  expect(out.join("")).toBe("FPT đóng cửa 120.000 đ.\n")
  expect(errOut.join("")).not.toContain("bỏ qua quyền")
})

test("json --yolo: a write runs with no prompt and no classifier request; the result says so", async () => {
  replies = [{ tool: "write_file", args: { path: "note.md", content: "# FPT\n" } }, { text: "Đã ghi note.md." }]
  const rt = runtime()
  const code = await runPrint({ prompt: "Ghi note.md", format: "json", yolo: true, model: "groq/other" }, { runtime: rt })
  const result = JSON.parse(out.join(""))
  expect(code).toBe(0)
  expect(readFileSync(path.join(work, "note.md"), "utf8")).toBe("# FPT\n")
  expect(result).toMatchObject({ type: "result", answer: "Đã ghi note.md.", outcome: "completed", unanswered: false, provider: "groq", model: "other", permission_mode: "bypass", requests: 2, errors: [] })
  // Only the two turn requests, both to the model asked for: no reviewer, no title request.
  expect(seen.map((s) => s.model)).toEqual(["other", "other"])
  expect(existsSync(result.session_file)).toBe(true)
  expect(readFileSync(result.session_file, "utf8")).toContain("Ghi note.md")
  expect(errOut.join("")).toContain("▸▸▸ bỏ qua quyền (--yolo)")
})

test("without --yolo the same write is refused (nobody can approve) and the file is not written", async () => {
  replies = [{ tool: "write_file", args: { path: "refused.md", content: "x\n" } }, { text: "Không ghi được." }]
  const code = await runPrint({ prompt: "Ghi refused.md", format: "json" }, { runtime: runtime() })
  expect(code).toBe(0)
  expect(existsSync(path.join(work, "refused.md"))).toBe(false)
  expect(JSON.parse(out.join("")).permission_mode).toBe("read-only")
})

test("--yolo still refuses what bypass keeps for the user: a write into .git", async () => {
  replies = [{ tool: "write_file", args: { path: ".git/hooks/pre-commit", content: "x\n" } }, { text: "Bị từ chối." }]
  await runPrint({ prompt: "Ghi hook", format: "json", yolo: true }, { runtime: runtime() })
  expect(existsSync(path.join(work, ".git", "hooks", "pre-commit"))).toBe(false)
  // Refused by the gate (nobody to ask), not failed for some other reason.
  expect(readFileSync(JSON.parse(out.join("")).session_file, "utf8")).toContain("không có giao diện để hỏi")
})

test("--yolo never starts an untrusted project .mcp.json server", async () => {
  const marker = path.join(work, "spawned.txt")
  writeFileSync(path.join(work, ".mcp.json"), JSON.stringify({ mcpServers: { repo: { command: process.execPath, args: ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`] } } }))
  try {
    replies = [{ text: "Xong." }]
    const rt = runtime()
    await runPrint({ prompt: "Chào", format: "json", yolo: true }, { runtime: rt })
    expect(rt.mcp.status().find((s) => s.name === "repo")?.state).toBe("untrusted")
    expect(existsSync(marker)).toBe(false)
  } finally {
    rmSync(path.join(work, ".mcp.json"), { force: true })
  }
})

test("no question (empty stdin): exit 1 before any request", async () => {
  expect(await runPrint({ format: "text" }, { runtime: runtime(), stdin: async () => "  " })).toBe(1)
  expect(seen).toHaveLength(0)
  expect(errOut.join("")).toContain("Thiếu câu hỏi")
})

test("question from stdin; a provider error is exit 1 and listed in errors", async () => {
  replies = []
  const failing = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith("/chat/completions")) return new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401, headers: { "content-type": "application/json" } })
    return failing(input, init)
  }) as typeof fetch
  try {
    const code = await runPrint({ format: "json" }, { runtime: runtime(), stdin: async () => "Giá FPT?" })
    expect(code).toBe(1)
    const result = JSON.parse(out.join(""))
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.answer).toBe("")
  } finally {
    globalThis.fetch = failing
  }
})
