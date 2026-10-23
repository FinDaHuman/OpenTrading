import os from "node:os"
import path from "node:path"
import { BUNDLED_ROOT } from "./bundle"

/**
 * User-level state directory. Lives outside the repo so keys never reach git.
 *
 * Resolved on every call, not once at import: `OPENTRADING_HOME` may be set after this
 * module is first loaded (bun test runs every test file in one process and each file
 * points it at its own temp dir), and a value frozen at import would silently send
 * reads and writes to the wrong — or an already deleted — directory.
 */
export const dataDir = () => process.env.OPENTRADING_HOME ?? path.join(os.homedir(), ".opentrading")
export const authFile = () => path.join(dataDir(), "auth.json")
export const configFile = () => path.join(dataDir(), "config.json")
export const catalogCacheFile = () => path.join(dataDir(), "cache", "models.json")

/** Bundled skills shipped with OpenTrading (the checkout, or the copy a binary writes out). */
export const SKILLS_DIR = path.join(BUNDLED_ROOT, "skills")

/** Bundled subagent types (agents/<name>.md). */
export const AGENTS_DIR = path.join(BUNDLED_ROOT, "agents")
