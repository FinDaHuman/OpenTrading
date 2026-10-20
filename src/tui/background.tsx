import { FrameBufferRenderable, RGBA, type OptimizedBuffer, type RenderContext } from "@opentui/core"
import { extend, useRenderer } from "@opentui/solid"
import { createEffect, onCleanup } from "solid-js"
import { color, mix } from "./theme"

/**
 * "Tape" background: a faint board grid with three drifting price-like traces
 * drawn in braille, and a slow scan beam. Purely decorative — no numbers, so it
 * can never be mistaken for market data.
 */

// Braille characters for a single dot in sub-rows 0..3 of a cell (left column).
const DOTS = ["⠁", "⠂", "⠄", "⡀"]

interface Trace {
  tint: string
  strength: number
  speed: number
  freqs: [number, number, number]
  phase: number
  offset: number
}

const TRACES: Trace[] = [
  { tint: color.tang, strength: 0.55, speed: 0.9, freqs: [0.045, 0.11, 0.023], phase: 0, offset: -0.18 },
  { tint: color.san, strength: 0.4, speed: 0.6, freqs: [0.037, 0.083, 0.017], phase: 2.1, offset: 0.12 },
  { tint: color.tran, strength: 0.3, speed: 0.4, freqs: [0.029, 0.067, 0.013], phase: 4.4, offset: 0.3 },
]

const BG = RGBA.fromHex(color.bg)

// Colours are quantised to 32 steps and cached so a frame allocates nothing.
const shades = new Map<string, RGBA[]>()
function shade(tint: string, k: number): RGBA {
  let ramp = shades.get(tint)
  if (!ramp) {
    ramp = Array.from({ length: 33 }, (_, i) => mix(color.bg, tint, i / 32))
    shades.set(tint, ramp)
  }
  return ramp[Math.max(0, Math.min(32, Math.round(k * 32)))]!
}

type TapeOptions = Omit<ConstructorParameters<typeof FrameBufferRenderable>[1], "width" | "height"> & {
  width?: number | `${number}%` | "auto"
  height?: number | `${number}%` | "auto"
  calm?: number
  animate?: boolean
}

class TapeRenderable extends FrameBufferRenderable {
  private t = 0
  /** Quietness in the centre so foreground text stays readable (0..1). */
  private _calm = 0.75
  private still = false
  /** A still tape repaints only when its buffer was resized (and so cleared). */
  private stale = true

  constructor(ctx: RenderContext, options: TapeOptions) {
    const { width, height, calm, animate, ...rest } = options
    super(ctx, {
      ...rest,
      width: typeof width === "number" ? width : 1,
      height: typeof height === "number" ? height : 1,
      live: animate !== false,
      respectAlpha: false,
    })
    this.still = animate === false
    if (width !== undefined && typeof width !== "number") this.width = width
    if (height !== undefined && typeof height !== "number") this.height = height
    if (calm !== undefined) this.calm = calm
  }

  /**
   * Off: the tape keeps its last frame and stops the renderer's frame loop (a live renderable
   * keeps it drawing the whole screen 24 times a second), so the renderer draws on demand and
   * a wheel notch shows at once instead of on the next tick.
   */
  set animate(value: boolean) {
    this.still = !value
    this.live = value
  }

  get calm() {
    return this._calm
  }

  set calm(value: number) {
    if (this._calm === value) return
    this._calm = value
    this.stale = true
    this.requestRender()
  }

  protected override onResize(width: number, height: number): void {
    super.onResize(width, height)
    this.stale = true
  }

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime = 0): void {
    if (!this.visible || this.isDestroyed) return
    if (!this.still) {
      this.t += Math.min(deltaTime, 100) / 1000
      this.paint(this.frameBuffer)
    } else if (this.stale) {
      this.paint(this.frameBuffer)
    }
    this.stale = false
    super.renderSelf(buffer)
  }

  /** 1 at the edges, lower near the centre. */
  private falloff(x: number, y: number, w: number, h: number) {
    const dx = (x / w - 0.5) * 2
    const dy = (y / h - 0.5) * 2
    const d = Math.min(1, Math.sqrt(dx * dx * 0.8 + dy * dy * 1.4))
    return 1 - this.calm + this.calm * d
  }

  private paint(fb: OptimizedBuffer) {
    const w = fb.width
    const h = fb.height
    const t = this.t
    fb.clear(BG)

    // Scan beam sweeping left → right.
    const beam = ((t * 9) % (w + 60)) - 30
    for (let x = Math.max(0, Math.floor(beam - 14)); x < Math.min(w, beam + 14); x++) {
      const k = 1 - Math.abs(x - beam) / 14
      fb.fillRect(x, 0, 1, h, shade(color.bg2, k * k))
    }

    // Board grid dots.
    const dot = shade(color.rule, 0.9)
    for (let y = 1; y < h; y += 3) {
      for (let x = 2; x < w; x += 6) fb.setCell(x, y, "·", dot, BG)
    }

    // Price-like traces, scrolling left like a ticker tape.
    for (const tr of TRACES) {
      for (let x = 0; x < w; x++) {
        const u = x + t * tr.speed * 12
        const v =
          Math.sin(u * tr.freqs[0] + tr.phase) * 0.5 +
          Math.sin(u * tr.freqs[1] + tr.phase * 1.7) * 0.22 +
          Math.sin(u * tr.freqs[2] + t * 0.3) * 0.28
        const sub = (0.5 + tr.offset + v * 0.26) * h * 4
        const row = Math.floor(sub / 4)
        if (row < 0 || row >= h) continue
        const k = tr.strength * this.falloff(x, row, w, h) * (0.55 + 0.45 * Math.sin(x * 0.05 - t * 1.3) ** 2)
        fb.setCell(x, row, DOTS[Math.floor(sub) & 3]!, shade(tr.tint, k), BG)
      }
    }
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    ot_tape: typeof TapeRenderable
  }
}

extend({ ot_tape: TapeRenderable })

/**
 * `quiet` (a conversation is on screen) dims the centre further and holds the tape still:
 * the animation runs on Home only, and the chat is drawn on demand, like Claude Code.
 */
export function Background(props: { quiet?: boolean }) {
  const renderer = useRenderer()
  let prev: number | undefined
  createEffect(() => {
    if (props.quiet) {
      if (prev !== undefined) renderer.targetFps = prev
      prev = undefined
    } else if (prev === undefined) {
      prev = renderer.targetFps
      renderer.targetFps = 24
    }
  })
  onCleanup(() => {
    if (prev !== undefined) renderer.targetFps = prev
  })
  return (
    <ot_tape
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      zIndex={0}
      calm={props.quiet ? 0.93 : 0.72}
      animate={!props.quiet}
    />
  )
}
