import { readJson, writeJson } from "../store"
import { loadServers } from "./config"

/**
 * First-run onboarding for the company MCP server, mirroring how opencode feels
 * ready out of the box: the config is written FOR the user on first start instead of
 * asking them to hand-edit JSON. Secrets live in auth.json (`_env_<NAME>` entries
 * feed `${NAME}` expansion in mcp.json), never in the repo.
 */

export const COMPANY_MCP_TEMPLATE = {
  mcpServers: {
    opentrading: {
      type: "http",
      url: "https://opentrading-mcp-web.onrender.com/mcp",
      headers: {
        Authorization: "Bearer ${OPENTRADING_MCP_TOKEN}",
        Accept: "application/json, text/event-stream",
      },
      startupTimeoutMs: 60_000,
      toolTimeoutMs: 180_000,
      preset: "scan",
    },
  },
} as const

export const TOKEN_SECRET_KEY = "_env_OPENTRADING_MCP_TOKEN"

/** True when neither the global nor the project config has any server configured. */
export async function needsOnboarding(home: string, cwd: string) {
  const servers = await loadServers(home, cwd)
  return servers.every((entry) => !entry.config)
}

/** Secret vars for `${NAME}` expansion: auth.json keys shaped `_env_<NAME>`. */
export async function envSecrets(home: string) {
  const raw = await readJson<Record<string, { type: string; key: string }>>(`${home}/auth.json`, {})
  const secrets: Record<string, string> = {}
  for (const [key, entry] of Object.entries(raw)) {
    if (key.startsWith("_env_") && entry?.key) secrets[key.slice("_env_".length)] = entry.key
  }
  return secrets
}

/** Save (or rotate) the team MCP token as a secret in auth.json. */
export async function saveMcpToken(token: string, home: string) {
  const file = await readJson<Record<string, { type: string; key: string }>>(`${home}/auth.json`, {})
  file[TOKEN_SECRET_KEY] = { type: "api", key: token.trim() }
  await writeJson(`${home}/auth.json`, file, true)
}

/** Write the company-server config; returns the file path written. */
export async function acceptCompanyServer(home: string) {
  const file = `${home}/mcp.json`
  await writeJson(file, COMPANY_MCP_TEMPLATE)
  return file
}
