import path from "node:path"
import { loadConfig } from "../core/config"
import { clearScratch, formatSize, pruneScratch, SCRATCH_KEEP_DAYS, SCRATCH_WARN_MB, ScratchMonitor, scratchUsage } from "../core/fs/scratch-size"
import type { Scratchpad } from "../core/fs/scratch"
import type { Runtime } from "../core/runtime"

/**
 * The scratchpad in the TUI (core/fs/scratch.ts): the folder each turn, the size warning
 * under an answer, old sessions pruned at startup, and /scratch.
 */

const MB = 1024 * 1024
/** At the end of a turn, wait this long for a walk still running (a short turn ends first). */
const SETTLE_MS = 150
let monitor: { pad: Scratchpad; watch: ScratchMonitor } | undefined

function watchFor(pad: Scratchpad) {
  if (monitor?.pad !== pad) {
    monitor = { pad, watch: new ScratchMonitor(pad, { warnBytes: async () => ((await loadConfig()).scratchpad?.warnMB ?? SCRATCH_WARN_MB) * MB }) }
  }
  return monitor.watch
}

/** A turn starts: make the session's folder, and now and then measure the project's folders. */
export async function scratchTurnStart(runtime: Runtime) {
  const pad = runtime.workspace.scratch
  if (!pad) return
  await pad.ensure()
  watchFor(pad).start()
}

/** The size warning for the end of this turn, when a walk finished and crossed a step. */
export async function scratchTurnWarning(runtime: Runtime): Promise<string | undefined> {
  const pad = runtime.workspace.scratch
  if (!pad) return undefined
  const watch = watchFor(pad)
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([watch.settled(), new Promise((r) => (timer = setTimeout(r, SETTLE_MS)))])
  clearTimeout(timer)
  return watch.takeWarning()
}

/** At startup: delete session folders (every project) untouched for `keepDays`, never this session's. */
export async function pruneOldScratch(runtime: Runtime) {
  const pad = runtime.workspace.scratch
  if (!pad?.usable) return
  const days = (await loadConfig()).scratchpad?.keepDays ?? SCRATCH_KEEP_DAYS
  const mine = pad.dir()
  if (days > 0) await pruneScratch(pad.base, days, { skip: mine ? [path.dirname(mine)] : [] }).catch(() => 0)
}

/** `/scratch` shows the folders; `/scratch clear [all]` deletes the other sessions' (and this one's). */
export async function scratchCommand(runtime: Runtime, args: string): Promise<{ text: string; level: "info" | "error" }> {
  const pad = runtime.workspace.scratch
  if (!pad?.usable) return { text: "Thư mục tạm của phiên đang tắt (/config → Thư mục tạm của phiên).", level: "info" }
  const words = args.trim().split(/\s+/).filter(Boolean)
  if (words[0] === "clear") {
    const all = words[1] === "all"
    if (words.length > (all ? 2 : 1)) return { text: "Dùng: /scratch, /scratch clear hoặc /scratch clear all.", level: "error" }
    const { removed, spared } = await clearScratch(pad, { current: all })
    if (all) await pad.ensure()
    const kept = spared > 0 ? ` Giữ ${spared} phiên vừa có thay đổi trong 1 giờ qua (có thể là cửa sổ OpenTrading khác).` : ""
    return { text: `Đã xoá ${removed} thư mục phiên${all ? " (cả phiên này)" : ""}.${kept}`, level: "info" }
  }
  if (words.length > 0) return { text: "Dùng: /scratch, /scratch clear hoặc /scratch clear all.", level: "error" }
  const usage = await scratchUsage(pad)
  const days = (await loadConfig()).scratchpad?.keepDays ?? SCRATCH_KEEP_DAYS
  const prune = days > 0 ? `Phiên không đụng tới quá ${days} ngày được xoá khi mở OpenTrading (scratchpad.keepDays).` : "Không tự xoá phiên cũ (scratchpad.keepDays = 0)."
  const more = (partial: boolean) => (partial ? "hơn " : "")
  return {
    text: [
      `Thư mục tạm của phiên: ${pad.dir() ?? "(chưa có phiên)"}`,
      `Phiên này: ${more(usage.session.partial)}${formatSize(usage.session.bytes)} · ${usage.session.files} file`,
      `Cả dự án: ${more(usage.project.partial)}${formatSize(usage.project.bytes)} · ${usage.sessions} phiên (${pad.project})`,
      `${prune} /scratch clear xoá các phiên khác, /scratch clear all xoá cả phiên này.`,
    ].join("\n"),
    level: "info",
  }
}
