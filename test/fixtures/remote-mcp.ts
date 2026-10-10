import { createHash } from "node:crypto"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { Server as McpLowLevelServer } from "@modelcontextprotocol/sdk/server/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

/**
 * In-process remote MCP servers for tests: Streamable HTTP (optionally behind a fake
 * OAuth 2.1 authorization server with DCR + PKCE) and a legacy SSE-only server.
 * Nothing here touches the network beyond 127.0.0.1.
 */

/** Load counters for the extra tools: calls seen and the most running at once. */
export interface CallStats {
  calls: number
  inFlight: number
  maxInFlight: number
  notes: number
}

function mcpServer(stats?: CallStats) {
  const server = new McpServer({ name: "remote-test", version: "0.1.0" })
  if (stats) {
    server.registerTool(
      "slow",
      { description: "Wait, then answer.", inputSchema: { ms: z.number() }, annotations: { readOnlyHint: true } },
      async ({ ms }) => {
        stats.calls++
        stats.inFlight++
        stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight)
        await Bun.sleep(ms)
        stats.inFlight--
        return { content: [{ type: "text", text: `waited ${ms}` }] }
      },
    )
    server.registerTool("upstream_down", { description: "Report an upstream failure.", annotations: { readOnlyHint: true } }, async () => {
      stats.calls++
      return { isError: true, content: [{ type: "text", text: "upstream fetch failed: ECONNRESET" }] }
    })
    server.registerTool("note", { description: "Write a note.", inputSchema: { text: z.string(), ms: z.number().optional() } }, async ({ text, ms }) => {
      if (ms) await Bun.sleep(ms)
      stats.notes++
      return { content: [{ type: "text", text: `saved ${text}` }] }
    })
  }
  server.registerTool(
    "echo",
    { description: "Echo back the text.", inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } },
    async ({ text }) => ({ content: [{ type: "text", text }] }),
  )
  server.registerTool(
    "screenshot",
    { description: "Return a tiny PNG.", annotations: { readOnlyHint: true } },
    async () => ({ content: [{ type: "text", text: "đã chụp" }, { type: "image", data: TINY_PNG, mimeType: "image/png" }] }),
  )
  server.registerPrompt(
    "ticker_analysis",
    { description: "Phân tích một mã", argsSchema: { ticker: z.string(), focus: z.string().optional() } },
    ({ ticker, focus }) => ({
      messages: [
        { role: "user", content: { type: "text", text: `Phân tích ${ticker}${focus ? ` (trọng tâm: ${focus})` : ""}` } },
        { role: "assistant", content: { type: "text", text: "Tôi sẽ dùng dữ liệu giá." } },
      ],
    }),
  )
  server.registerResource("calendar", "ot://calendar", { mimeType: "text/plain", description: "Lịch nghỉ lễ" }, async (uri) => ({
    contents: [{ uri: uri.href, text: "02/09: nghỉ Quốc khánh" }],
  }))
  return server
}

/**
 * A server that declares an output schema and then breaks it (as real servers do). Built on
 * the low-level Server because McpServer would refuse to send the bad result.
 */
function sloppyServer() {
  const server = new McpLowLevelServer({ name: "sloppy", version: "0.1.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "price",
        inputSchema: { type: "object" as const, properties: {} },
        outputSchema: { type: "object" as const, properties: { price: { type: "number" } }, required: ["price"] },
      },
    ],
  }))
  server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "giá 25.000" }], structuredContent: { price: "25.000" } }))
  return server
}

/** 1×1 transparent PNG. */
export const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

export interface HttpServerOptions {
  /** Require OAuth: unauthenticated requests get 401 + RFC 9728 metadata. */
  oauth?: boolean
  /** Require this static bearer token (no OAuth metadata). */
  token?: string
  /** Serve the schema-breaking server instead of the normal one. */
  sloppy?: boolean
  /** Fail the first N initialize POSTs with this status (transient-error tests). */
  failFirst?: { count: number; status: number; body?: string }
  /** Listen on this port (a restarted server comes back on the same URL). */
  port?: number
  /** Add the `slow` (read-only) and `note` (write) tools and count their calls here. */
  stats?: CallStats
}

export function startHttpServer(opts: HttpServerOptions = {}) {
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>()
  const validTokens = new Set<string>()
  const registrations: { client_id: string; redirect_uris: string[] }[] = []
  const codes = new Map<string, { challenge: string; redirect: string }>()
  let tokenCounter = 0
  let failuresLeft = opts.failFirst?.count ?? 0
  /** Answer the next N tools/call POSTs like a PaaS proxy whose app is restarting. */
  const failCalls = { count: 0, status: 502 }
  /** While `status` is set, every /mcp request gets that status and an HTML page (the app is down). */
  const down = { status: 0 }
  const page = (status: number) =>
    new Response(`<!DOCTYPE html><html><head><title>${status} Bad Gateway</title></head><body>${"x".repeat(5000)}</body></html>`, {
      status,
      headers: { "content-type": "text/html" },
    })
  let base = ""

  const issue = () => {
    const access = `tok${++tokenCounter}`
    validTokens.add(access)
    return { access_token: access, token_type: "Bearer", expires_in: 3600, refresh_token: `refresh-${access}` }
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url)
      const json = (body: unknown, status = 200) => Response.json(body, { status })

      if (opts.oauth) {
        if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
          return json({ resource: `${base}/mcp`, authorization_servers: [base] })
        }
        if (url.pathname.startsWith("/.well-known/oauth-authorization-server") || url.pathname.startsWith("/.well-known/openid-configuration")) {
          return json({
            issuer: base,
            authorization_endpoint: `${base}/authorize`,
            token_endpoint: `${base}/token`,
            registration_endpoint: `${base}/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none"],
          })
        }
        if (url.pathname === "/register" && req.method === "POST") {
          const body = (await req.json()) as { redirect_uris: string[] }
          const client = { ...body, client_id: `client-${registrations.length + 1}` }
          registrations.push(client)
          return json(client, 201)
        }
        if (url.pathname === "/authorize") {
          // Auto-approve: send the browser straight back with a code.
          const redirect = url.searchParams.get("redirect_uri")!
          const client = registrations.find((r) => r.client_id === url.searchParams.get("client_id"))
          if (!client?.redirect_uris.includes(redirect)) return new Response("bad redirect_uri", { status: 400 })
          const code = `code-${codes.size + 1}`
          codes.set(code, { challenge: url.searchParams.get("code_challenge")!, redirect })
          const back = new URL(redirect)
          back.searchParams.set("code", code)
          back.searchParams.set("state", url.searchParams.get("state") ?? "")
          return Response.redirect(back.href, 302)
        }
        if (url.pathname === "/token" && req.method === "POST") {
          const form = new URLSearchParams(await req.text())
          if (form.get("grant_type") === "authorization_code") {
            const entry = codes.get(form.get("code") ?? "")
            const verifier = form.get("code_verifier") ?? ""
            const challenge = createHash("sha256").update(verifier).digest("base64url")
            if (!entry || entry.challenge !== challenge) return json({ error: "invalid_grant" }, 400)
            codes.delete(form.get("code")!)
            return json(issue())
          }
          if (form.get("grant_type") === "refresh_token" && form.get("refresh_token")?.startsWith("refresh-")) return json(issue())
          return json({ error: "invalid_grant" }, 400)
        }
      }

      if (url.pathname !== "/mcp") return new Response("not found", { status: 404 })

      const auth = req.headers.get("authorization")
      if (opts.oauth && !(auth && validTokens.has(auth.replace(/^Bearer /, "")))) {
        return new Response("unauthorized", {
          status: 401,
          headers: { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` },
        })
      }
      if (opts.token && auth !== `Bearer ${opts.token}`) return new Response("unauthorized", { status: 401 })

      if (down.status) return page(down.status)
      if (req.method === "POST" && failCalls.count > 0) {
        const body = (await req.clone().json().catch(() => ({}))) as { method?: string }
        if (body.method === "tools/call") {
          failCalls.count--
          return page(failCalls.status)
        }
      }
      const sid = req.headers.get("mcp-session-id")
      if (sid) {
        const transport = sessions.get(sid)
        if (!transport) return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Session not found" } }, 404)
        return transport.handleRequest(req)
      }
      if (req.method === "POST" && failuresLeft > 0) {
        failuresLeft--
        return new Response(opts.failFirst!.body ?? "try later", { status: opts.failFirst!.status })
      }
      const transport: WebStandardStreamableHTTPServerTransport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, transport)
        },
      })
      await (opts.sloppy ? sloppyServer() : mcpServer(opts.stats)).connect(transport)
      return transport.handleRequest(req)
    },
  })
  base = `http://127.0.0.1:${server.port}`

  return {
    url: `${base}/mcp`,
    port: server.port,
    sessions,
    validTokens,
    registrations,
    failCalls,
    down,
    stop: () => server.stop(true),
  }
}

/** Old-style HTTP+SSE server: GET /sse opens the stream, POST /messages carries requests. */
export async function startSseServer(port = 0) {
  const transports = new Map<string, SSEServerTransport>()
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    if (req.method === "GET" && url.pathname === "/sse") {
      const transport = new SSEServerTransport("/messages", res)
      transports.set(transport.sessionId, transport)
      res.on("close", () => transports.delete(transport.sessionId))
      await mcpServer().connect(transport)
      return
    }
    if (req.method === "POST" && url.pathname === "/messages") {
      const transport = transports.get(url.searchParams.get("sessionId") ?? "")
      if (!transport) {
        res.writeHead(404).end("no session")
        return
      }
      await transport.handlePostMessage(req, res)
      return
    }
    // A Streamable HTTP POST to /sse lands here: legacy servers answer 405.
    res.writeHead(405).end("method not allowed")
  })
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve))
  const actual = (server.address() as AddressInfo).port
  return {
    port: actual,
    url: `http://127.0.0.1:${actual}/sse`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}
