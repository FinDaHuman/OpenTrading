import { NativeImage } from "@opentui/core"
import { color } from "./theme"

const WIDTH = 120
const HEIGHT = 72
const STROKE_RADIUS = 4
const TREND_GREEN: Rgb = [120, 240, 104]

type Point = readonly [number, number]
type Rgb = readonly [number, number, number]

function hex(hexColor: string): Rgb {
  return [
    Number.parseInt(hexColor.slice(1, 3), 16),
    Number.parseInt(hexColor.slice(3, 5), 16),
    Number.parseInt(hexColor.slice(5, 7), 16),
  ]
}

function distanceToSegment(x: number, y: number, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared))
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t))
}

function insideTriangle(x: number, y: number, [a, b, c]: readonly [Point, Point, Point]): boolean {
  const cross = ([px, py]: Point, [qx, qy]: Point, [rx, ry]: Point) => (qx - px) * (ry - py) - (qy - py) * (rx - px)
  const p: Point = [x, y]
  const ab = cross(a, b, p)
  const bc = cross(b, c, p)
  const ca = cross(c, a, p)
  return (ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0)
}

/**
 * A fixed, anti-aliased market arrow drawn at image resolution. Rendering this
 * as a native image avoids the different diagonal shapes of terminal fonts.
 */
function drawTrendIcon(surface: Rgb): NativeImage {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
  const path: readonly Point[] = [
    [-6, 63],
    [36, 18],
    [52, 47],
    [67, 35],
    [82, 53],
    [100, 29],
  ]
  const arrow: readonly [Point, Point, Point] = [
    [118, 7],
    [91, 12],
    [106, 37],
  ]
  const samples = [
    [0.125, 0.125],
    [0.375, 0.125],
    [0.625, 0.125],
    [0.875, 0.125],
    [0.125, 0.375],
    [0.375, 0.375],
    [0.625, 0.375],
    [0.875, 0.375],
    [0.125, 0.625],
    [0.375, 0.625],
    [0.625, 0.625],
    [0.875, 0.625],
    [0.125, 0.875],
    [0.375, 0.875],
    [0.625, 0.875],
    [0.875, 0.875],
  ] as const

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let covered = 0
      for (const [sampleX, sampleY] of samples) {
        const sx = x + sampleX
        const sy = y + sampleY
        const onPath = path.some((point, index) => index > 0 && distanceToSegment(sx, sy, path[index - 1]!, point) <= STROKE_RADIUS)
        if (onPath || insideTriangle(sx, sy, arrow)) covered++
      }

      const alpha = covered / samples.length
      const offset = (y * WIDTH + x) * 4
      pixels[offset] = Math.round(surface[0] + (TREND_GREEN[0] - surface[0]) * alpha)
      pixels[offset + 1] = Math.round(surface[1] + (TREND_GREEN[1] - surface[1]) * alpha)
      pixels[offset + 2] = Math.round(surface[2] + (TREND_GREEN[2] - surface[2]) * alpha)
      pixels[offset + 3] = 255
    }
  }

  return NativeImage.fromPixels(pixels, WIDTH, HEIGHT, {
    stride: WIDTH * 4,
    format: "rgba8",
    alpha: "opaque",
  })
}

const idle = drawTrendIcon(hex(color.panel))
const pressed = drawTrendIcon(hex(color.rule))

export function submitTrendIcon(isPressed: boolean): NativeImage {
  return isPressed ? pressed : idle
}
