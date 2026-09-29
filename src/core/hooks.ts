import type { ModelMessage } from "ai"

/**
 * In-process lifecycle hooks (the Claude Code / Codex event names, without shell hooks).
 * Memory providers and future extensions plug in here instead of editing the agent loop.
 */
export type HookEvent =
  | { type: "session-start"; sessionId: string; source: "startup" | "resume" | "clear" }
  | { type: "user-prompt"; sessionId: string; prompt: string }
  | { type: "turn-end"; sessionId: string; messages: ModelMessage[] }
  | { type: "session-end"; sessionId: string }

export interface HookResult {
  /** user-prompt only: refuse the turn with this reason; nothing is sent to the model. */
  block?: string
  /** user-prompt only: extra context for this turn, sent as a reminder (capped). */
  additionalContext?: string
}

export type Hook<E extends HookEvent = HookEvent> = (event: E) => HookResult | void | Promise<HookResult | void>

/** Max characters of hook context per turn (~2,500 tokens, as in Codex). */
export const MAX_HOOK_CONTEXT_CHARS = 10_000
const HOOK_TIMEOUT_MS = 5_000

export interface HookOutcome {
  block?: string
  context: string[]
  errors: string[]
}

export class HookBus {
  private hooks = new Map<HookEvent["type"], Hook[]>()

  on<T extends HookEvent["type"]>(type: T, hook: Hook<Extract<HookEvent, { type: T }>>) {
    const list = this.hooks.get(type) ?? []
    list.push(hook as Hook)
    this.hooks.set(type, list)
    return () => this.hooks.set(type, (this.hooks.get(type) ?? []).filter((h) => h !== hook))
  }

  /**
   * Run every hook for the event in registration order. A hook that throws or takes longer
   * than 5s is reported in `errors` and skipped — one broken extension never breaks a turn.
   */
  async emit(event: HookEvent): Promise<HookOutcome> {
    const outcome: HookOutcome = { context: [], errors: [] }
    for (const hook of this.hooks.get(event.type) ?? []) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await Promise.race([
          Promise.resolve(hook(event)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("quá 5 giây")), HOOK_TIMEOUT_MS)
          }),
        ])
        if (result?.block && !outcome.block) outcome.block = result.block
        if (result?.additionalContext?.trim()) outcome.context.push(result.additionalContext.trim())
      } catch (error) {
        outcome.errors.push(`Hook ${event.type} lỗi: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        clearTimeout(timer)
      }
    }
    const joined = outcome.context.join("\n\n")
    if (joined.length > MAX_HOOK_CONTEXT_CHARS) {
      outcome.context = [joined.slice(0, MAX_HOOK_CONTEXT_CHARS) + "\n[… đã cắt bớt]"]
    }
    return outcome
  }
}
