import { NativeImagePool, Renderable, type NativeImage, type OptimizedBuffer, type RenderContext, type RenderableOptions } from "@opentui/core"
import { extend, useRenderer } from "@opentui/solid"
import { onCleanup, onMount } from "solid-js"
import { createMarketScene, type ChartRect } from "./background-market"
import { MarketPainter } from "./background-painter"

type MarketOptions = RenderableOptions<MarketRenderable> & {
  quiet?: boolean
  layout: () => { card?: ChartRect; composer?: ChartRect; bottom: number }
}

class MarketRenderable extends Renderable {
  quiet = false
  private readonly layout: MarketOptions["layout"]
  private readonly seed = Math.floor(Math.random() * 0x7fffffff)
  private time = 0
  private painter?: MarketPainter
  private pool?: NativeImagePool
  private image?: NativeImage

  constructor(ctx: RenderContext, options: MarketOptions) {
    super(ctx, { ...options, live: true })
    this.layout = options.layout
    this.quiet = options.quiet ?? false
  }

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime = 0) {
    if (!this.visible || this.isDestroyed) return
    this.time += Math.min(deltaTime, 100) / 1000
    const layout = this.layout()
    const width = Math.floor(this.width)
    const height = Math.min(Math.floor(this.height), Math.max(0, layout.bottom))
    if (width < 1 || height < 1) return

    // Keep thin wicks crisp independently of font glyphs. Native graphics are
    // used when available; OpenTUI supplies the portable block fallback.
    const pixelWidth = width * 8
    const pixelHeight = height * 16
    if (this.painter?.width !== pixelWidth || this.painter.height !== pixelHeight) {
      this.image?.dispose()
      this.image = undefined
      this.pool?.dispose()
      this.painter = new MarketPainter(pixelWidth, pixelHeight)
      this.pool = new NativeImagePool({ width: pixelWidth, height: pixelHeight, capacity: 3 })
    }
    const scene = createMarketScene({
      width,
      height,
      card: layout.card ?? { x: (width - 60) / 2, y: (height - 12) / 2, width: 60, height: 12 },
      volumeBounds: layout.composer,
      time: this.time,
      seed: this.seed,
    })
    const pixels = this.painter.paint(scene, this.quiet)
    const next = this.pool!.publishPixels(pixels, { format: "rgba8", alpha: "opaque" })
    if (next) {
      this.image?.dispose()
      this.image = next
    }
    if (!this.image) return
    const resolution = this._ctx.resolution
    const outputWidth = resolution ? Math.round(width * resolution.width / (this._ctx.terminalWidth || width)) : 0
    const outputHeight = resolution ? Math.round(height * resolution.height / (this._ctx.terminalHeight || this.height)) : 0
    buffer.drawImage(this.image, this.screenX, this.screenY, width, height, outputWidth, outputHeight, 0, 0, pixelWidth, pixelHeight, "auto")
  }

  protected override destroySelf() {
    this.image?.dispose()
    this.pool?.dispose()
    super.destroySelf()
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    ot_market: typeof MarketRenderable
  }
}

extend({ ot_market: MarketRenderable })

export function Background(props: { quiet?: boolean }) {
  const renderer = useRenderer()
  let previousFps = renderer.targetFps
  onMount(() => {
    previousFps = renderer.targetFps
    renderer.targetFps = 18
  })
  onCleanup(() => { renderer.targetFps = previousFps })
  return (
    <ot_market
      id="market-background"
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      zIndex={0}
      quiet={props.quiet}
      layout={() => {
        const home = renderer.root.findDescendantById("home-card")
        const composer = renderer.root.findDescendantById("chat-composer")
        return {
          card: home ? { x: home.screenX, y: home.screenY, width: home.width, height: home.height } : undefined,
          composer: composer ? { x: composer.screenX, y: composer.screenY, width: composer.width, height: composer.height } : undefined,
          bottom: Math.max(0, composer?.screenY ?? renderer.height - 4),
        }
      }}
    />
  )
}
