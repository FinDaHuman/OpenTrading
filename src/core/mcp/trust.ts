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

function fingerprint(config: ServerConfig) {
  const what = "url" in config ? { url: config.url } : { command: config.command, args: config.args ?? [] }
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
