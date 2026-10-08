/** Decorative OHLC tapes, measured in terminal cells. No market data is used. */
export interface ChartRect {
  x: number
  y: number
  width: number
  height: number
}

export interface MarketCandle {
  id: string
  stream: number
  x: number
  width: number
  openY: number
  closeY: number
  highY: number
  lowY: number
  rising: boolean
  opacity: number
}

export interface MarketStream {
  id: number
  side: "top" | "right" | "bottom" | "left"
  corridor: ChartRect
  candles: MarketCandle[]
}

export interface MarketVolumeBar {
  x: number
  width: number
  height: number
  rising: boolean
  opacity: number
}

export interface MarketScene {
  width: number
  height: number
  exclusion: ChartRect
  streams: MarketStream[]
  volumeTop: number
  volume: MarketVolumeBar[]
}

interface SceneOptions {
  width: number
  height: number
  card: ChartRect
  volumeBounds?: Pick<ChartRect, "x" | "width">
  time: number
  seed: number
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (t: number) => t * t * (3 - 2 * t)

// Random access makes a candle stable while it travels and across resizes.
function random(seed: number, index: number): number {
  let value = Math.imul(seed ^ index, 0x45d9f3b)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000
}

function noise(seed: number, x: number): number {
  const whole = Math.floor(x)
  return lerp(random(seed, whole), random(seed, whole + 1), smooth(x - whole)) * 2 - 1
}

function price(seed: number, index: number): number {
  const phaseA = random(seed ^ 3251, 0) * Math.PI * 2
  const phaseB = random(seed ^ 6571, 0) * Math.PI * 2
  return (
    Math.sin(index * 0.58 + phaseA) * 0.58 +
    Math.sin(index * 0.23 + phaseB) * 0.27 +
    noise(seed ^ 7919, index / 2.2) * 0.15
  )
}

export function candleBounds(candle: MarketCandle): ChartRect {
  return { x: candle.x - candle.width / 2, y: candle.highY, width: candle.width, height: candle.lowY - candle.highY }
}

export function intersects(a: ChartRect, b: ChartRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/**
 * Two origins per edge of the card. Top and bottom tapes split left/right;
 * side tapes travel outwards. Every chart reads horizontally. Disjoint
 * corridors include the complete candle wicks and an antialiasing gutter.
 */
export function createMarketScene({ width, height, card, volumeBounds, time, seed }: SceneOptions): MarketScene {
  const exclusion = { x: card.x - 1.25, y: card.y - 0.55, width: card.width + 2.5, height: card.height + 1.1 }
  const volumeHeight = clamp((height - 12) * 0.085, 0.55, 2.2)
  const volumeTop = height - volumeHeight
  const scene: MarketScene = { width, height, exclusion, streams: [], volumeTop, volume: [] }
  const padX = Math.min(1.5, width * 0.025)
  const padY = Math.min(0.8, height * 0.04)
  const cardLeft = clamp(card.x, padX, width - padX)
  const cardRight = clamp(card.x + card.width, cardLeft, width - padX)
  const cardTop = clamp(card.y, padY, height - padY)
  const cardBottom = clamp(card.y + card.height, cardTop, height - padY)
  const centerY = (cardTop + cardBottom) / 2

  for (const side of ["top", "right", "bottom", "left"] as const) {
    const split = side === "top" || side === "bottom"
    for (let lane = 0; lane < 2; lane++) {
      const id = scene.streams.length
      const direction = split ? (lane === 0 ? -1 : 1) : (side === "left" ? -1 : 1)
      const start = split
        ? lerp(cardLeft, cardRight, lane === 0 ? 0.28 : 0.72)
        : (side === "left" ? cardLeft - 1.35 : cardRight + 1.35)
      const end = direction < 0 ? padX : width - padX
      const length = Math.max(0, (end - start) * direction)
      const crossStart = side === "top" ? padY : side === "bottom" ? cardBottom + 1 : lane === 0 ? cardTop + 0.3 : centerY + 0.6
      const crossEnd = side === "top" ? cardTop - 1 : side === "bottom" ? Math.min(height - padY, volumeTop - 0.35) : lane === 0 ? centerY - 0.6 : cardBottom - 0.3
      const crossSize = Math.max(0, crossEnd - crossStart)
      const corridor: ChartRect = { x: Math.min(start, end), y: crossStart, width: length, height: crossSize }
      const stream: MarketStream = { id, side, corridor, candles: [] }
      scene.streams.push(stream)
      if (length < 0.7 || crossSize < 1) continue

      const salt = seed ^ Math.imul(id + 1, 104729)
      const pitch = clamp(width / 58, 1.8, 2.8)
      // Keep the candle silhouette close to a real chart: a compact body with
      // enough air between neighbours for the centered wick to stay legible.
      const bodyWidth = clamp(pitch * 0.54, 0.82, 1.3)
      const clock = Math.max(0, time) * (0.5 + random(salt, 1) * 0.2) + random(salt, 2)
      const tick = Math.floor(clock)
      const fraction = clock - tick
      for (let slot = 0; slot <= Math.ceil(length / pitch); slot++) {
        const travel = (slot + fraction) * pitch
        if (travel > length) continue
        const progress = travel / length
        const sequence = tick - slot + 100000
        const open = price(salt, sequence)
        const close = price(salt, sequence + 1)
        const rising = close >= open
        const move = Math.abs(close - open)
        const breakout = random(salt ^ 97, sequence) > 0.91 ? 1.6 : 1
        const body = Math.max(0.28, Math.min(2.5, (0.28 + move * 3.35) * breakout))
        const upperWick = 0.2 + random(salt ^ 17, sequence) * 0.5 + (random(salt ^ 107, sequence) > 0.94 ? 0.48 : 0)
        const lowerWick = 0.2 + random(salt ^ 37, sequence) * 0.5 + (random(salt ^ 127, sequence) > 0.94 ? 0.48 : 0)
        const maxHeight = Math.min(3.65, crossSize * 0.66)
        const scale = Math.min(1, maxHeight / (body + upperWick + lowerWick))
        const bodyHeight = body * scale
        const upper = upperWick * scale
        const lower = lowerWick * scale
        const x = start + direction * travel
        const topLimit = crossStart + upper + bodyHeight / 2
        const bottomLimit = crossEnd - lower - bodyHeight / 2
        const availableSpan = Math.max(0, bottomLimit - topLimit)
        const trendRise = Math.min(4.8, availableSpan * 0.58)
        const swing = Math.min(2.8, availableSpan * 0.22)
        // Trend is measured from the card outwards. Left-going streams therefore
        // rise right-to-left, mirroring the right-going streams instead of using
        // one fixed screen-space direction.
        const base = (topLimit + bottomLimit) / 2 + (0.5 - progress) * trendRise
        const middle = clamp(base - (open + close) / 2 * swing, topLimit, bottomLimit)
        const candle: MarketCandle = {
          id: `${id}:${sequence}`,
          stream: id,
          x,
          width: bodyWidth,
          openY: middle + (rising ? bodyHeight : -bodyHeight) / 2,
          closeY: middle - (rising ? bodyHeight : -bodyHeight) / 2,
          highY: middle - bodyHeight / 2 - upper,
          lowY: middle + bodyHeight / 2 + lower,
          rising,
          opacity: (0.68 + random(salt ^ 67, sequence) * 0.12) * (1 - 0.1 * smooth(progress)),
        }
        const bounds = candleBounds(candle)
        if (bounds.x >= corridor.x && bounds.x + bounds.width <= corridor.x + corridor.width && bounds.y >= corridor.y && bounds.y + bounds.height <= corridor.y + corridor.height && !intersects(bounds, exclusion)) {
          stream.candles.push(candle)
        }
      }
    }
  }

  // A shallow volume tape sits directly on top of the composer. It scrolls
  // independently from the eight price branches and stays in a reserved strip.
  const volumeSalt = seed ^ 0x51f15e
  const volumeLeft = clamp(volumeBounds?.x ?? 2, 0, width)
  const volumeRight = clamp(volumeLeft + (volumeBounds?.width ?? width - 4), volumeLeft, width)
  const volumePitch = clamp((volumeRight - volumeLeft) / 108, 1.15, 1.65)
  const volumeWidth = volumePitch * 0.72
  for (let slot = 0, x = volumeLeft + volumeWidth / 2; x <= volumeRight - volumeWidth / 2; slot++, x += volumePitch) {
    const sequence = slot + 200000
    const activity = 0.2 + random(volumeSalt ^ 17, sequence) * 0.42
    const spike = random(volumeSalt ^ 37, sequence) > 0.94 ? 0.42 : 0
    const wave = Math.sin(slot * 0.42 + time * 1.8) * 0.045 + Math.sin(slot * 0.17 - time * 1.1) * 0.025
    scene.volume.push({
      x,
      width: volumeWidth,
      height: clamp(volumeHeight * (activity + spike + wave), 0.18, volumeHeight),
      rising: price(volumeSalt, sequence + 1) >= price(volumeSalt, sequence),
      opacity: 0.3 + random(volumeSalt ^ 67, sequence) * 0.14,
    })
  }
  return scene
}
