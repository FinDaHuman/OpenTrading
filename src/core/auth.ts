import { loadCatalog } from "./catalog"
import { AUTH_FILE } from "./paths"
import type { ProviderId } from "./providers"
import { readJson, writeJson } from "./store"

/** Same shape as opencode's auth.json so the format is familiar. */
export type ApiAuth = { type: "api"; key: string }
type AuthFile = Record<ProviderId, ApiAuth>

/** Stored key first, then any of the provider's env vars from the catalog. */
export async function getKey(provider: ProviderId): Promise<string | undefined> {
  const file = await readJson<AuthFile>(AUTH_FILE, {})
  if (file[provider]?.key) return file[provider].key
  const env = (await loadCatalog())[provider]?.env ?? []
  for (const name of env) if (process.env[name]) return process.env[name]
  return undefined
}

export async function setKey(provider: ProviderId, key: string) {
  const file = await readJson<AuthFile>(AUTH_FILE, {})
  file[provider] = { type: "api", key: key.trim() }
  await writeJson(AUTH_FILE, file, true)
}

/** Providers with a usable key, in catalog order: stored keys, then env vars. */
export async function connectedProviders(): Promise<ProviderId[]> {
  const [file, catalog] = await Promise.all([readJson<AuthFile>(AUTH_FILE, {}), loadCatalog()])
  const stored = Object.keys(file).filter((id) => file[id]?.key && catalog[id])
  const fromEnv = Object.values(catalog)
    .filter((p) => !stored.includes(p.id) && p.env.some((name) => process.env[name]))
    .map((p) => p.id)
  return [...stored, ...fromEnv]
}

/** Show only enough of a key to recognise it: `gsk_…abcd`. */
export function maskKey(key: string) {
  if (key.length <= 10) return "•".repeat(key.length)
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}
