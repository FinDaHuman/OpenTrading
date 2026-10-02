import type { ToolDef } from "../../core/tools/types"
import { color } from "../theme"

/**
 * Tool labels as bracketed words, the way Claude Code shows MCP annotations
 * ([read-only] green, [destructive] red, [open-world] dim) — never emoji, which Windows
 * Terminal draws in colour and two cells wide.
 */
export interface Badge {
  text: string
  fg: string
}

export const BADGE = {
  readOnly: { text: "[chỉ đọc]", fg: color.tang },
  write: { text: "[ghi]", fg: color.tham },
  irreversible: { text: "[không hoàn tác]", fg: color.giam },
  openWorld: { text: "[ra ngoài]", fg: color.tx3 },
} as const satisfies Record<string, Badge>

/** The one label that decides how a tool runs: read-only runs at once, the rest ask first. */
export function toolBadge(t: Pick<ToolDef, "readOnly" | "annotations">): Badge {
  if (t.readOnly) return BADGE.readOnly
  return t.annotations?.destructive ? BADGE.irreversible : BADGE.write
}

/** One-cell mark for list rows: ◇ read-only, ◆ asks first (red when irreversible). */
export function toolMark(t: Pick<ToolDef, "readOnly" | "annotations">) {
  if (t.readOnly) return { mark: "◇", fg: color.san }
  return { mark: "◆", fg: t.annotations?.destructive ? color.giam : color.tham }
}

/** Legend line used above tool lists. */
export const BADGE_LEGEND = "[chỉ đọc] chạy ngay · [ghi] hỏi trước · [không hoàn tác] hỏi trước, khung đỏ"
