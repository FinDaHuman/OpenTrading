#!/usr/bin/env bun
/**
 * Stdio MCP server for tests: tools, prompts and resources in pages (sizes from PAGES, e.g.
 * "1500,1500"), and, with NAME_CLASH, two tools whose model-visible names would collide.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ListPromptsRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const sizes = (process.env.PAGES ?? "2").split(",").map(Number)
const clash = process.env.NAME_CLASH ? JSON.parse(process.env.NAME_CLASH) as string[] : undefined

function page<T>(cursor: string | undefined, make: (i: number) => T) {
  const at = cursor ? Number(cursor) : 0
  const start = sizes.slice(0, at).reduce((a, b) => a + b, 0)
  const items = Array.from({ length: sizes[at] ?? 0 }, (_, i) => make(start + i))
  return { items, nextCursor: at + 1 < sizes.length ? String(at + 1) : undefined }
}

const server = new Server({ name: "paged", version: "0.1.0" }, { capabilities: { tools: {}, prompts: {}, resources: {} } })
server.setRequestHandler(ListToolsRequestSchema, (req) => {
  if (clash) return { tools: clash.map((name) => ({ name, inputSchema: { type: "object" as const }, annotations: { readOnlyHint: true } })) }
  const { items, nextCursor } = page(req.params?.cursor, (i) => ({ name: `t${i}`, inputSchema: { type: "object" as const }, annotations: { readOnlyHint: true } }))
  return { tools: items, ...(nextCursor ? { nextCursor } : {}) }
})
server.setRequestHandler(ListPromptsRequestSchema, (req) => {
  const { items, nextCursor } = page(req.params?.cursor, (i) => ({ name: `p${i}` }))
  return { prompts: items, ...(nextCursor ? { nextCursor } : {}) }
})
server.setRequestHandler(ListResourcesRequestSchema, (req) => {
  const { items, nextCursor } = page(req.params?.cursor, (i) => ({ uri: `mem://r${i}`, name: `r${i}` }))
  return { resources: items, ...(nextCursor ? { nextCursor } : {}) }
})
await server.connect(new StdioServerTransport())
