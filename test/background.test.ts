import { expect, test } from "bun:test"
import { candleBounds, createMarketScene, intersects, type MarketScene } from "../src/tui/background-market"
import { MarketPainter } from "../src/tui/background-painter"

function sceneAt(width = 158, height = 41, time = 0, seed = 4107) {
  return createMarketScene({
    width,
    height: height - 5,
    card: { x: (width - 60) / 2, y: Math.floor((height - 4 - 12) / 2), width: 60, height: 12 },
    volumeBounds: { x: 2, width: width - 4 },
    time,
    seed,
  })
}

test("eight chart streams originate in pairs on the four card edges", () => {
  const scene = sceneAt()
  expect(scene.streams.map((stream) => stream.side)).toEqual(["top", "top", "right", "right", "bottom", "bottom", "left", "left"])
  for (const stream of scene.streams) {
    expect(stream.candles.length).toBeGreaterThan(2)
    const nearest = stream.candles[0]!
    const furthest = stream.candles.at(-1)!
    const goesLeft = stream.side === "left" || ((stream.side === "top" || stream.side === "bottom") && stream.id % 2 === 0)
    expect(furthest.x < nearest.x).toBe(goesLeft)
    if (stream.side === "top") expect(nearest.lowY).toBeLessThan(scene.exclusion.y)
    if (stream.side === "bottom") expect(nearest.highY).toBeGreaterThan(scene.exclusion.y + scene.exclusion.height)
  }
})

test("random flow keeps full candle bodies and both wicks separate at different sizes and times", () => {
  for (const [width, height] of [[80, 24], [100, 32], [158, 41], [220, 60]]) {
    for (const seed of [1, 29, 4107, 97813, 0x7fffffff]) {
      for (const time of [0, 0.37, 1.5, 7, 18.75, 63, 1000]) {
        const scene = sceneAt(width, height, time, seed)
        const candles = scene.streams.flatMap((stream) => stream.candles)
        const failures: string[] = []
        for (let i = 0; i < scene.streams.length; i++) {
          for (let j = i + 1; j < scene.streams.length; j++) {
            if (intersects(scene.streams[i]!.corridor, scene.streams[j]!.corridor)) failures.push(`corridor ${i}/${j}`)
          }
        }
        for (const stream of scene.streams) {
          if (!stream.candles.length) failures.push(`empty ${stream.id}`)
          for (const candle of stream.candles) {
            const bounds = candleBounds(candle)
            if (intersects(bounds, scene.exclusion)) failures.push(`card ${candle.id}`)
            if (bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > width! || bounds.y + bounds.height > scene.height) failures.push(`viewport ${candle.id}`)
            if (candle.highY >= Math.min(candle.openY, candle.closeY) || candle.lowY <= Math.max(candle.openY, candle.closeY)) failures.push(`missing wick ${candle.id}`)
            if (candle.rising !== (candle.closeY < candle.openY)) failures.push(`direction ${candle.id}`)
          }
        }
        for (let i = 0; i < candles.length; i++) {
          for (let j = i + 1; j < candles.length; j++) {
            if (intersects(candleBounds(candles[i]!), candleBounds(candles[j]!))) failures.push(`collision ${candles[i]!.id}/${candles[j]!.id}`)
          }
        }
        expect(failures).toEqual([])
      }
    }
  }
})

test("candles use substantial bodies, fine wicks, and varied market-sized moves", () => {
  const candles = [1, 29, 4107, 97813].flatMap((seed) => sceneAt(158, 41, 14, seed).streams.flatMap((stream) => stream.candles))
  const bodies = candles.map((candle) => Math.abs(candle.closeY - candle.openY))
  expect(Math.min(...candles.map((candle) => candle.width))).toBeGreaterThanOrEqual(0.82)
  expect(Math.min(...bodies)).toBeLessThan(0.6)
  expect(Math.max(...bodies)).toBeGreaterThan(1.9)
  expect(candles.every((candle) => candle.highY < Math.min(candle.openY, candle.closeY))).toBe(true)
  expect(candles.every((candle) => candle.lowY > Math.max(candle.openY, candle.closeY))).toBe(true)
})

test("a shallow red-green volume tape is reserved directly above the composer", () => {
  for (const [width, height] of [[80, 24], [158, 41], [220, 60]]) {
    const scene = sceneAt(width, height, 5)
    expect(scene.volume.length).toBeGreaterThan(20)
    expect(scene.volume.some((bar) => bar.rising)).toBe(true)
    expect(scene.volume.some((bar) => !bar.rising)).toBe(true)
    expect(Math.max(...scene.volume.map((bar) => bar.height))).toBeLessThanOrEqual(2.2)
    expect(Math.min(...scene.volume.map((bar) => bar.height))).toBeGreaterThan(0)
    expect(Math.min(...scene.volume.map((bar) => bar.x - bar.width / 2))).toBeGreaterThanOrEqual(2)
    expect(Math.max(...scene.volume.map((bar) => bar.x + bar.width / 2))).toBeLessThanOrEqual(width - 2)
    expect(scene.streams.flatMap((stream) => stream.candles).every((candle) => candle.lowY < scene.volumeTop)).toBe(true)
  }
})

test("volume bars stay fixed horizontally and pulse with a small waveform", () => {
  const before = sceneAt(158, 41, 5).volume
  const after = sceneAt(158, 41, 5.4).volume
  expect(after.map((bar) => bar.x)).toEqual(before.map((bar) => bar.x))
  const movement = before.map((bar, index) => Math.abs(after[index]!.height - bar.height))
  expect(Math.max(...movement)).toBeGreaterThan(0.01)
  expect(Math.max(...movement)).toBeLessThan(0.2)
})

test("candles travel away from the card without being regenerated each frame", () => {
  const before = sceneAt(158, 41, 5)
  const after = sceneAt(158, 41, 5.1)
  for (const stream of before.streams) {
    const old = stream.candles[Math.floor(stream.candles.length / 2)]!
    const next = after.streams[stream.id]!.candles.find((candle) => candle.id === old.id)!
    expect(next).toBeDefined()
    expect(next.rising).toBe(old.rising)
    expect(Math.abs(next.closeY - next.openY)).toBeCloseTo(Math.abs(old.closeY - old.openY), 6)
    const goesLeft = stream.side === "left" || ((stream.side === "top" || stream.side === "bottom") && stream.id % 2 === 0)
    expect(next.x < old.x).toBe(goesLeft)
    expect(Math.abs(next.x - old.x)).toBeLessThan(0.3)
  }
})

test("every branch rises away from the card with visible pullbacks and longer candles", () => {
  for (const seed of [1, 29, 4107, 97813]) {
    for (const time of [0, 5, 14, 31]) {
      const scene = sceneAt(158, 41, time, seed)
      for (const stream of scene.streams) {
        const ordered = stream.candles
        const sample = Math.max(1, Math.floor(ordered.length / 4))
        const average = (values: typeof ordered) => values.reduce((sum, candle) => sum + candle.closeY, 0) / values.length
        expect(average(ordered.slice(-sample))).toBeLessThan(average(ordered.slice(0, sample)))
        expect(ordered.some((candle) => candle.rising)).toBe(true)
        expect(ordered.some((candle) => !candle.rising)).toBe(true)
        expect(Math.max(...ordered.map((candle) => candle.lowY - candle.highY))).toBeGreaterThan(1.65)
      }
    }
  }
})

test("raster colours follow candle close/open direction, with quieter chat mode", () => {
  const scene: MarketScene = {
    width: 10, height: 4, exclusion: { x: -20, y: -20, width: 1, height: 1 },
    volumeTop: 4, volume: [],
    streams: [{ id: 0, side: "left", corridor: { x: 0, y: 0, width: 10, height: 4 }, candles: [
      { id: "up", stream: 0, x: 3, width: 1, highY: 0.5, lowY: 2.5, openY: 2, closeY: 1, rising: true, opacity: 0.6 },
      { id: "down", stream: 0, x: 7, width: 1, highY: 0.5, lowY: 2.5, openY: 1, closeY: 2, rising: false, opacity: 0.6 },
    ] }],
  }
  const painter = new MarketPainter(80, 64)
  const pixels = painter.paint(scene)
  const upOffset = (24 * 80 + 24) * 4
  const downOffset = (24 * 80 + 56) * 4
  const brightGreen = pixels[upOffset + 1]!
  expect(brightGreen).toBeGreaterThan(pixels[upOffset]!)
  expect(pixels[downOffset]!).toBeGreaterThan(pixels[downOffset + 1]!)
  const quiet = painter.paint(scene, true)
  expect(quiet[upOffset + 1]!).toBeLessThan(brightGreen / 2)
})
