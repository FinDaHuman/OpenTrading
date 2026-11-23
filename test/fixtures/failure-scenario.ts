import { startHttpServer } from "./remote-mcp"

/** Synthetic figures: VCB is available; BID's upstream source reports an MCP tool error. */
export function startFailureScenario() {
  const calls: string[] = []
  const remote = startHttpServer({ onRequest: async (request, method) => {
    if (method !== "tools/list" && method !== "tools/call") return
    const body = await request.clone().json() as { id: string | number; params?: { name?: string } }
    const headers = { "mcp-session-id": request.headers.get("mcp-session-id") ?? "" }
    if (method === "tools/list") {
      const tool = (name: string, description: string) => ({ name, description, inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } })
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [tool("vcb_ratios", "Return the synthetic VCB P/E and ROE in the test data."), tool("bid_ratios", "Return the synthetic BID P/E and ROE in the test data.")] } }, { headers })
    }
    const name = body.params?.name ?? ""
    calls.push(name)
    const result = name === "vcb_ratios"
      ? { content: [{ type: "text", text: "TEST DATA, not market data: VCB, year 2025, P/E 8.4, ROE 19.1%." }] }
      : { isError: true, content: [{ type: "text", text: "MCP server data: temporary error; BID test ratios source is unavailable." }] }
    return Response.json({ jsonrpc: "2.0", id: body.id, result }, { headers })
  } })
  return { ...remote, calls }
}
