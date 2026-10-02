import { configFile } from "./paths"
import type { ProviderId } from "./providers"
import { readJson, writeJson } from "./store"

export interface Config {
  provider?: ProviderId
  model?: string
  /**
   * Memory: `provider` is "none" (default) or "sqlite" ("file", the old reference provider's name, means "sqlite").
   * Other keys are the memory settings (limits, T3…), read by the memory module itself.
   */
  memory?: { provider?: "none" | "sqlite" | "file"; [setting: string]: unknown }
}

export const loadConfig = () => readJson<Config>(configFile(), {})

export async function saveConfig(patch: Partial<Config>) {
  const next = { ...(await loadConfig()), ...patch }
  await writeJson(configFile(), next)
  return next
}
