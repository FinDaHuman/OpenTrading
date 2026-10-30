import { MAX_CONSECUTIVE, MAX_TOTAL, type AutoReviewer } from "../core/permission/auto"
import type { Notice } from "./notify"

/** Key of the toast: blocks in a row fold into one. */
export const AUTO_BLOCK_KEY = "auto-block"

/**
 * A toast for each new ▸▸ block, also a subagent's (its rows are not in the main transcript),
 * after Claude Code's "{tool} denied by auto mode · /permissions". Not when the block reached the
 * limit: the approval dialog is already on screen. The reviewer also changes for request counts
 * and quota pauses, so a block is "new" by its record, not by the event.
 */
export function watchAutoBlocks(auto: Pick<AutoReviewer, "recent" | "consecutive" | "total" | "onChange">, notify: (n: Notice) => void) {
  let seen = auto.recent[0]
  return auto.onChange(() => {
    const latest = auto.recent[0]
    if (!latest || latest === seen) return
    seen = latest
    if (auto.consecutive >= MAX_CONSECUTIVE || auto.total >= MAX_TOTAL) return
    notify({ key: AUTO_BLOCK_KEY, text: `${latest.tool} bị auto mode chặn · /permissions`, level: "warning", priority: "high", fold: (_, incoming) => incoming })
  })
}
