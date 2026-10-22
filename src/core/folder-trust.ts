import { readdir, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { samePathKey } from "./fs/path-safety"
import { dataDir } from "./paths"
import { readJson, writeJson } from "./store"

/**
 * A folder's own `.opentrading/skills` and `.opentrading/agents` become part of the prompt, so
 * a downloaded repo could steer the agent. Since `opentrading` opens any folder, they load only
 * after the user trusts that folder once (Claude Code's and Codex's trust prompt). `.mcp.json`
 * keeps its stricter per-server approval (src/core/mcp/trust.ts).
 */

export interface ProjectExtras {
  /** `<cwd>/.opentrading` */
  dir: string
  skills: number
  agents: number
}

async function count(dir: string, match: (name: string, isDir: boolean) => Promise<boolean>) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  let n = 0
  for (const e of entries) if (await match(e.name, e.isDirectory())) n++
  return n
}

/**
 * What the folder would add, or undefined when there is nothing to ask about: no skill or agent
 * files, or `.opentrading` is OpenTrading's own data folder (opened in the home folder).
 */
export async function projectExtras(cwd: string, data = dataDir()): Promise<ProjectExtras | undefined> {
  const dir = path.join(cwd, ".opentrading")
  const real = await realpath(dir).catch(() => undefined)
  if (!real) return undefined
  if (samePathKey(real) === samePathKey(await realpath(data).catch(() => data))) return undefined
  const skills = await count(path.join(dir, "skills"), async (name, isDir) =>
    isDir ? Boolean((await stat(path.join(dir, "skills", name, "SKILL.md")).catch(() => undefined))?.isFile()) : false,
  )
  const agents = await count(path.join(dir, "agents"), async (name, isDir) => !isDir && name.endsWith(".md"))
  return skills + agents > 0 ? { dir, skills, agents } : undefined
}

type TrustFile = Record<string, { trustedAt: string }>

export class FolderTrust {
  /** Trusted for this run only (folders whose trust is never saved). */
  private session = new Set<string>()

  constructor(private file = path.join(dataDir(), "folder-trust.json")) {}

  private async key(cwd: string) {
    return samePathKey(await realpath(cwd).catch(() => cwd))
  }

  async isTrusted(cwd: string) {
    const key = await this.key(cwd)
    return this.session.has(key) || Boolean((await readJson<TrustFile>(this.file, {}))[key])
  }

  /**
   * `remember: false` for folders too broad to vouch for once and for all (home, a drive root:
   * what Workspace.fallbackReason flags); Claude Code likewise keeps home-folder trust per session.
   */
  async trust(cwd: string, remember = true) {
    const key = await this.key(cwd)
    this.session.add(key)
    if (!remember) return
    const data = await readJson<TrustFile>(this.file, {})
    data[key] = { trustedAt: new Date().toISOString() }
    await writeJson(this.file, data)
  }
}
