import { createHash } from "node:crypto"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"

/**
 * In-process remote MCP servers for tests: Streamable HTTP (optionally behind a fake
 * OAuth 2.1 authorization server with DCR + PKCE) and a legacy SSE-only server.
 * Nothing here touches the network beyond 127.0.0.1.
 */

function mcpServer() {
  const server = new McpServer({ name: "remote-test", version: "0.1.0" })
  server.registerTool(
    "echo",
    { description: "Echo back the text.", inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } },
    async ({ text }) => ({ content: [{ type: "text", text }] }),
  )
  return server
}

export interface HttpServerOptions {
  /** Require OAuth: unauthenticated requests get 401 + RFC 9728 metadata. */
  oauth?: boolean
  /** Require this static bearer token (no OAuth metadata). */
  token?: string
  /** Fail the first N initialize POSTs with this status (transient-error tests). */
  failFirst?: { count: number; status: number }
}

export function startHttpServer(opts: HttpServerOptions = {}) {
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>()
  const validTokens = new Set<string>()
  const registrations: { client_id: string; redirect_uris: string[] }[] = []
  const codes = new Map<string, { challenge: string; redirect: string }>()
  let tokenCounter = 0
  let failuresLeft = opts.failFirst?.count ?? 0
  let base = ""

  const issue = () => {
    const access = `tok${++tokenCounter}`
    validTokens.add(access)
    return { access_token: access, token_type: "Bearer", expires_in: 3600, refresh_token: `refresh-${access}` }
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
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

      const sid = req.headers.get("mcp-session-id")
      if (sid) {
        const transport = sessions.get(sid)
        if (!transport) return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Session not found" } }, 404)
        return transport.handleRequest(req)
      }
      if (req.method === "POST" && failuresLeft > 0) {
        failuresLeft--
        return new Response("try later", { status: opts.failFirst!.status })
      }
      const transport: WebStandardStreamableHTTPServerTransport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, transport)
        },
      })
      await mcpServer().connect(transport)
      return transport.handleRequest(req)
    },
  })
  base = `http://127.0.0.1:${server.port}`

  return {
    url: `${base}/mcp`,
    sessions,
    validTokens,
    registrations,
    stop: () => server.stop(true),
  }
}

/** Old-style HTTP+SSE server: GET /sse opens the stream, POST /messages carries requests. */
export async function startSseServer() {
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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}/sse`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}
