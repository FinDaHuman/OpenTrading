#!/usr/bin/env bun
/**
 * Minimal MCP server (stdio) — a template for OpenTrading data servers.
 *
 *   bun examples/mcp-demo/server.ts
 *
 * Conventions worth copying:
 * - Describe each tool for the model, in Vietnamese if the model should answer in Vietnamese.
 * - Mark data lookups `readOnlyHint: true` so OpenTrading may run them in parallel.
 * - Report failures with `isError: true` and a readable message; the model sees the message.
 * - Never write to stdout except through the transport (stdout is the protocol channel);
 *   use console.error for logs.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const server = new McpServer({ name: "opentrading-demo", version: "0.1.0" })

server.registerTool(
  "echo",
  {
    description: "Trả lại nguyên văn đoạn text được gửi vào. Dùng để kiểm tra kết nối.",
    inputSchema: { text: z.string().describe("Nội dung cần trả lại") },
    annotations: { readOnlyHint: true },
  },
  async ({ text }) => ({ content: [{ type: "text", text }] }),
)

server.registerTool(
  "add",
  {
    description: "Cộng hai số và trả về kết quả.",
    inputSchema: { a: z.number(), b: z.number() },
    annotations: { readOnlyHint: true },
  },
  async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
)

server.registerTool(
  "fail",
  {
    description: "Luôn báo lỗi. Dùng để kiểm tra cách harness xử lý lỗi từ tool.",
    annotations: { readOnlyHint: true },
  },
  async () => ({ isError: true, content: [{ type: "text", text: "Nguồn dữ liệu demo đang lỗi (cố ý)." }] }),
)

await server.connect(new StdioServerTransport())
console.error("opentrading-demo MCP server đang chạy (stdio)")
