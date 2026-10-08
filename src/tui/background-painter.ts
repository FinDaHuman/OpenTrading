import { color } from "./theme"
import { type MarketScene } from "./background-market"

type RGB = readonly [number, number, number]
const rgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const BG = rgb(color.bg)
const GREEN = rgb(color.tang)
const RED = rgb(color.giam)
const GRID = rgb(color.rule)

/** Reusable raster surface: thin wicks, solid candle bodies, no font dependence. */
export class MarketPainter {
  readonly pixels: Uint8Array
  private readonly words: Uint32Array

  constructor(readonly width: number, readonly height: number) {
    this.pixels = new Uint8Array(width * height * 4)
    this.words = new Uint32Array(this.pixels.buffer)
  }

  private pixel(x: number, y: number, tint: RGB, opacity: number) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height || opacity <= 0) return
    const i = (y * this.width + x) * 4
    const alpha = Math.min(1, opacity)
    for (let channel = 0; channel < 3; channel++) {
      this.pixels[i + channel] = Math.round(this.pixels[i + channel]! * (1 - alpha) + tint[channel]! * alpha)
    }
  }

  private rect(x: number, y: number, width: number, height: number, tint: RGB, opacity: number) {
    for (let py = Math.max(0, Math.floor(y)); py < Math.min(this.height, Math.ceil(y + height)); py++) {
      const dy = Math.max(0, Math.min(py + 1, y + height) - Math.max(py, y))
      for (let px = Math.max(0, Math.floor(x)); px < Math.min(this.width, Math.ceil(x + width)); px++) {
        const dx = Math.max(0, Math.min(px + 1, x + width) - Math.max(px, x))
        this.pixel(px, py, tint, opacity * dx * dy)
      }
    }
  }

  paint(scene: MarketScene, quiet = false): Uint8Array {
    this.words.fill((255 << 24) | (BG[2] << 16) | (BG[1] << 8) | BG[0])
    const sx = this.width / scene.width
    const sy = this.height / scene.height
    const dim = quiet ? 0.2 : 1

    for (let y = 1.5; y < scene.height; y += 3) {
      for (let x = 2; x < scene.width; x += 6) {
        if (x > scene.exclusion.x && x < scene.exclusion.x + scene.exclusion.width && y > scene.exclusion.y && y < scene.exclusion.y + scene.exclusion.height) continue
        this.rect(x * sx, y * sy, Math.max(1, sx * 0.12), Math.max(1, sy * 0.06), GRID, 0.7 * dim)
      }
    }

    for (const bar of scene.volume) {
      this.rect(
        (bar.x - bar.width / 2) * sx,
        (scene.height - bar.height) * sy,
        bar.width * sx,
        bar.height * sy,
        bar.rising ? GREEN : RED,
        bar.opacity * dim,
      )
    }

    for (const stream of scene.streams) {
      for (const candle of stream.candles) {
        const tint = candle.rising ? GREEN : RED
        const opacity = candle.opacity * dim
        const x = candle.x * sx
        const top = Math.min(candle.openY, candle.closeY) * sy
        const bottom = Math.max(candle.openY, candle.closeY) * sy
        const bodyWidth = candle.width * sx
        const wickWidth = Math.max(1, Math.min(1.5, sx * 0.15))

        this.rect(x - wickWidth / 2, candle.highY * sy, wickWidth, top - candle.highY * sy, tint, opacity * 0.9)
        this.rect(x - wickWidth / 2, bottom, wickWidth, candle.lowY * sy - bottom, tint, opacity * 0.9)
        this.rect(x - bodyWidth / 2, top, bodyWidth, bottom - top, tint, opacity)
      }
    }
    return this.pixels
  }
}
