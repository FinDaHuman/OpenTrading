import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { appVersion } from "../../build-info"
import type { Hit, SearchPlan } from "./search"
import { withSiteOperators } from "./search"

type HostedProvider = "exa" | "parallel"

function exaHits(text: string): Hit[] {
  return text.split(/\n---\n/).flatMap((section) => {
    const url = section.match(/^URL: (https?:\/\/\S+)/m)?.[1]
    if (!url) return []
    return [{
      url,
      title: section.match(/^Title: (.+)/m)?.[1],
      date: section.match(/^Published: (\d{4}-\d{2}-\d{2})/m)?.[1],
      snippet: section.match(/(?:Highlights|Text):\s*([\s\S]*)/)?.[1],
    }]
  })
}

function parallelHits(text: string): Hit[] {
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== "object" || !("results" in parsed) || !Array.isArray(parsed.results)) return []
  return parsed.results.flatMap((result: unknown) => {
    if (!result || typeof result !== "object" || !("url" in result) || typeof result.url !== "string") return []
    const item = result as Record<string, unknown>
    return [{
      url: result.url,
      title: typeof item.title === "string" ? item.title : undefined,
      date: typeof item.publish_date === "string" ? item.publish_date.slice(0, 10) : undefined,
      snippet: Array.isArray(item.excerpts) ? item.excerpts.filter((value): value is string => typeof value === "string").join(" … ") : undefined,
    }]
  })
}

export async function hostedSearch(provider: HostedProvider, plan: SearchPlan, signal: AbortSignal): Promise<Hit[]> {
  const client = new Client({ name: "opentrading", version: appVersion }, { capabilities: {} })
  const url = provider === "exa" ? "https://mcp.exa.ai/mcp" : "https://search.parallel.ai/mcp"
  const transport = new StreamableHTTPClientTransport(new URL(url))
  const query = withSiteOperators(plan)
  const objective = plan.since ? `${query} after:${plan.since}` : query
  try {
    await client.connect(transport, { signal })
    const result = await client.callTool({
      name: provider === "exa" ? "web_search_exa" : "web_search",
      arguments: provider === "exa" ? { query: objective, objective, numResults: plan.n } : { objective, search_queries: [query] },
    }, undefined, { signal })
    if (result.isError) throw new Error(`${provider} MCP search failed`)
    const content = Array.isArray(result.content) ? result.content : []
    return content.flatMap((part) => part.type === "text" ? (provider === "exa" ? exaHits(part.text) : parallelHits(part.text)) : [])
  } finally {
    await client.close().catch(() => {})
  }
}
