import { appendFileSync, mkdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import { stableJson } from "../../src/core/tools/loop-guard"
import { readSourceState } from "../../src/core/tools/outcome"

/**
 * MCP answers kept in a file, so every run of a question set sees the same data and costs no
 * MCP quota. One JSON line per answer, so a killed recording keeps what it wrote. The format is
 * the protocol's own request and result, which a proxy for other harnesses can read too.
 *
 * `record` reads through: a known request is answered from the file, and only a new one goes
 * to the server, so the first answer stays. `replay` never touches the network.
 */
export type CassetteMode = "record" | "replay"

export const REPLAY_MISS = "[replay] Không có trong bản ghi"

interface Tape {
  server: string
  method: string
  params?: unknown
  result: unknown
  at: string
}

/** Request metadata (progress tokens) differs per call and says nothing about the answer. */
function essence(method: string, params: unknown) {
  if (method === "initialize" || !params || typeof params !== "object") return method === "initialize" ? undefined : params
  const { _meta: _, ...rest } = params as Record<string, unknown>
  return rest
}

const keyOf = (server: string, method: string, params: unknown) => `${server}\u0000${method}\u0000${stableJson(essence(method, params))}`

interface CallResult {
  isError?: boolean
  content?: { type: string; text?: string }[]
}

/** An outage must not become the benchmark's data: a failed call is passed on but not kept. */
function worthKeeping(method: string, result: unknown) {
  if (method !== "tools/call") return true
  const call = result as CallResult
  if (call.isError) return false
  const text = (call.content ?? []).flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n\n")
  const state = readSourceState(text)
  return !(state?.availability === "unavailable" && state.retryable !== false)
}

export class Cassette {
  /** Requests a replay could not answer: a run with any is not on fixed data. */
  misses = 0
  private tapes = new Map<string, unknown>()

  private constructor(
    private file: string,
    readonly mode: CassetteMode,
  ) {}

  static async open(file: string, mode: CassetteMode) {
    const cassette = new Cassette(file, mode)
    const text = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" && mode === "record") return ""
      throw error
    })
    for (const line of text.split("\n")) {
      if (!line) continue
      const tape = JSON.parse(line) as Tape
      cassette.tapes.set(keyOf(tape.server, tape.method, tape.params), tape.result)
    }
    if (mode === "record") mkdirSync(path.dirname(file), { recursive: true })
    return cassette
  }

  get size() {
    return this.tapes.size
  }

  get(server: string, method: string, params: unknown) {
    return this.tapes.get(keyOf(server, method, params))
  }

  keep(server: string, method: string, params: unknown, result: unknown) {
    if (!worthKeeping(method, result)) return
    const key = keyOf(server, method, params)
    if (this.tapes.has(key)) return
    this.tapes.set(key, result)
    const tape: Tape = { server, method, params: essence(method, params), result, at: new Date().toISOString() }
    appendFileSync(this.file, `${JSON.stringify(tape)}\n`)
  }

  /** What `McpManagerOptions.transport` takes. */
  transport(server: string, real: () => Transport): Transport {
    return new CassetteTransport(server, this, this.mode === "record" ? real() : undefined)
  }
}

const METHOD_NOT_FOUND = -32601

class CassetteTransport implements Transport {
  onclose?: Transport["onclose"]
  onerror?: Transport["onerror"]
  onmessage?: Transport["onmessage"]
  private pending = new Map<string | number, { method: string; params: unknown }>()

  constructor(
    private server: string,
    private cassette: Cassette,
    private real?: Transport,
  ) {}

  get sessionId() {
    return this.real?.sessionId
  }

  setProtocolVersion(version: string) {
    this.real?.setProtocolVersion?.(version)
  }

  async start() {
    if (!this.real) return
    this.real.onclose = () => this.onclose?.()
    this.real.onerror = (error) => this.onerror?.(error)
    this.real.onmessage = (message, extra) => {
      if ("id" in message && "result" in message) {
        const asked = this.pending.get(message.id as string | number)
        if (asked) this.cassette.keep(this.server, asked.method, asked.params, message.result)
      }
      if ("id" in message) this.pending.delete(message.id as string | number)
      this.onmessage?.(message, extra)
    }
    await this.real.start()
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions) {
    if (!("method" in message) || !("id" in message)) return this.real?.send(message, options)
    const { id, method, params } = message
    // A recording needs a real session; a replay's server is always there.
    if (this.real && (method === "initialize" || method === "ping")) return this.forward(message, options)
    const known = this.cassette.get(this.server, method, params)
    if (known !== undefined) return this.answer({ jsonrpc: "2.0", id, result: known as never })
    if (this.real) return this.forward(message, options)
    if (method === "ping") return this.answer({ jsonrpc: "2.0", id, result: {} })
    this.cassette.misses++
    // A tool error reaches the model and the trace; a protocol error would look like a dead server.
    if (method === "tools/call") {
      const text = `${REPLAY_MISS}: ${stableJson(params)}`
      return this.answer({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text }] } })
    }
    return this.answer({ jsonrpc: "2.0", id, error: { code: METHOD_NOT_FOUND, message: `${REPLAY_MISS}: ${method}` } })
  }

  async close() {
    if (this.real) return this.real.close()
    this.onclose?.()
  }

  private forward(message: JSONRPCMessage & { id: string | number; method: string; params?: unknown }, options?: TransportSendOptions) {
    this.pending.set(message.id, { method: message.method, params: message.params })
    return this.real!.send(message, options)
  }

  /** After the caller's `send` returns, as a real answer would be. */
  private answer(message: JSONRPCMessage) {
    queueMicrotask(() => this.onmessage?.(message))
  }
}
