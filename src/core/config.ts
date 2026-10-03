import { configFile } from "./paths"
import type { ProviderId } from "./providers"
import { readJson, writeJson } from "./store"

export interface Config {
  provider?: ProviderId
  model?: string
  /** Memory implementation: "none" (default) or "file" (reference FileMemory). */
  memory?: { provider?: "none" | "file" }
  /** Tools the user chose to always allow (see core/permission.ts). */
  permissions?: { allow?: { tool: string; scope: string }[] }
  /**
   * Deferred tool loading. "auto" (default): MCP tools are sent by name only, and loaded with
   * tool_search, once they would cost over 10% of the context or there are more than
   * `toolSearchMinTools` of them. "on": always defer. "off": send everything (capped at 128).
   */
  toolSearch?: "auto" | "on" | "off"
  /** MCP tool count above which "auto" defers. Default 40. */
  toolSearchMinTools?: number
}

export const loadConfig = () => readJson<Config>(configFile(), {})

export async function saveConfig(patch: Partial<Config>) {
  const next = { ...(await loadConfig()), ...patch }
  await writeJson(configFile(), next)
  return next
}
