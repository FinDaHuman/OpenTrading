import { connectedProviders, getKey } from "./auth"
import { loadConfig } from "./config"
import { loadCatalog, type CatalogProvider } from "./catalog"

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

/** Turn SDK/network errors into one readable line. */
export function describeError(error: unknown): string {
  if (error instanceof ChatSetupError) return error.message
  const e = error as { statusCode?: number; message?: string; name?: string; lastError?: unknown }
  // When retries run out the SDK wraps the real error ("Failed after 3 attempts…").
  if (e?.name === "AI_RetryError" && e.lastError) return describeError(e.lastError)
  if (e?.name === "AbortError") return "Đã huỷ."
  const status = e?.statusCode
  if (status === 401 || status === 403)
    return `API key không hợp lệ hoặc không có quyền (${status}). Gõ /connect để nhập lại.`
  if (status === 404) return "Model không tồn tại với provider này (404). Gõ /model để chọn lại."
  if (status === 429) return "Hết quota hoặc bị giới hạn tốc độ (429). Thử lại sau hoặc đổi model."
  if (status === 400 && /tool/i.test(e?.message ?? "") && /support/i.test(e?.message ?? ""))
    return "Model này không hỗ trợ gọi tool (400). Gõ /model để chọn model khác."
  const message = e?.message ?? String(error)
  return status ? `Lỗi ${status}: ${message}` : message
}

// Quick manual check without the TUI (built-in tools only): `bun src/core/chat.ts "mấy giờ rồi?"`
if (import.meta.main) {
  const { runAgent } = await import("./agent")
  const { initRuntime } = await import("./runtime")
  const { loadSkills } = await import("./skills/loader")
  const { skills } = await loadSkills()
  const { registry } = initRuntime({ skills: () => skills })
  const input = process.argv.slice(2).join(" ") || "Xin chào"
  try {
    for await (const event of runAgent({ history: [], input, skills, registry })) {
      if (event.type === "text-delta") process.stdout.write(event.text)
      else if (event.type === "tool-start") process.stdout.write(`\n⚙ ${event.label}\n`)
      else if (event.type === "tool-end") process.stdout.write(`${event.ok ? "✓" : "✕"} ${event.output.slice(0, 200)}\n`)
      else if (event.type === "notice") console.error(event.text)
      else if (event.type === "error") console.error(event.message)
    }
    process.stdout.write("\n")
  } catch (error) {
    console.error(describeError(error))
    process.exit(1)
  }
}
