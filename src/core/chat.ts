import { streamText, type ModelMessage } from "ai"
import { connectedProviders, getKey } from "./auth"
import { loadConfig } from "./config"
import { loadCatalog, type CatalogProvider } from "./catalog"
import { languageModel } from "./providers"
import { systemPrompt } from "./prompt"
import type { Skill } from "./skills"

export type ChatMessage = { role: "user" | "assistant"; content: string }

export class ChatSetupError extends Error {}

export async function resolveTarget(): Promise<{ provider: CatalogProvider; model: string; apiKey: string }> {
  const [config, catalog] = await Promise.all([loadConfig(), loadCatalog()])
  const id = config.provider ?? (await connectedProviders())[0]
  if (!id) throw new ChatSetupError("Chưa kết nối provider. Gõ /connect để nhập API key.")
  const provider = catalog[id]
  if (!provider) throw new ChatSetupError(`Không tìm thấy provider "${id}" trong danh mục. Gõ /connect.`)
  const apiKey = await getKey(id)
  if (!apiKey) throw new ChatSetupError(`Chưa có API key cho ${provider.name}. Gõ /connect.`)
  if (!config.model) throw new ChatSetupError("Chưa chọn model. Gõ /model.")
  return { provider, model: config.model, apiKey }
}

/** Stream assistant text for a conversation. Throws on provider errors. */
export async function* chat(messages: ChatMessage[], skills: Skill[], signal?: AbortSignal) {
  const target = await resolveTarget()
  let failure: unknown
  const result = streamText({
    model: languageModel(target.provider, target.model, target.apiKey),
    system: systemPrompt(skills),
    messages: messages as ModelMessage[],
    abortSignal: signal,
    maxRetries: 1,
    onError: ({ error }) => {
      failure = error
    },
  })
  for await (const chunk of result.textStream) yield chunk
  if (failure) throw failure
}

/** Turn SDK/network errors into one readable line. */
export function describeError(error: unknown): string {
  if (error instanceof ChatSetupError) return error.message
  const e = error as { statusCode?: number; message?: string; name?: string }
  if (e?.name === "AbortError") return "Đã huỷ."
  const status = e?.statusCode
  if (status === 401 || status === 403)
    return `API key không hợp lệ hoặc không có quyền (${status}). Gõ /connect để nhập lại.`
  if (status === 404) return "Model không tồn tại với provider này (404). Gõ /model để chọn lại."
  if (status === 429) return "Hết quota hoặc bị giới hạn tốc độ (429). Thử lại sau hoặc đổi model."
  const message = e?.message ?? String(error)
  return status ? `Lỗi ${status}: ${message}` : message
}

// Quick manual check without the TUI: `bun src/core/chat.ts "xin chào"`
if (import.meta.main) {
  const prompt = process.argv.slice(2).join(" ") || "Xin chào"
  try {
    for await (const chunk of chat([{ role: "user", content: prompt }], [])) process.stdout.write(chunk)
    process.stdout.write("\n")
  } catch (error) {
    console.error(describeError(error))
    process.exit(1)
  }
}
