// Order-block boxes — a Lightweight Charts v5 series primitive. Draws each
// order block as a translucent rectangle from its origin candle to the right
// edge of the pane, sitting BEHIND the candles.
//
// Visuals follow the LuxAlgo "Smart Money Concepts" indicator.
// © LuxAlgo — CC BY-NC-SA 4.0. Non-commercial use only.

import type {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  SeriesAttachedParameter,
  Time,
  IChartApi,
  ISeriesApi,
} from 'lightweight-charts'
import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type { OrderBlock } from '@/lib/smc/types'

const BULL_FILL = 'rgba(49, 121, 245, 0.18)'  // demand — blue
const BEAR_FILL = 'rgba(242, 54, 69, 0.18)'   // supply — red

class OrderBlockRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _source: OrderBlockPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    const chart = this._source.chart
    const series = this._source.series
    if (!chart || !series) return
    const timeScale = chart.timeScale()
    const blocks = this._source.blocks

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context
      // Boxes extend to the right edge of the pane (future time has no
      // coordinate, so we paint to the bitmap width, not a real time).
      const rightEdge = scope.bitmapSize.width
      for (const ob of blocks) {
        const xLeft = timeScale.timeToCoordinate(ob.fromTime as Time)
        const yTop = series.priceToCoordinate(ob.top)
        const yBottom = series.priceToCoordinate(ob.bottom)
        if (xLeft === null || yTop === null || yBottom === null) continue
        const x = xLeft * scope.horizontalPixelRatio
        const y1 = yTop * scope.verticalPixelRatio
        const y2 = yBottom * scope.verticalPixelRatio
        ctx.fillStyle = ob.bias === 'bullish' ? BULL_FILL : BEAR_FILL
        ctx.fillRect(x, Math.min(y1, y2), Math.max(0, rightEdge - x), Math.abs(y2 - y1))
      }
    })
  }
}

class OrderBlockPaneView implements IPrimitivePaneView {
  constructor(private readonly _source: OrderBlockPrimitive) {}
  // Behind the candlesticks so price is never occluded.
  zOrder() { return 'bottom' as const }
  renderer(): IPrimitivePaneRenderer { return new OrderBlockRenderer(this._source) }
}

export class OrderBlockPrimitive implements ISeriesPrimitive<Time> {
  blocks: OrderBlock[] = []
  chart: IChartApi | null = null
  series: ISeriesApi<'Candlestick'> | null = null
  private _requestUpdate?: () => void
  private readonly _paneViews: OrderBlockPaneView[]

  constructor() {
    this._paneViews = [new OrderBlockPaneView(this)]
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart
    this.series = param.series as ISeriesApi<'Candlestick'>
    this._requestUpdate = param.requestUpdate
  }

  detached(): void {
    this.chart = null
    this.series = null
    this._requestUpdate = undefined
  }

  // Views read live from this.blocks, so nothing to recompute here; the chart
  // calls this on pan/zoom/data change and then repaints the renderer.
  updateAllViews(): void {}

  paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews
  }

  setBlocks(blocks: OrderBlock[]): void {
    this.blocks = blocks
    this._requestUpdate?.()
  }
}
