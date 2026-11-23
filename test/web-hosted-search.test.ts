import { expect, test } from "bun:test"
import { hostedSearch } from "../src/core/tools/web/hosted-search"
import { planSearch } from "../src/core/tools/web/search"

test("hosted MCP search initializes and maps each provider's results", async () => {
  const sent: { host: string; method: string; params?: Record<string, unknown> }[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (init?.method !== "POST") return new Response(null, { status: 405 })
    const message = JSON.parse(String(init.body)) as { id?: number; method: string; params?: Record<string, unknown> }
    sent.push({ host: url.hostname, method: message.method, params: message.params })
    if (message.id === undefined) return new Response(null, { status: 202 })
    const result = message.method === "initialize"
      ? { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "fixture", version: "1" } }
      : { content: [{ type: "text", text: url.hostname.includes("exa")
        ? "Title: Market news\nURL: https://news.example.com/exa\nPublished: 2026-11-21T00:00:00Z\nHighlights:\nNews excerpt"
        : JSON.stringify({ results: [{ title: "Market update", url: "https://news.example.com/parallel", publish_date: "2026-11-20", excerpts: ["News excerpt"] }] }) }] }
    return Response.json({ jsonrpc: "2.0", id: message.id, result })
  }) as typeof fetch
  try {
    const plan = planSearch({ query: "market news", num_results: 3 })
    const exa = await hostedSearch("exa", plan, new AbortController().signal)
    const parallel = await hostedSearch("parallel", plan, new AbortController().signal)
    expect(exa).toEqual([{ title: "Market news", url: "https://news.example.com/exa", date: "2026-11-21", snippet: "News excerpt" }])
    expect(parallel).toEqual([{ title: "Market update", url: "https://news.example.com/parallel", date: "2026-11-20", snippet: "News excerpt" }])
    expect(sent.filter((request) => request.method === "initialize")).toHaveLength(2)
    expect(sent.filter((request) => request.method === "tools/call").map((request) => request.params)).toEqual([
      { name: "web_search_exa", arguments: { query: "market news", objective: "market news", numResults: 3 } },
      { name: "web_search", arguments: { objective: "market news", search_queries: ["market news"] } },
    ])
  } finally {
    globalThis.fetch = realFetch
  }
})
