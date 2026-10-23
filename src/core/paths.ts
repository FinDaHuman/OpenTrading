import path from "node:path"
import { BUNDLED_ROOT } from "./bundle"
import { dataDir } from "./home"

export { dataDir } from "./home"
export const authFile = () => path.join(dataDir(), "auth.json")
export const configFile = () => path.join(dataDir(), "config.json")
export const catalogCacheFile = () => path.join(dataDir(), "cache", "models.json")

/** Bundled skills shipped with OpenTrading (the checkout, or the copy a binary writes out). */
export const SKILLS_DIR = path.join(BUNDLED_ROOT, "skills")

/** Bundled subagent types (agents/<name>.md). */
export const AGENTS_DIR = path.join(BUNDLED_ROOT, "agents")
