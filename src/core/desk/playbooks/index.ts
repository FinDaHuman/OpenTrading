import type { Playbook } from "../types"
import { kiemChung } from "./kiem-chung"
import { nganh } from "./nganh"
import { sangLoc } from "./sang-loc"
import { tranhBien } from "./tranh-bien"

/** Bundled playbooks (trusted TypeScript, run directly). Saved/model-written ones come later, sandboxed. */
export const PLAYBOOKS: Playbook[] = [sangLoc, kiemChung, tranhBien, nganh]
