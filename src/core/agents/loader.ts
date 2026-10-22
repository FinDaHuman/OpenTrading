import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { AGENTS_DIR, dataDir } from "../paths"
import type { SkillSource } from "../skills/schema"
import { parseAgent, type AgentDefinition, type AgentProblem } from "./schema"

export interface AgentRoot {
  dir: string
  source: SkillSource
}

/**
 * Highest precedence first: project overrides user overrides bundled (same name).
 * `project: false` leaves out the folder's own agents (folder not trusted, src/core/folder-trust.ts).
 */
export function agentRoots(cwd = process.cwd(), opts: { project?: boolean } = {}): AgentRoot[] {
  return [
    ...(opts.project === false ? [] : [{ dir: path.join(cwd, ".opentrading", "agents"), source: "project" as const }]),
    { dir: path.join(dataDir(), "agents"), source: "user" },
    { dir: AGENTS_DIR, source: "bundled" },
  ]
}

export interface AgentSet {
  agents: AgentDefinition[]
  problems: AgentProblem[]
}

/** Load every `<root>/<name>.md`. Broken files are reported, never thrown. */
export async function loadAgents(roots: AgentRoot[] = agentRoots()): Promise<AgentSet> {
  const byName = new Map<string, AgentDefinition>()
  const problems: AgentProblem[] = []
  for (const root of roots) {
    const entries = await readdir(root.dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue
      const file = path.join(root.dir, entry.name)
      const stem = entry.name.slice(0, -3)
      try {
        const { meta, body } = parseAgent(await readFile(file, "utf8"))
        if (meta.name !== stem) throw new Error(`name "${meta.name}" phải trùng tên file "${stem}.md"`)
        const winner = byName.get(meta.name)
        if (winner) winner.overrides ??= root.source
        else byName.set(meta.name, { ...meta, body, file, source: root.source })
      } catch (error) {
        problems.push({ file, source: root.source, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  return { agents: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), problems }
}
