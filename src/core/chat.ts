import { connectedProviders, getKey } from "./auth"
import { loadConfig } from "./config"
import { loadCatalog, type CatalogProvider } from "./catalog"

export class ChatSetupError extends Error {}

export type Target = { provider: CatalogProvider; model: string; apiKey: string }

/**
 * The provider, model and key a request goes to: the configured ones, or `override` (a
 * subagent's own model). An override naming only a model keeps the configured provider.
 */
export async function resolveTarget(override?: { provider?: string; model?: string }): Promise<Target> {
  const [config, catalog] = await Promise.all([loadConfig(), loadCatalog()])
  const id = override?.provider ?? config.provider ?? (await connectedProviders())[0]
  if (!id) throw new ChatSetupError("Chưa kết nối provider. Gõ /connect để nhập API key.")
  const provider = catalog[id]
  if (!provider) throw new ChatSetupError(`Không tìm thấy provider "${id}" trong danh mục. Gõ /connect.`)
  const apiKey = await getKey(id)
  if (!apiKey) throw new ChatSetupError(`Chưa có API key cho ${provider.name}. Gõ /connect.`)
  const model = override?.provider ? override.model : (override?.model ?? config.model)
  if (!model) throw new ChatSetupError("Chưa chọn model. Gõ /model.")
  return { provider, model, apiKey }
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

// Quick manual check without the TUI: `bun src/core/chat.ts "mấy giờ rồi?"`.
// MCP prompts run as in the TUI: `/server:prompt args` (or `/prompt args` when the name is unique).
// Write tools are refused here: there is no UI to approve them.
if (import.meta.main) {
  const { runAgent } = await import("./agent")
  const { initRuntime } = await import("./runtime")
  const { loadSkills } = await import("./skills/loader")
  const { parseCommand, parsePromptArgs } = await import("../tui/commands")
  const { skills } = await loadSkills()
  const runtime = initRuntime({ skills: () => skills })
  const { registry } = runtime
  const fail = async (message: string) => {
    console.error(message)
    await runtime.mcp.stop()
    process.exit(1)
  }
  await runtime.mcp.start()
  let input = process.argv.slice(2).join(" ") || "Xin chào"
  const cmd = input.startsWith("/") ? parseCommand(input) : undefined
  if (cmd) {
    const prompts = runtime.mcp.allPrompts()
    const exact = prompts.filter((p) => `${p.server}:${p.name}`.toLowerCase() === cmd.name)
    const bare = prompts.filter((p) => p.name.toLowerCase() === cmd.name)
    const prompt = exact[0] ?? (bare.length === 1 ? bare[0] : undefined)
    if (!prompt) {
      await fail(bare.length > 1 ? `/${cmd.name} có ở nhiều server; gõ /server:${cmd.name}.` : `Không có prompt /${cmd.name}.`)
    } else {
      const parsed = parsePromptArgs(prompt.arguments, cmd.args)
      if ("error" in parsed) await fail(`/${cmd.name}: ${parsed.error}`)
      else input = await runtime.mcp.getPrompt(prompt.server, prompt.name, parsed.values)
    }
  }
  try {
    for await (const event of runAgent({ history: [], input, skills, registry, serverInstructions: () => runtime.mcp.instructions() })) {
      if (event.type === "text-delta") process.stdout.write(event.text)
      else if (event.type === "tool-start") process.stdout.write(`\n⚙ ${event.label}\n`)
      else if (event.type === "tool-end") process.stdout.write(`${event.ok ? "✓" : "✕"} ${event.output.slice(0, 200)}\n`)
      else if (event.type === "notice") console.error(event.text)
      else if (event.type === "error") console.error(event.message)
    }
    process.stdout.write("\n")
  } catch (error) {
    await fail(describeError(error))
  }
  await runtime.mcp.stop()
}
