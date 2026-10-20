import { writeSync } from "node:fs"
import type { CliRenderer, ProgramStatus } from "@opentui/core"

/**
 * Telling the terminal what the agent is doing, for when the user looks at another window
 * (opencode's attention.ts, codex's notifications, Claude Code's program status):
 *
 * - the tab/taskbar progress ring (OSC 9;4) while a turn runs, yellow while it waits for the
 *   user — only on terminals known to draw it, since others (iTerm2) show OSC 9 as a
 *   notification;
 * - OSC 7501 program status (working / blocked / done), ignored where unsupported;
 * - a desktop notification when a turn ends, an approval or a question waits, or a turn
 *   fails — only while the terminal window is not focused, at most once per kind until the
 *   user comes back.
 *
 * The progress ring is cleared on every way out, or Windows Terminal keeps spinning.
 */

export type AttentionKind = "done" | "error" | "approval" | "question"
export type Busy = "idle" | "working" | "permission" | "question"

export interface AttentionDeps {
  /** Raw bytes to the terminal (OSC 9;4). */
  write(sequence: string): void
  /** A desktop notification; false when the terminal took none. */
  notify(message: string, title: string): boolean
  status(status: ProgramStatus): void
  /** The terminal draws OSC 9;4 progress. */
  progress: boolean
}

const PROGRESS = { off: "\x1b]9;4;0;0\x07", working: "\x1b]9;4;3;0\x07", waiting: "\x1b]9;4;4;100\x07" } as const
const TITLE = "OpenTrading"

/** Terminals that draw OSC 9;4 (and do not turn other OSC 9 into a notification). */
export function drawsProgress(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.WT_SESSION) || env.ConEmuANSI === "ON" || env.TERM_PROGRAM === "ghostty"
}

export class Attention {
  /** undefined until the terminal reports focus: unknown counts as looking (no notification). */
  private focused: boolean | undefined
  private shown: keyof typeof PROGRESS = "off"
  private sent = new Set<AttentionKind>()

  constructor(
    private deps: AttentionDeps,
    private enabled: () => boolean,
  ) {}

  /** What the agent is doing now; only changes reach the terminal. Turned off: always idle. */
  setBusy(busy: Busy) {
    if (!this.enabled()) busy = "idle"
    const next = busy === "idle" ? "off" : busy === "working" ? "working" : "waiting"
    if (next !== this.shown && this.deps.progress) this.deps.write(PROGRESS[next])
    this.shown = next
    this.deps.status(
      busy === "idle"
        ? { state: "idle", app: "opentrading", title: TITLE }
        : busy === "working"
          ? { state: "working", app: "opentrading", title: TITLE }
          : { state: "blocked", kind: busy, app: "opentrading", title: TITLE },
    )
  }

  focus(focused: boolean) {
    this.focused = focused
    if (focused) this.sent.clear()
  }

  /** Something worth coming back for. Sent only while the window is known to be elsewhere. */
  attention(kind: AttentionKind, message: string) {
    if (!this.enabled() || this.focused !== false || this.sent.has(kind)) return
    this.sent.add(kind)
    if (kind === "done" || kind === "error") this.deps.status({ state: kind, app: "opentrading", title: TITLE, message })
    this.deps.notify(message, TITLE)
  }

  /** On the way out: no ring left spinning, no status left behind. */
  clear() {
    if (this.shown !== "off" && this.deps.progress) this.deps.write(PROGRESS.off)
    this.shown = "off"
    this.deps.status({ state: "clear" })
  }
}

/** The real terminal behind a renderer. */
export function terminalAttention(renderer: CliRenderer, enabled: () => boolean): Attention {
  const progress = drawsProgress() && Boolean(process.stdout.isTTY)
  const attention = new Attention(
    {
      write: (sequence) => void process.stdout.write(sequence),
      notify: (message, title) => renderer.triggerNotification(message, title),
      status: (status) => {
        try {
          renderer.setProgramStatus(status)
        } catch {
          // An invalid or unsupported report must never break the app.
        }
      },
      progress,
    },
    enabled,
  )
  // A crash or process.exit skips the app's own exit path: never leave the ring spinning.
  // Synchronous, since an exit handler gets no further turn of the event loop.
  if (progress)
    process.once("exit", () => {
      try {
        writeSync(1, PROGRESS.off)
      } catch {
        // stdout already gone: nothing left to clear.
      }
    })
  return attention
}
