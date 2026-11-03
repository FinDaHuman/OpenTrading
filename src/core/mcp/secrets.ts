import { createHash } from "node:crypto"
import path from "node:path"
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js"
import { readJson, updateJson } from "../store"

/**
 * `~/.opentrading/mcp-auth.json` (mode 0600 off Windows): everything secret about MCP.
 * - `env`: values for `${NAME}` in mcp.json (team tokens, PATs) so they never sit in config.
 * - `oauth`: per-server OAuth client registration and tokens, keyed by name + URL hash so a
 *   server whose URL changes starts clean instead of sending tokens to a new host.
 */
export interface OAuthRecord {
  serverUrl: string
  clientInfo?: OAuthClientInformationMixed
  /** Callback port the client was registered with — its redirect URI must stay the same. */
  callbackPort?: number
  tokens?: OAuthTokens
  /** Epoch ms; derived from `expires_in` when tokens are saved. */
  expiresAt?: number
}

interface McpAuthFile {
  env?: Record<string, string>
  oauth?: Record<string, OAuthRecord>
}

export const mcpAuthFile = (home: string) => path.join(home, "mcp-auth.json")

export function oauthKey(name: string, url: string) {
  return `${name}|${createHash("sha256").update(url).digest("hex").slice(0, 16)}`
}

async function read(home: string) {
  return readJson<McpAuthFile>(mcpAuthFile(home), {})
}

/** Parallel OAuth flows / refreshes must not lose each other's changes, nor a file that failed to read. */
async function update(home: string, change: (data: McpAuthFile) => void) {
  await updateJson<McpAuthFile>(
    mcpAuthFile(home),
    {},
    (data) => {
      change(data)
      return data
    },
    { secret: true },
  )
}

export async function secretEnv(home: string): Promise<Record<string, string>> {
  return (await read(home)).env ?? {}
}

export async function setSecretEnv(home: string, name: string, value: string | undefined) {
  await update(home, (data) => {
    data.env ??= {}
    if (value === undefined) delete data.env[name]
    else data.env[name] = value
  })
}

export async function readOAuth(home: string, key: string): Promise<OAuthRecord | undefined> {
  return (await read(home)).oauth?.[key]
}

export async function writeOAuth(home: string, key: string, record: OAuthRecord | undefined) {
  await update(home, (data) => {
    data.oauth ??= {}
    if (record === undefined) delete data.oauth[key]
    else data.oauth[key] = record
  })
}

/** Remove every OAuth record of a server, whatever URL it was stored under. */
export async function clearOAuth(home: string, name: string) {
  await update(home, (data) => {
    for (const key of Object.keys(data.oauth ?? {})) if (key.startsWith(`${name}|`)) delete data.oauth![key]
  })
}
