import { afterAll, afterEach, beforeAll, expect } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { testRender } from "@opentui/solid"
import { realClock } from "./clock"
import { until } from "./tui"

/**
 * The whole app for the tui-*.test.tsx files (#348, split from tui.test.tsx): a fresh home and working
 * directory, a fake model behind fetch, the bundled MCP demo, and the App rendered once in beforeAll.
 * Each file calls `tuiApp()` once at the top: it registers its own beforeAll/afterEach/afterAll, so a file
 * runs alone and leaves nothing for the next one (sessions, the transcript, fetch, OPENTRADING_HOME).
 * The tests of one file still share that app, in order, as before the split.
 */
export type TuiSetup = Awaited<ReturnType<typeof testRender>>

export async function tuiApp(opts: { connected?: boolean } = {}) {
  // Isolate state from the real ~/.opentrading before any core module loads.
  const home = await mkdtemp(path.join(os.tmpdir(), "opentrading-test-"))
  const savedHome = process.env.OPENTRADING_HOME
  process.env.OPENTRADING_HOME = home
  // Retries do not sleep in tests (retry.ts scales every wait).
  process.env.OPENTRADING_RETRY_SCALE = "0"
  for (const env of ["GROQ_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "NVIDIA_API_KEY"])
    delete process.env[env]

  // A tiny models.dev-shaped catalog: two supported providers and one that must stay hidden.
  /**
   * How long a wait for a frame or a state keeps trying. 5 s was too short on the busy Windows runner
   * (#341: a correct approval flow failed at 5.5 s); under the 20 s test timeout, so a wait that never
   * succeeds still fails on its own condition rather than on the test's timeout.
   */
  const PATIENCE_MS = 15_000
  const text = { input: ["text"], output: ["text"] }
  const CATALOG = {
    groq: {
      id: "groq",
      name: "Groq",
      env: ["GROQ_API_KEY"],
      npm: "@ai-sdk/groq",
      models: {
        "test-model": { id: "test-model", name: "Test Model", modalities: text, limit: { context: 131072 } },
        "whisper-x": { id: "whisper-x", name: "Whisper X", modalities: { input: ["audio"], output: ["text"] } },
        "vision-model": { id: "vision-model", name: "Vision Model", modalities: { input: ["text", "image"], output: ["text"] }, limit: { context: 131072 } },
      },
    },
    nvidia: {
      id: "nvidia",
      name: "Nvidia",
      env: ["NVIDIA_API_KEY"],
      npm: "@ai-sdk/openai-compatible",
      api: "https://integrate.api.nvidia.com/v1",
      models: { "nv/model": { id: "nv/model", name: "NV Chat Model", modalities: text } },
    },
    azure: {
      id: "azure",
      name: "Azure Hidden",
      env: ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"],
      npm: "@ai-sdk/azure",
      models: {},
    },
  }

  // Fake endpoints so no test ever reaches the network.
  const LONG =
    "Dòng này rất dài để kiểm tra việc xuống dòng: " + "thanh khoản ".repeat(14) + "điểm-cuối-dòng-dài"
  const REPLY = ["Xin chào! ", "T+2.5 là chu kỳ thanh toán.\n\n", LONG, "\n\nHẾT-CÂU-TRẢ-LỜI"]
  const realFetch = globalThis.fetch
  const chatCalls: string[] = []
  /** Bodies of streamed chat requests, newest last. */
  const chatBodies: { messages: { role: string; content?: unknown }[] }[] = []
  const ASK_ONE = {
    questions: [
      {
        header: "Khung TG",
        question: "Bạn đầu tư trong bao lâu?",
        options: [
          { label: "Dưới 1 năm", description: "Lướt sóng, ưu tiên thanh khoản" },
          { label: "1–3 năm" },
          { label: "Trên 3 năm", description: "Tích sản dài hạn" },
        ],
      },
    ],
  }
  const ASK_MANY = {
    questions: [
      ASK_ONE.questions[0],
      {
        header: "Ngành",
        question: "Bạn quan tâm ngành nào?",
        multiSelect: true,
        options: [{ label: "Ngân hàng" }, { label: "Thép" }, { label: "Bất động sản" }],
      },
    ],
  }
  /** A model that copies harness tags (13/11, loop/markup.ts): none of it may reach the screen. */
  const MARKUP_REPLY =
    'Mở đầu.\n<nhac_nho>\nBÍ-MẬT-NHẮC-VIỆC\n</nhac_nho>\n<todo_write>{"todos":[]}</todo_write>\nHPG-ĐÃ-XONG, xem `<bat_bien>` trong code.'

  /**
   * The fake model's switches, set by the tests. One object so a test file can set them (an imported
   * binding cannot be assigned).
   */
  const mock = {
    /** Holds the answer of an "ĐẾM-TOKEN" turn (after its tool step) while set. */
    usageGate: undefined as Promise<void> | undefined,
    /** Holds the (non-streamed) summary request open while set. */
    summaryGate: undefined as Promise<void> | undefined,
    /** Set by the esc-while-streaming test: "CHẬM" makes the fake model call the slow tool. */
    callSlowTool: false,
    /** "QUÁ-TẢI" requests fail with 503 this many times before answering. */
    overloaded: 0,
    /** "TRÀN-NGỮ-CẢNH" requests fail as too long for the model this many times. */
    overflowing: 0,
    /** Requests of the "DẠO-ĐẦU" turn after its tool result (the first one writes nothing). */
    preambleAfterTool: 0,
    /** Subagent requests wait for this before answering (their rows stay "running"). */
    childGate: undefined as Promise<void> | undefined,
    /** A "CON-DOC" subagent waits for this after its first tool (between two model steps). */
    childAfterTool: undefined as Promise<void> | undefined,
    /** Times the app asked to exit (the real exit is replaced in tests). */
    exits: 0,
  }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const auth = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("authorization")
    // In-process test servers (MCP over HTTP) are real.
    if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init)
    if (url.endsWith("/api.json")) return Response.json(CATALOG)
    if (auth?.includes("bad")) return Response.json({ error: { message: "Invalid API Key" } }, { status: 401 })
    if (url.endsWith("/chat/completions")) {
      chatCalls.push(url)
      const chunk = (delta: object, finish: string | null = null) =>
        `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
      const request = JSON.parse(String(init?.body)) as { messages: { role: string; content?: unknown }[]; stream?: boolean }
      // generateText (the /compact summary) does not stream.
      if (!request.stream) {
        await mock.summaryGate
        return Response.json({
          id: "c1",
          object: "chat.completion",
          created: 1,
          model: "m",
          choices: [{ index: 0, message: { role: "assistant", content: "## Yêu cầu của người dùng\nTÓM-TẮT-GIẢ" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        })
      }
      chatBodies.push(request)
      const last = JSON.stringify(request.messages.at(-1)?.content ?? "")
      const sseOf = (text: string) => new Response(text, { headers: { "content-type": "text/event-stream" } })
      // A subagent's request: its system prompt carries <subagent>.
      if (String(request.messages[0]?.content ?? "").includes("<subagent>")) {
        // Held requests still end when the subagent is stopped.
        await Promise.race([
          mock.childGate,
          new Promise<void>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
        ])
        const childHasResult = request.messages.some((m) => m.role === "tool")
        if (JSON.stringify(request.messages).includes("CON-DOC")) {
          if (!childHasResult) {
            const call = { index: 0, id: "call_child_read", type: "function", function: { name: "current_time", arguments: "{}" } }
            return sseOf(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
          }
          await mock.childAfterTool
        }
        if (JSON.stringify(request.messages).includes("CON-GHI") && !childHasResult) {
          const call = { index: 0, id: "call_child_write", type: "function", function: { name: "ghi_tam", arguments: '{"ma":"FPT"}' } }
          return sseOf(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
        }
        return sseOf(chunk({ role: "assistant", content: "BÁO-CÁO-CON: FPT ổn." }) + chunk({}, "stop") + "data: [DONE]\n\n")
      }
      // "MẤY-GIỜ" asks for a tool call until a tool result is in the conversation.
      // Only tool results of the current turn count (earlier turns left their own in history).
      const lastUser = request.messages.map((m) => m.role).lastIndexOf("user")
      const answeredThisTurn = request.messages.slice(lastUser).some((m) => m.role === "tool")
      if (mock.callSlowTool && last.includes("CHẬM") && !answeredThisTurn) {
        const call = { index: 0, id: "call_slow", type: "function", function: { name: "cho_lau", arguments: "{}" } }
        return new Response(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        })
      }
      const ask = last.includes("HỎI-NHIỀU") ? ASK_MANY : last.includes("HỎI-TÔI") ? ASK_ONE : undefined
      if (ask && !answeredThisTurn) {
        const call = { index: 0, id: "call_ask", type: "function", function: { name: "ask_user", arguments: JSON.stringify(ask) } }
        return new Response(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        })
      }
      // The todo test keeps its turn running (slow tool) right after the list is saved.
      if (mock.callSlowTool && last.includes("[todo_write] Saved")) {
        const call = { index: 0, id: "call_slow", type: "function", function: { name: "cho_lau", arguments: "{}" } }
        return new Response(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        })
      }
      if (last.includes("VIỆC-CẦN-LÀM") && !answeredThisTurn) {
        const todos = [
          { content: "Lấy giá 30 phiên FPT", status: "completed" },
          { content: "Lấy BCTC 4 quý", status: "in_progress" },
          { content: "So sánh với ngành", status: "pending" },
        ]
        const call = { index: 0, id: "call_todo", type: "function", function: { name: "todo_write", arguments: JSON.stringify({ todos }) } }
        return new Response(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        })
      }
      if (last.includes("GHI-CHÚ") && !answeredThisTurn) {
        const call = { index: 0, id: "call_note", type: "function", function: { name: "mcp__demo__ghi_chu", arguments: '{"noi_dung":"mua VCB khi về 85"}' } }
        return new Response(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        })
      }
      if (last.includes("SUBAGENT-") && !answeredThisTurn) {
        const background = last.includes("SUBAGENT-NEN")
        const tasks = last.includes("SUBAGENT-GHI") ? [["Ghi FPT", "CON-GHI"]] : last.includes("SUBAGENT-DOC") ? [["Đọc FPT", "CON-DOC"]] : background ? [["Nền FPT", "FPT"]] : [["Định giá FPT", "FPT"], ["Định giá CMG", "CMG"]]
        const calls = tasks.map(([description, prompt], index) => ({
          index,
          id: `call_sub_${index}_${chatBodies.length}`,
          type: "function",
          function: { name: "spawn_subagent", arguments: JSON.stringify({ description, task: prompt, purpose: "trả lời", questions: [prompt], output: "ngắn", ...(background ? { run_in_background: true } : {}) }) },
        }))
        return sseOf(chunk({ role: "assistant", tool_calls: calls }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
      }
      // "LẶP-LẠI" repeats the same current_time call until 3 results are in (the loop guard asks on the 3rd).
      const loopAt = request.messages.findLastIndex((m) => m.role === "user" && JSON.stringify(m.content ?? "").includes("LẶP-LẠI"))
      if (loopAt >= 0 && request.messages.slice(loopAt).filter((m) => m.role === "tool").length < 3) {
        const call = { index: 0, id: `call_loop_${chatBodies.length}`, type: "function", function: { name: "current_time", arguments: "{}" } }
        return sseOf(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
      }
      // "TRÀN-SAU-TOOL": calls current_time, then the request carrying its result is too long.
      if (last.includes("TRÀN-SAU-TOOL") && !answeredThisTurn) {
        const call = { index: 0, id: "call_before_overflow", type: "function", function: { name: "current_time", arguments: "{}" } }
        return sseOf(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
      }
      if (JSON.stringify(request.messages.slice(lastUser)).includes("TRÀN-SAU-TOOL") && mock.overflowing > 0) {
        mock.overflowing--
        return Response.json({ error: { message: "prompt is too long: 210000 tokens > 200000 maximum" } }, { status: 400 })
      }
      if (last.includes("TRÀN-NGỮ-CẢNH") && mock.overflowing > 0) {
        mock.overflowing--
        return Response.json({ error: { message: "prompt is too long: 210000 tokens > 200000 maximum" } }, { status: 400 })
      }
      if (last.includes("QUÁ-TẢI") && mock.overloaded > 0) {
        mock.overloaded--
        return Response.json({ error: { message: "overloaded" } }, { status: 503 })
      }
      // "ĐẾM-TOKEN": a tool step that reports usage, then the answer waits for mock.usageGate.
      if (JSON.stringify(request.messages.slice(lastUser)).includes("ĐẾM-TOKEN")) {
        if (!answeredThisTurn) {
          const call = { index: 0, id: "call_count", type: "function", function: { name: "current_time", arguments: "{}" } }
          const usage = `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [], usage: { prompt_tokens: 50_000, completion_tokens: 10 } })}\n\n`
          return sseOf(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + usage + "data: [DONE]\n\n")
        }
        await mock.usageGate
      }
      // "HỨA-GIỜ": a bare promise; after the stop gate's reminder (joined onto the same user message), the clock.
      if (last.includes("HỨA-GIỜ") && !answeredThisTurn) {
        if (!last.includes("without any tool call")) return sseOf(chunk({ role: "assistant", content: "Mình sẽ lấy giờ hiện tại:" }) + chunk({}, "stop") + "data: [DONE]\n\n")
        const call = { index: 0, id: "call_promised", type: "function", function: { name: "current_time", arguments: "{}" } }
        return sseOf(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
      }
      // "DẠO-ĐẦU": a preamble beside the clock call, then a step that writes nothing; reminded, the answer.
      const preambleAt = request.messages.findLastIndex((m) => m.role === "user" && JSON.stringify(m.content ?? "").includes("DẠO-ĐẦU"))
      const preambleTurn = preambleAt >= 0 && request.messages.slice(preambleAt + 1).every((m) => m.role !== "user" || JSON.stringify(m.content ?? "").includes("<nhac_nho>"))
      // Counted by request, not by the reminder's wording: the first after the tool writes nothing.
      if (preambleTurn) {
        if (!request.messages.slice(preambleAt).some((m) => m.role === "tool")) {
          mock.preambleAfterTool = 0
          const call = { index: 0, id: "call_preamble", type: "function", function: { name: "current_time", arguments: "{}" } }
          return sseOf(chunk({ role: "assistant", content: "Mình sẽ xem giờ trước, LỜI-DẠO-ĐẦU." }) + chunk({ tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
        }
        if (mock.preambleAfterTool++ === 0) return sseOf(chunk({ role: "assistant", content: "" }) + chunk({}, "stop") + "data: [DONE]\n\n")
        return sseOf(chunk({ role: "assistant", content: "Bây giờ là 10:00. HẾT-CÂU-TRẢ-LỜI" }) + chunk({}, "stop") + "data: [DONE]\n\n")
      }
      // "NHÁP-TODO": the clock, then a draft beside a closing todo_write (08/11), then, reminded, the answer.
      const draftAt = request.messages.findLastIndex((m) => m.role === "user" && JSON.stringify(m.content ?? "").includes("NHÁP-TODO"))
      const draftTurn = draftAt >= 0 && request.messages.slice(draftAt + 1).every((m) => m.role !== "user" || JSON.stringify(m.content ?? "").includes("<nhac_nho>"))
      if (draftTurn && !last.includes("have not written the answer")) {
        const sent = JSON.stringify(request.messages.slice(draftAt))
        if (!sent.includes("call_draft_clock")) {
          const call = { index: 0, id: "call_draft_clock", type: "function", function: { name: "current_time", arguments: "{}" } }
          return sseOf(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
        }
        if (!sent.includes("call_draft_todo")) {
          const { DRAFT } = await import("../fixtures/draft-answer")
          const todos = [{ content: "Lấy dữ liệu", status: "completed" }]
          const call = { index: 0, id: "call_draft_todo", type: "function", function: { name: "todo_write", arguments: JSON.stringify({ todos }) } }
          return sseOf(chunk({ role: "assistant", content: DRAFT }) + chunk({ tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
        }
      }
      if (last.includes("MẤY-GIỜ") && !request.messages.some((m) => m.role === "tool")) {
        const call = { index: 0, id: "call_1", type: "function", function: { name: "current_time", arguments: "{}" } }
        return new Response(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        })
      }
      // "NHIỀU-MẨU": an answer in 60 tiny deltas. "MARKUP-GIẢ": harness markup around the answer, 3 characters per delta.
      const parts = last.includes("NHIỀU-MẨU")
        ? Array.from({ length: 60 }, (_, i) => `m${i} `).concat("HẾT-CÂU-TRẢ-LỜI")
        : last.includes("MARKUP-GIẢ")
          ? (MARKUP_REPLY.match(/[\s\S]{1,3}/g) ?? [])
          : REPLY
      const body =
        chunk({ role: "assistant", content: "" }) +
        parts.map((content) => chunk({ content })).join("") +
        chunk({}, "stop") +
        "data: [DONE]\n\n"
      return new Response(body, { headers: { "content-type": "text/event-stream" } })
    }
    throw new Error(`unexpected fetch in test: ${url}`)
  }) as typeof fetch

  // A global MCP server (the bundled demo) and an empty working directory for project config.
  const cwd = await mkdtemp(path.join(os.tmpdir(), "opentrading-cwd-"))
  const DEMO = path.resolve(import.meta.dir, "../../examples/mcp-demo/server.ts")
  await writeFile(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: { demo: { command: process.execPath, args: [DEMO] } } }))

  const { App, idleTimerForTests } = await import("../../src/tui/app")
  const { state, setState } = await import("../../src/tui/state")
  const { LOADED_PREFIX } = await import("../../src/core/tools/search")
  const { SOURCE_FAILED_PREFIX } = await import("../../src/core/tools/outcome")
  const { resetNotifications, say } = await import("../../src/tui/notify")
  const { reconcile, unwrap } = await import("solid-js/store")
  const { readJson } = await import("../../src/core/store")
  const { setKey } = await import("../../src/core/auth")
  const { loadConfig, saveConfig } = await import("../../src/core/config")
  const { initRuntime } = await import("../../src/core/runtime")
  const { NoopMemory } = await import("../../src/core/memory/types")

  const memory = new NoopMemory()
  /** What copy-on-select sent over OSC52 (the renderer's method is replaced in beforeAll). */
  const osc52: string[] = []
  /** What it handed to the OS clipboard command (stubbed; CI never runs powershell). */
  const copied: string[] = []
  const { setClipboardSpawn } = await import("../../src/tui/clipboard")
  const { currentSession, startSession } = await import("../../src/tui/session")
  setClipboardSpawn(async (_command, text) => {
    copied.push(text)
    return true
  })
  const runtime = initRuntime({ cwd, home, skills: () => state.skills, memory })
  let setup: Awaited<ReturnType<typeof testRender>>

  beforeAll(async () => {
    // Test files share one process and one store: start from an empty transcript whatever ran before.
    setState({ lines: [], approval: undefined, approvals: [], dialog: undefined })
    // And on a fresh session: the current one is module state, and may belong to a file (or an earlier
    // run of this one) whose home is gone ("Không tìm thấy phiên" on /save).
    await startSession(runtime, "startup")
    // Most files start where tui-start.test.tsx gets with /connect and /model: both providers connected,
    // nvidia's chat model the current one. Written before the app starts, which reads them.
    if (opts.connected) {
      await setKey("groq", "gsk_test_1234567890abcd") // gitleaks:allow (fake key)
      await setKey("nvidia", "nvapi-test-0987654321") // gitleaks:allow (fake key)
      await saveConfig({ provider: "nvidia", model: "nv/model" })
    }
    // exitOnCtrlC off, as in main.tsx: the app handles Ctrl+C (double press) itself.
    setup = await testRender(() => <App runtime={runtime} onExit={() => mock.exits++} />, { width: 100, height: 32, exitOnCtrlC: false })
    // waitFor/waitForFrame count frames and give up once the renderer idles. The app draws on
    // demand in a chat (the background holds still there), so keep the frame clock ticking.
    setup.renderer.requestLive()
    // OpenTUI's waitFor/waitForFrame give up after 20 frames (~0.33 s), whatever the test timeout says.
    // With every CPU busy the app is correct but late: a streamed answer reached the screen after more
    // than 20 frames. In this file both keep their own behaviour but try again until PATIENCE_MS have passed.
    const patient = <A extends unknown[], R>(wait: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        const end = Date.now() + PATIENCE_MS
        for (;;) {
          try {
            return await wait(...args)
          } catch (error) {
            if (Date.now() > end || !String(error).includes("Timed out waiting")) throw error
          }
        }
      }
    setup.waitForFrame = patient(setup.waitForFrame)
    setup.waitFor = patient(setup.waitFor)
    // The app sets the provider catalog at the end of its startup reads (skills first): about 0.1 s
    // alone, seconds with every CPU busy. /connect and /model list nothing before it.
    await until(() => Object.keys(state.catalog).length > 0, 15_000, "the app's startup reads")
    // OSC52 always carries the copy (the OS command may not exist, e.g. on CI without xclip).
    setup.renderer.copyToClipboardOSC52 = (text: string) => {
      osc52.push(text)
      return true
    }
  })

  // Tests share one app. If a test fails with a dialog open, close it so the failure does not
  // cascade into every later test typing into that dialog.
  afterEach(() => {
    realClock()
    if (state.dialog) setState("dialog", undefined)
    // An opt-in or trust dialog left open would keep every later prompt blocked.
    if (state.autoOptIn) setState("autoOptIn", undefined)
    if (state.folderTrust) setState("folderTrust", undefined)
    // A notification left by one test must not hide a footer hint the next one waits for.
    resetNotifications()
  })

  /**
   * Run a slash command. Resolves to the transcript line it added, or — for confirmations and
   * command errors, which go to the footer — `{ kind: "notice", level, text }`.
   */
  async function command(cmd: string): Promise<{ kind: string; text: string; level?: string }> {
    resetNotifications()
    const before = state.lines.length
    await setup.mockInput.typeText(cmd)
    setup.mockInput.pressEnter()
    await setup.waitFor(() => state.lines.length > before || state.notification !== undefined)
    if (state.lines.length > before) return state.lines.at(-1) as { kind: string; text: string }
    return { kind: "notice", level: state.notification!.level, text: state.notification!.text }
  }

  afterAll(async () => {
    // The next test file (bun test without --parallel) must not start on this file's session.
    await startSession(runtime, "clear")
    await runtime.mcp.stop()
    setup.renderer.destroy()
    await rm(cwd, { recursive: true, force: true })
    globalThis.fetch = realFetch
    await rm(home, { recursive: true, force: true })
    if (savedHome === undefined) delete process.env.OPENTRADING_HOME
    else process.env.OPENTRADING_HOME = savedHome
  })

  const show = (frame: string) => process.env.SHOW_FRAME && console.log(frame)

  async function connect(filter: string, key: string) {
    await setup.mockInput.typeText("/connect")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => f.includes("Kết nối provider"))
    await setup.mockInput.typeText(filter)
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => f.includes("API key ·"))
    await setup.mockInput.pasteBracketedText(key)
    await setup.waitForFrame((f) => f.includes(`${key.length} ký tự`))
    setup.mockInput.pressEnter()
    await setup.waitFor(() => state.dialog === "model")
  }

  /**
   * Ends the "press Ctrl+C/Ctrl+D again to exit" window at once, so the next key starts afresh. Only the
   * test of the window itself waits it out (800 ms, EXIT_WINDOW_MS); five more 900 ms sleeps sat on the
   * slowest file of the suite.
   */
  const disarmExit = () => setState("exitArmed", undefined)

  const waitMcp = async (pred: () => boolean, what = pred.toString()) => {
    // Spawning or stopping the server takes real time, so poll the clock instead of render passes.
    for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 100))
    expect({ what, ok: pred(), mcp: pred() ? undefined : state.mcp.map((s) => `${s.name}:${s.state}:${s.error ?? ""}`) }).toEqual({ what, ok: true, mcp: undefined })
  }

  /** Assistant texts of the last turn: on screen (from its user line) and in history (from its user message). */
  function lastTurnAnswers(prompt: string) {
    const from = state.lines.findLastIndex((l) => l.kind === "user" && l.text === prompt)
    const shown = state.lines.slice(from).flatMap((l) => (l.kind === "assistant" && l.text.trim() ? [l.text.trim()] : []))
    const at = state.history.findLastIndex((m) => m.role === "user")
    const stored = state.history.slice(at).flatMap((m) => {
      if (m.role !== "assistant") return []
      const text = typeof m.content === "string" ? m.content : m.content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("")
      return text.trim() ? [text.trim()] : []
    })
    return { shown, stored }
  }

  /** Waits until the turn of `prompt` has ended with the mock's answer on screen, and returns that frame. */
  async function turnEnded(prompt: string) {
    await setup.waitFor(() => {
      const from = state.lines.findLastIndex((l) => l.kind === "user" && l.text === prompt)
      return from >= 0 && !state.streaming && state.lines.slice(from).some((l) => l.kind === "assistant" && l.text.includes("HẾT-CÂU-TRẢ-LỜI"))
    })
    // The answer under this turn's prompt (an earlier answer above it does not count), streaming done.
    return setup.waitForFrame((f) => {
      const at = f.lastIndexOf(`❯ ${prompt}`)
      return at >= 0 && f.slice(at).includes("HẾT-CÂU-TRẢ-LỜI") && !f.includes("đang trả lời")
    })
  }

  /**
   * A question is open, then drawn. State first: right after the previous turn a frame can still
   * show the last (identical) question, and a key sent then reaches nobody (flaky under load).
   */
  async function questionShown(text = "Câu hỏi cho bạn") {
    await setup.waitFor(() => state.question !== undefined)
    return setup.waitForFrame((f) => f.includes(text))
  }

  /** A failed ask test must not leave its question open for the tests after it. */
  function closeQuestions() {
    if (state.question) runtime.questions.cancelAll()
  }

  /** The prompt's text rows: the "› " row and the wrapped rows under it, up to the bottom border. */
  function promptRows(frame: string) {
    const rows = frame.split("\n")
    const start = rows.findLastIndex((r) => r.includes("› "))
    if (start < 0) return []
    const out: string[] = []
    for (let i = start; i < rows.length && !rows[i]!.includes("──"); i++) out.push(rows[i]!.slice(0, 96).slice(rows[start]!.indexOf("› ") + 2).trimEnd())
    return out
  }

  /** The prompt's text once rendering has settled (a late second insertion would show by then). */
  async function settledPrompt() {
    await new Promise((r) => setTimeout(r, 60))
    await setup.renderOnce()
    return promptRows(setup.captureCharFrame()).join("").trim()
  }

  /** Esc twice clears the prompt (the first press only warns). */
  async function clearPrompt() {
    resetNotifications() // a warning left by the previous test must not count
    setup.mockInput.pressEscape()
    await setup.waitForFrame((f) => f.includes("Esc lần nữa để xoá ô nhập"))
    setup.mockInput.pressEscape()
    await setup.waitForFrame((f) => f.includes("Hỏi về thị trường"))
  }

  /** The user message of the newest chat request, as JSON. */
  const lastUserContent = () => {
    const messages = chatBodies.at(-1)?.messages ?? []
    return JSON.stringify(messages.filter((m) => m.role === "user").at(-1)?.content ?? "")
  }

  /** Send what is in the prompt with groq/<model> and wait for the answer to finish. */
  async function sendWith(model: string, expectUser: string) {
    await setKey("groq", "gsk-good-key")
    // The turn reads the model from the config file; the status bar from the store.
    await saveConfig({ provider: "groq", model })
    setState({ provider: "groq", model })
    const before = chatBodies.length
    setup.mockInput.pressEnter()
    await waitMcp(() => chatBodies.length > before && !state.streaming && state.lines.some((l) => l.kind === "user" && l.text.includes(expectUser)))
  }

  /** A tool that waits until released keeps the turn streaming. */
  async function slowTool() {
    const { z } = await import("zod")
    const gate = { release: () => {} }
    runtime.registry.register({
      name: "cho_lau",
      description: "Đợi (tool thử)",
      input: z.object({}),
      readOnly: true,
      execute: (_input, ctx) =>
        new Promise((resolve, reject) => {
          gate.release = () => resolve("xong")
          ctx.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        }),
    })
    mock.callSlowTool = true
    return gate
  }

  /** Poll frames on the clock (an editor is a real process). */
  async function waitFrameMs(pred: (frame: string) => boolean) {
    let frame = ""
    for (let i = 0; i < 100; i++) {
      await setup.renderOnce()
      frame = setup.captureCharFrame()
      if (pred(frame)) return frame
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`frame never matched ${pred}:\n${frame}`)
  }

  return {
    home,
    cwd,
    runtime,
    memory,
    mock,
    chatCalls,
    chatBodies,
    osc52,
    copied,
    DEMO,
    LONG,
    REPLY,
    MARKUP_REPLY,
    ASK_ONE,
    ASK_MANY,
    CATALOG,
    PATIENCE_MS,
    App,
    idleTimerForTests,
    state,
    setState,
    LOADED_PREFIX,
    SOURCE_FAILED_PREFIX,
    resetNotifications,
    say,
    reconcile,
    unwrap,
    readJson,
    setKey,
    loadConfig,
    saveConfig,
    initRuntime,
    NoopMemory,
    setClipboardSpawn,
    currentSession,
    startSession,
    command,
    show,
    connect,
    disarmExit,
    waitMcp,
    lastTurnAnswers,
    turnEnded,
    questionShown,
    closeQuestions,
    promptRows,
    settledPrompt,
    clearPrompt,
    lastUserContent,
    sendWith,
    slowTool,
    waitFrameMs,
    /** The rendered app, set in beforeAll. */
    get setup() {
      return setup
    },
  }
}
