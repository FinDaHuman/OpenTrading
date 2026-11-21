import type { ToolImage, ToolResult } from "../tools/types"
import { McpModelError, modelErrorText } from "./errors"

interface ContentBlock {
  type: string
  text?: string
  data?: string
  mimeType?: string
  resource?: { uri?: string; text?: string; blob?: string; mimeType?: string }
  uri?: string
  name?: string
}

export interface CallToolResultLike {
  content?: ContentBlock[]
  structuredContent?: unknown
  isError?: boolean
}

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp)$/i

/** One MCP content block → text for the model, or an image it may be able to see. */
export function blockToParts(block: ContentBlock): { text?: string; image?: ToolImage } {
  switch (block.type) {
    case "text":
      return { text: block.text ?? "" }
    case "image":
      if (block.data && block.mimeType && IMAGE_TYPES.test(block.mimeType)) return { image: { data: block.data, mediaType: block.mimeType } }
      return { text: `[image: ${block.mimeType ?? "unknown format"} — format not supported]` }
    case "audio":
      return { text: `[audio: ${block.mimeType ?? "unknown format"} — not supported]` }
    case "resource": {
      const r = block.resource
      if (r?.text !== undefined) return { text: r.text }
      if (r?.blob && r.mimeType && IMAGE_TYPES.test(r.mimeType)) return { image: { data: r.blob, mediaType: r.mimeType } }
      return { text: `[resource: ${r?.uri ?? "unknown"}${r?.mimeType ? ` (${r.mimeType})` : ""}]` }
    }
    case "resource_link":
      return { text: `[resource link: ${block.name ?? ""} ${block.uri ?? ""}]`.replace(/\s+\]/, "]") }
    default:
      return { text: `[content of type ${block.type} not supported]` }
  }
}

/**
 * Flatten an MCP tool result into what the model reads: text, plus images for models that
 * can see them. `isError` becomes a thrown error (the AI SDK turns it into a tool-error),
 * cut to one short line that keeps its codes (#326).
 * Returns a plain string when there are no images, so text-only callers stay simple.
 */
export function resultToOutput(result: CallToolResultLike): string | ToolResult {
  const parts: string[] = []
  const images: ToolImage[] = []
  for (const block of result.content ?? []) {
    const { text, image } = blockToParts(block)
    if (text) parts.push(text)
    if (image) images.push(image)
  }
  if (parts.length === 0 && images.length === 0 && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent, null, 2))
  const text = parts.join("\n\n")
  if (result.isError) throw new McpModelError(text.trim() ? modelErrorText(text) : "The MCP tool reported an error without a message.")
  if (images.length > 0) return { output: text || `(the tool returned ${images.length} images)`, images }
  return text || "(the tool returned no content)"
}

/** Text-only view of a result (tests, logs). */
export function resultToText(result: CallToolResultLike): string {
  const out = resultToOutput(result)
  return typeof out === "string" ? out : out.output
}
