#!/usr/bin/env bun
/**
 * Stdio MCP server whose tools fail the ugly ways real servers do (#326): a JSON-RPC error
 * carrying a whole HTML page, one carrying a stack trace, and an `isError` result with a
 * long explanation whose codes come last. Its resources fail too: listing them throws a stack
 * trace, reading one throws an HTML page.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const server = new Server({ name: "errors", version: "0.1.0" }, { capabilities: { tools: {}, resources: {} } })
const tool = (name: string) => ({ name, description: `Fails: ${name}.`, inputSchema: { type: "object" as const, properties: {} }, annotations: { readOnlyHint: true } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [tool("html_page"), tool("stack_trace"), tool("long_is_error")] }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  switch (req.params.name) {
    case "html_page":
      throw new Error(
        `upstream answered HTTP 502: <!DOCTYPE html><html><head><title>502 Bad Gateway</title><style>${"b{}".repeat(500)}</style></head><body>${"<p>proxy</p>".repeat(400)}</body></html>`,
      )
    case "stack_trace":
      throw new Error(
        `TypeError: Cannot read properties of undefined (reading 'close')\n    at fetchQuote (/srv/app/providers/quote.js:42:17)\n    at async handler (/srv/app/server.js:88:5)\n${"    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)\n".repeat(30)}`,
      )
    default:
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `${"The upstream quote service could not be reached after several attempts and the request was abandoned. ".repeat(8)}\n{"ok": false, "error_code": "vendor_disabled", "reason": "upstream_down", "retryable": false}`,
          },
        ],
      }
  }
})

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  throw new Error(`ENOENT: no such file or directory, open '/srv/data/index.json'\n${"    at Object.openSync (node:fs:573:3)\n".repeat(40)}`)
})

server.setRequestHandler(ReadResourceRequestSchema, async () => {
  throw new Error(`<!DOCTYPE html><html><head><title>504 Gateway Time-out</title></head><body>${"<p>nginx</p>".repeat(400)}</body></html>`)
})

await server.connect(new StdioServerTransport())
