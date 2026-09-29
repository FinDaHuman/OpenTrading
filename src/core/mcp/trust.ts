import { createHash } from "node:crypto"
import path from "node:path"
import { readJson, writeJson } from "../store"
import type { ServerConfig } from "./config"

/**
 * A `.mcp.json` inside a repo can make us spawn arbitrary commands, so project servers
 * need a one-time approval. The approval is bound to the project path, the server name
 * and what it runs — editing the command or URL asks again.
 */
type TrustFile = Record<string, { approvedAt: string }>

/**
 * Everything that decides what code runs. `env` and `cwd` count too: NODE_OPTIONS,
 * PYTHONPATH or a different working directory can make the same command run other code.
 * Uses the raw (unexpanded) config, so rotating a secret in the environment does not re-ask.
 */
function fingerprint(config: ServerConfig) {
  const what =
    "url" in config
      ? { url: config.url }
      : {
          command: config.command,
          args: config.args ?? [],
          cwd: config.cwd ?? null,
          env: Object.entries(config.env ?? {}).sort(([a], [b]) => a.localeCompare(b)),
        }
  return createHash("sha256").update(JSON.stringify(what)).digest("hex").slice(0, 16)
}

export function trustKey(cwd: string, name: string, config: ServerConfig) {
  return `${path.resolve(cwd)}::${name}::${fingerprint(config)}`
}

export class TrustStore {
  constructor(private file: string) {}

  async isTrusted(key: string) {
    const data = await readJson<TrustFile>(this.file, {})
    return Boolean(data[key])
  }

  async trust(key: string) {
    const data = await readJson<TrustFile>(this.file, {})
    data[key] = { approvedAt: new Date().toISOString() }
    await writeJson(this.file, data)
  }
}
