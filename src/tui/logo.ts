import { NativeImage } from "@opentui/core"
import { color } from "./theme"

const source = new URL("./assets/open-trading-candlestick-wordmark.png", import.meta.url)
const WHITE_THRESHOLD = 245
const TRIM_PADDING = 2
const TUI_BACKGROUND = {
  red: Number.parseInt(color.bg.slice(1, 3), 16),
  green: Number.parseInt(color.bg.slice(3, 5), 16),
  blue: Number.parseInt(color.bg.slice(5, 7), 16),
} as const

function isBackgroundWhite(red: number, green: number, blue: number): boolean {
  return (
    red >= WHITE_THRESHOLD &&
    green >= WHITE_THRESHOLD &&
    blue >= WHITE_THRESHOLD &&
    Math.max(red, green, blue) - Math.min(red, green, blue) <= 10
  )
}

/** Replace the source image's white matte with the exact terminal background. */
function compositeWhiteMatte(red: number, green: number, blue: number): [number, number, number] {
  const matte = Math.min(red, green, blue) / 255

  // Saturated candle pixels were never part of the white matte; preserve them
  // exactly. Near-white edge pixels are composited against the dark TUI surface
  // so they cannot leave a light halo.
  if (matte < 200 / 255) return [red, green, blue]

  return [
    Math.round(red - 255 * matte + TUI_BACKGROUND.red * matte),
    Math.round(green - 255 * matte + TUI_BACKGROUND.green * matte),
    Math.round(blue - 255 * matte + TUI_BACKGROUND.blue * matte),
  ]
}

/**
 * Re-matte the supplied wordmark on the exact TUI surface, then trim the
 * original white border. This avoids black rectangles in image-protocol
 * fallbacks that flatten transparent pixels against black.
 */
export async function loadOpenTradingWordmark(): Promise<NativeImage> {
  const original = await NativeImage.load(source)

  try {
    const raw = original.raw("rgba8")
    const pixels = new Uint8Array(raw.data)
    let left = original.width
    let right = -1
    let top = original.height
    let bottom = -1

    for (let y = 0; y < original.height; y++) {
      for (let x = 0; x < original.width; x++) {
        const offset = y * raw.stride + x * 4
        const red = pixels[offset]!
        const green = pixels[offset + 1]!
        const blue = pixels[offset + 2]!
        const isBackground = isBackgroundWhite(red, green, blue)
        const [compositedRed, compositedGreen, compositedBlue] = compositeWhiteMatte(red, green, blue)
        pixels[offset] = compositedRed
        pixels[offset + 1] = compositedGreen
        pixels[offset + 2] = compositedBlue
        pixels[offset + 3] = 255

        if (isBackground) continue

        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }

    const keyed = NativeImage.fromPixels(pixels, original.width, original.height, {
      stride: raw.stride,
      format: "rgba8",
      alpha: "opaque",
    })

    try {
      return keyed.extract({
        left: Math.max(0, left - TRIM_PADDING),
        top: Math.max(0, top - TRIM_PADDING),
        width: Math.min(original.width - 1, right + TRIM_PADDING) - Math.max(0, left - TRIM_PADDING) + 1,
        height: Math.min(original.height - 1, bottom + TRIM_PADDING) - Math.max(0, top - TRIM_PADDING) + 1,
      })
    } finally {
      keyed.dispose()
    }
  } finally {
    original.dispose()
  }
}
