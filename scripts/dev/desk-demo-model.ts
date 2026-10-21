/**
 * The scripted model behind scripts/dev/desk-demo.tsx: answers like a provider would, so the
 * real harness (desk_run, engine, subagents, cards) runs without an API key. Every request
 * that is not for the fake provider is refused. Numbers are random.
 */

export const FAKE_API = "https://demo.opentrading.invalid/v1"
export const MODEL = "demo/ultradesk"
const TICKERS = ["FPT", "MWG", "VNM", "HPG", "VCB", "ACB", "TCB", "MBB", "SSI", "VHM", "GAS", "PNJ"]
const CATALOG = {
  nvidia: {
    id: "nvidia",
    name: "Demo (model giả)",
    env: ["NVIDIA_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: FAKE_API,
    models: { [MODEL]: { id: MODEL, name: "Ultradesk demo", tool_call: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 128_000, output: 8_000 } } },
  },
}

type Schema = {
  type?: string | string[]
  properties?: Record<string, Schema>
  items?: Schema
  anyOf?: Schema[]
  oneOf?: Schema[]
  enum?: unknown[]
  const?: unknown
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  minLength?: number
  description?: string
}

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!
const PHRASES = ["Biên gộp ổn định 4 quý", "Dòng tiền HĐKD dương", "Nợ vay giảm so với cùng kỳ", "Định giá dưới trung bình ngành", "Tăng trưởng LNST hai chữ số", "Phụ thuộc một mảng doanh thu"]

/** A value that fits the JSON schema a structured agent must return (tra_ket_qua). */
function fake(schema: Schema | undefined, key: string, ticker: string): unknown {
  if (!schema) return null
  if (schema.const !== undefined) return schema.const
  if (schema.enum?.length) return schema.enum[0]
  const alt = schema.anyOf ?? schema.oneOf
  if (alt) return fake(alt.find((s) => s.type !== "null") ?? alt[0], key, ticker)
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type
  if (type === "object" || schema.properties) {
    return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, s]) => [k, fake(s, k, ticker)]))
  }
  if (type === "array") {
    const n = Math.max(schema.minItems ?? 0, Math.min(schema.maxItems ?? 2, 2))
    return Array.from({ length: n }, () => fake(schema.items, key, ticker))
  }
  if (type === "number" || type === "integer") {
    const lo = schema.minimum ?? 0
    const hi = schema.maximum ?? lo + 25
    const v = lo + Math.random() * (hi - lo)
    return type === "integer" ? Math.round(v) : Math.round(v * 10) / 10
  }
  if (type === "boolean") return Math.random() > 0.3
  if (/^(ticker|ma|symbol)$/.test(key)) return ticker
  if (/time|ngay|ky/.test(key)) return "Q3/2026"
  const text = `${pick(PHRASES)} (${ticker}, số liệu demo)`
  return text.length >= (schema.minLength ?? 0) ? text : text.padEnd(schema.minLength!, ".")
}

type Message = { role: string; content?: unknown }
type ToolDecl = { function: { name: string; parameters?: Schema } }

const textOf = (m: Message | undefined) => (typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? ""))
let speed = 1
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms * speed))
let calls = 0

/** One streamed reply: text, or one tool call. */
function sse(reply: { text?: string; tool?: { name: string; args: unknown } }) {
  const chunk = (delta: object, finish: string | null = null) =>
    `data: ${JSON.stringify({ id: "demo", object: "chat.completion.chunk", created: 1, model: MODEL, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const usage = `data: ${JSON.stringify({ id: "demo", object: "chat.completion.chunk", created: 1, model: MODEL, choices: [], usage: { prompt_tokens: 3000 + Math.round(Math.random() * 9000), completion_tokens: 200 + Math.round(Math.random() * 1400) } })}\n\n`
  const body = reply.tool
    ? chunk({ role: "assistant", tool_calls: [{ index: 0, id: `call-${++calls}`, type: "function", function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) } }] }) + chunk({}, "tool_calls")
    : chunk({ role: "assistant", content: reply.text ?? "" }) + chunk({}, "stop")
  return new Response(body + usage + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
}

/** The scripted model: the main agent starts sang-loc; desk agents call a tool, then answer. */
async function reply(request: { messages: Message[]; tools?: ToolDecl[] }) {
  const tools = new Map((request.tools ?? []).map((t) => [t.function.name, t.function]))
  const last = request.messages.at(-1)
  const firstUser = textOf(request.messages.find((m) => m.role === "user"))
  // Subagents never get ask_user or desk_run (subagents/manager.ts EXCLUDED_TOOLS).
  const isMain = tools.has("ask_user") || tools.has("desk_run")
  if (isMain) {
    await sleep(600)
    const notice = textOf(last)
    if (notice.includes("</thong_bao_desk>")) {
      // What the run returned, as a real model would present it (JSON-escaped in the content parts).
      const raw = /<ket_qua>([\s\S]*?)<\/ket_qua>/.exec(notice.replace(/\\n/g, "\n").replace(/\\"/g, '"'))?.[1]?.trim() ?? ""
      return { text: `**Kết quả run ultradesk** (model giả: số liệu ngẫu nhiên, chỉ để xem giao diện)\n\n${raw.slice(0, 4000)}\n\nXem từng agent trong /desk.` }
    }
    if (last?.role === "tool") return { text: "Đã bắt đầu run ultradesk, theo dõi ngay trong card bên trên hoặc /desk." }
    if (!tools.has("desk_run")) return { text: "Demo ultradesk: gõ một yêu cầu có chữ **ultradesk**, ví dụ `ultradesk so sánh FPT, MWG, VNM, HPG, VCB theo ROE`." }
    const asked = TICKERS.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(textOf(last)))
    const tickers = asked.length >= 2 ? asked : TICKERS.slice(0, 6)
    return { tool: { name: "desk_run", args: { sang_loc: { tickers, tieu_chi: "ROE cao, nợ thấp (demo)" } } } }
  }
  // A desk agent: a few seconds of "work" so the card has something to show.
  await sleep(2500 + Math.random() * 5000)
  const ticker = TICKERS.find((t) => new RegExp(`\\b${t}\\b`).test(firstUser)) ?? "FPT"
  const usedTool = request.messages.some((m) => m.role === "tool")
  if (!usedTool && tools.has("current_time")) return { tool: { name: "current_time", args: {} } }
  const result = tools.get("tra_ket_qua")
  if (result) return { tool: { name: "tra_ket_qua", args: fake(result.parameters, "", ticker) } }
  return { text: `## ${ticker}\n${pick(PHRASES)}. ${pick(PHRASES)}. (Báo cáo demo, số liệu ngẫu nhiên.)` }
}

/**
 * Replace fetch: the fake provider answers, everything else is refused. `speed` scales the
 * agents' pauses (1 = a few seconds each, as a demo; tests use less).
 */
export function installFakeModel(opts: { speed?: number } = {}) {
  speed = opts.speed ?? 1
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  if (url.startsWith(FAKE_API) && url.endsWith("/chat/completions")) {
    const request = JSON.parse(String(init?.body)) as { messages: Message[]; tools?: ToolDecl[]; stream?: boolean }
    if (!request.stream) {
      // Side requests (session title): one short line.
      return Response.json({ id: "demo", object: "chat.completion", created: 1, model: MODEL, choices: [{ index: 0, message: { role: "assistant", content: "Demo ultradesk" }, finish_reason: "stop" }] })
    }
    return sse(await reply(request))
  }
    // Nothing else leaves this process.
    throw new Error(`desk-demo chặn mạng: ${url}`)
  }) as typeof fetch
}

