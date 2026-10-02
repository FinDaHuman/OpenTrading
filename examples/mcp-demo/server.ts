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

// A tool that changes something (no readOnlyHint): OpenTrading asks the user before it runs.
const notes: string[] = []
server.registerTool(
  "ghi_chu",
  {
    description: "Lưu một ghi chú vào sổ tay demo. Ví dụ về tool ghi: OpenTrading hỏi người dùng trước khi chạy.",
    inputSchema: { noi_dung: z.string().describe("Nội dung ghi chú") },
  },
  async ({ noi_dung }) => {
    notes.push(noi_dung)
    return { content: [{ type: "text", text: `Đã lưu ghi chú #${notes.length}.` }] }
  },
)

// Prompts are ready-made workflows: OpenTrading shows them as slash commands
// (`/demo:phan_tich VCB`) and sends the text below as the user's message.
server.registerPrompt(
  "phan_tich",
  {
    description: "Phân tích nhanh một mã cổ phiếu",
    argsSchema: { ma: z.string().describe("Mã cổ phiếu, ví dụ VCB"), goc_nhin: z.string().optional().describe("Trọng tâm phân tích") },
  },
  ({ ma, goc_nhin }) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `Phân tích nhanh mã ${ma.toUpperCase()}${goc_nhin ? `, trọng tâm: ${goc_nhin}` : ""}. Nêu nguồn và thời điểm dữ liệu.` },
      },
    ],
  }),
)

await server.connect(new StdioServerTransport())
console.error("opentrading-demo MCP server đang chạy (stdio)")
