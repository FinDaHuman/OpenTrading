import type { JSONSchema7 } from "@ai-sdk/provider"

interface ContentBlock {
  type: string
  text?: string
  mimeType?: string
  resource?: { uri?: string; text?: string; mimeType?: string }
  uri?: string
  name?: string
}

export interface CallToolResultLike {
  content?: ContentBlock[]
  structuredContent?: unknown
  isError?: boolean
}

/** Flatten an MCP tool result into the text the model reads. `isError` becomes a thrown error. */
export function resultToText(result: CallToolResultLike): string {
  const parts: string[] = []
  for (const block of result.content ?? []) {
    switch (block.type) {
      case "text":
        if (block.text) parts.push(block.text)
        break
      case "image":
      case "audio":
        parts.push(`[${block.type === "image" ? "ảnh" : "âm thanh"}: ${block.mimeType ?? "không rõ định dạng"} — chưa hỗ trợ hiển thị]`)
        break
      case "resource":
        parts.push(block.resource?.text ?? `[tài nguyên: ${block.resource?.uri ?? "không rõ"}]`)
        break
      case "resource_link":
        parts.push(`[liên kết tài nguyên: ${block.name ?? ""} ${block.uri ?? ""}]`.trim())
        break
      default:
        parts.push(`[nội dung loại ${block.type} chưa hỗ trợ]`)
    }
  }
  if (parts.length === 0 && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent, null, 2))
  const text = parts.join("\n\n")
  if (result.isError) throw new Error(text || "MCP tool báo lỗi nhưng không kèm thông điệp.")
  return text || "(tool không trả về nội dung)"
}

/**
 * Providers want a plain object schema. Force `type: "object"` and drop fields some of them
 * reject (Gemini refuses `$schema`, several reject `additionalProperties` at the root).
 */
export function normalizeSchema(schema: unknown): JSONSchema7 {
  const input = schema && typeof schema === "object" ? (schema as Record<string, unknown>) : {}
  const { $schema: _schema, additionalProperties: _additional, ...rest } = input
  return { ...rest, type: "object", properties: (input.properties as JSONSchema7["properties"]) ?? {} } as JSONSchema7
}
