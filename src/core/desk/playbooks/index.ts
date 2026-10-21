import type { Playbook } from "../types"
import { kiemChung } from "./kiem-chung"
import { sangLoc } from "./sang-loc"

/** Bundled playbooks (trusted TypeScript, run directly). Saved/model-written ones come later, sandboxed. */
export const PLAYBOOKS: Playbook[] = [sangLoc, kiemChung]
