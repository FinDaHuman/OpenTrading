/**
 * A paste the terminal sent as keystrokes (#353). Without bracketed paste (an old terminal, some
 * SSH or multiplexer setups) a pasted text arrives as typed keys, and the Enter inside it would
 * send the prompt half way. Codex CLI tells such a burst by its speed: characters closer together
 * than any typist manages. Here an Enter that comes inside such a burst is held for BURST_HOLD_MS:
 * a key right behind it makes it a line break; no key, and it sends as usual. Keys a busy app read
 * all at once (the user typed while it was drawing) end in the user's Enter, with nothing behind
 * it, so they still send. Nothing else changes: the characters are typed as they come.
 *
 * The thresholds keep a fast typist and a Vietnamese input method out: Telex/VNI send a Backspace
 * and the composed letter together, two or three keys at once, never BURST_MIN_KEYS in a row with
 * gaps under BURST_GAP_MS. The clock is passed in, so tests do not depend on a machine's speed.
 */

/** At most this many ms between two keys of a burst. A fast typist is around 50 ms apart. */
export const BURST_GAP_MS = 8
/** Keys in a row, each within BURST_GAP_MS of the one before, before it counts as a paste. */
export const BURST_MIN_KEYS = 16
/** How long an Enter inside a burst waits for the paste to go on before it sends. */
export const BURST_HOLD_MS = 30

export class PasteBurst {
  private last = -Infinity
  private run = 0

  constructor(private now: () => number = () => performance.now()) {}

  /** A key that types a character (not Enter, not a shortcut). */
  key() {
    const at = this.now()
    this.run = at - this.last <= BURST_GAP_MS ? this.run + 1 : 1
    this.last = at
  }

  /** Whether an Enter now is part of a paste: a long enough burst, and the Enter right after it. */
  enterIsPaste(): boolean {
    const at = this.now()
    const inside = this.run >= BURST_MIN_KEYS && at - this.last <= BURST_GAP_MS
    // The Enter is one more key of the burst: the next line's characters keep it going.
    if (inside) this.last = at
    else this.run = 0
    return inside
  }
}
