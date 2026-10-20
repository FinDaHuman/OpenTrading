import { MacOSScrollAccel, type ScrollAcceleration, type ScrollBoxRenderable } from "@opentui/core"

/**
 * Transcript scrolling. OpenTUI's default is one row per wheel notch; opencode defaults to 3
 * (`scroll_speed`), the user picked 5. `scrollAcceleration` swaps in OpenTUI's macOS-style
 * curve (1 row per slow notch, up to 6× while the wheel spins fast), as opencode's option does.
 */

export const DEFAULT_SCROLL_SPEED = 5
/** /config cycles through these, then acceleration, then back. */
export const SCROLL_SPEEDS = [3, 5, 8] as const

export interface ScrollSetting {
  speed: number
  accelerate: boolean
}

export function scrollSetting(ui: { scrollSpeed?: number; scrollAcceleration?: boolean } | undefined): ScrollSetting {
  const speed = ui?.scrollSpeed
  return {
    speed: typeof speed === "number" && Number.isFinite(speed) && speed > 0 ? Math.min(speed, 50) : DEFAULT_SCROLL_SPEED,
    accelerate: ui?.scrollAcceleration === true,
  }
}

/** The next /config choice after `s`: 3 → 5 → 8 → accelerated → 3. */
export function nextScrollSetting(s: ScrollSetting): ScrollSetting {
  if (s.accelerate) return { speed: SCROLL_SPEEDS[0], accelerate: false }
  const next = SCROLL_SPEEDS.find((n) => n > s.speed)
  return next ? { speed: next, accelerate: false } : { speed: s.speed, accelerate: true }
}

export function scrollAcceleration(s: ScrollSetting): ScrollAcceleration {
  if (s.accelerate) return new MacOSScrollAccel()
  return { tick: () => s.speed, reset: () => {} }
}

export function describeScroll(s: ScrollSetting) {
  return s.accelerate ? "Tăng tốc khi lăn nhanh (1–6 dòng/nấc)" : `${s.speed} dòng mỗi nấc lăn`
}

let transcript: ScrollBoxRenderable | undefined

/** The transcript registers its scrollbox here so the app's keys can move it. */
export function attachTranscript(box: ScrollBoxRenderable | undefined) {
  transcript = box
}

export type ScrollMove = "page-up" | "page-down" | "top" | "bottom"

/** PageUp/PageDown move half a screen (opencode); top and bottom jump. False: no transcript. */
export function scrollTranscript(move: ScrollMove): boolean {
  const box = transcript
  if (!box || box.isDestroyed) return false
  const half = Math.max(1, Math.floor(box.viewport.height / 2))
  if (move === "page-up") box.scrollBy(-half)
  else if (move === "page-down") box.scrollBy(half)
  else if (move === "top") box.scrollTo(0)
  // At the bottom the box sticks to it again: new text keeps it there.
  else box.scrollTo(box.scrollHeight)
  return true
}
