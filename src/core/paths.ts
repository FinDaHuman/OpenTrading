import os from "node:os"
import path from "node:path"

/** User-level state directory. Lives outside the repo so keys never reach git. */
export const DATA_DIR = process.env.OPENTRADING_HOME ?? path.join(os.homedir(), ".opentrading")
export const AUTH_FILE = path.join(DATA_DIR, "auth.json")
export const CONFIG_FILE = path.join(DATA_DIR, "config.json")

/** Bundled skills shipped with the repo. */
export const SKILLS_DIR = path.resolve(import.meta.dir, "../../skills")
