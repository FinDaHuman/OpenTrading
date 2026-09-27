import { CONFIG_FILE } from "./paths"
import type { ProviderId } from "./providers"
import { readJson, writeJson } from "./store"

export interface Config {
  provider?: ProviderId
  model?: string
}

export const loadConfig = () => readJson<Config>(CONFIG_FILE, {})

export async function saveConfig(patch: Partial<Config>) {
  const next = { ...(await loadConfig()), ...patch }
  await writeJson(CONFIG_FILE, next)
  return next
}
