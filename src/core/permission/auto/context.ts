import { clip } from "./transcript"

/**
 * Context the auto-mode classifier gets besides the transcript (Claude Code's classifier
 * sees the repo's remotes as the trusted repo and the git state before destructive git
 * commands, and reads CLAUDE.md as the user's intent):
 * - the workspace's git remotes, branch and uncommitted changes;
 * - the user's INVESTOR.md (in the OpenTrading data folder, which the agent cannot write).
 * Nothing is read from the project folder as instructions: a downloaded repo must not be able
 * to steer the classifier.
 */

/** How long one workspace's git facts are reused: a review per call must not spawn git each time. */
export const GIT_CACHE_MS = 30_000
const GIT_TIMEOUT_MS = 3_000

export type GitRun = (cwd: string, args: string[]) => Promise<string | undefined>

/** `git <args>` in `cwd`; undefined when git is missing, fails or is slow. */
const runGit: GitRun = async (cwd, args) => {
  try {
    // A repo's own config could run a program on `git status` (core.fsmonitor): turned off.
    const proc = Bun.spawn(["git", "-c", "core.fsmonitor=false", "--no-optional-locks", ...args], { cwd, stdout: "pipe", stderr: "ignore", stdin: "ignore" })
    const timer = setTimeout(() => proc.kill(), GIT_TIMEOUT_MS)
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    clearTimeout(timer)
    return code === 0 ? out : undefined
  } catch {
    return undefined
  }
}

/** One environment line about the git repo at `root`, or undefined when it is not one. */
export async function gitFacts(root: string, run: GitRun = runGit): Promise<string | undefined> {
  const [status, remotes] = await Promise.all([run(root, ["status", "--porcelain=v1", "--branch", "--untracked-files=no"]), run(root, ["remote", "-v"])])
  if (status === undefined) return undefined
  const [head = "", ...changes] = status.split(/\r?\n/).filter((l) => l.trim())
  const branch = head.replace(/^##\s*/, "").trim() || "unknown"
  const pushTo = [...new Set((remotes ?? "").split(/\r?\n/).filter((l) => l.endsWith("(push)")).map((l) => l.replace(/\s+\(push\)$/, "").replace(/\s+/, " ")))]
  return (
    `Git repository at ${root}: branch ${branch}; ${changes.length} uncommitted change(s) to tracked files` +
    (pushTo.length
      ? `; remotes ${pushTo.join(", ")}. These remotes are the trusted repo: pushing the session's own work there is inside the trust boundary (secrets and private data in what is pushed still count as exfiltration); any other remote is external.`
      : "; no remotes.")
  )
}

/** Git facts per workspace root, cached for GIT_CACHE_MS. */
export class GitContext {
  private cache = new Map<string, { at: number; line: Promise<string | undefined> }>()

  constructor(private run: GitRun = runGit, private now = () => Date.now()) {}

  async lines(roots: string[]): Promise<string[]> {
    const out = await Promise.all(
      roots.map((root) => {
        const hit = this.cache.get(root)
        if (hit && this.now() - hit.at < GIT_CACHE_MS) return hit.line
        const line = gitFacts(root, this.run)
        this.cache.set(root, { at: this.now(), line })
        return line
      }),
    )
    return out.filter((l): l is string => !!l)
  }
}

/** INVESTOR.md as the classifier reads it: comments dropped, bounded. */
export function profileForClassifier(text: string | undefined): string | undefined {
  const plain = text?.replace(/<!--[\s\S]*?-->/g, "").trim()
  return plain ? clip(plain, 3_000) : undefined
}
