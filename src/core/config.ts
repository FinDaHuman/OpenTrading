import { configFile } from "./paths"
import type { ProviderId } from "./providers"
import { readJson, writeJson } from "./store"

export interface Config {
  provider?: ProviderId
  model?: string
  /** Memory implementation: "none" (default) or "file" (reference FileMemory). */
  memory?: { provider?: "none" | "file" }
}

export const loadConfig = () => readJson<Config>(configFile(), {})

export async function saveConfig(patch: Partial<Config>) {
  const next = { ...(await loadConfig()), ...patch }
  await writeJson(configFile(), next)
  return next
}
