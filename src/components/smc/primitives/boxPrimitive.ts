// Generic box layer — a Lightweight Charts v5 series primitive that fills a
// list of {top, bottom, fromTime, fill} rectangles from their origin candle to
// the right edge of the pane, behind the candles. Used for order blocks and
// fair value gaps (and any future zone box).
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

export interface SMCBox {
  top: number
  bottom: number
  fromTime: number
  // Optional right edge. If omitted, the box extends to the right edge of the
  // pane (order blocks). If set, the box ends at this time (fair value gaps).
  toTime?: number
  fill: string // any CSS color, e.g. 'rgba(49,121,245,0.18)'
}

class BoxRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _source: BoxPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    const chart = this._source.chart
    const series = this._source.series
    if (!chart || !series) return
    const timeScale = chart.timeScale()
    const boxes = this._source.boxes

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context
      const paneRight = scope.bitmapSize.width
      for (const b of boxes) {
        const xLeft = timeScale.timeToCoordinate(b.fromTime as Time)
        const yTop = series.priceToCoordinate(b.top)
        const yBottom = series.priceToCoordinate(b.bottom)
        if (xLeft === null || yTop === null || yBottom === null) continue
        const x = xLeft * scope.horizontalPixelRatio
        // Bounded right edge if toTime is set and on-screen, else the pane edge.
        let rightX = paneRight
        if (b.toTime !== undefined) {
          const xr = timeScale.timeToCoordinate(b.toTime as Time)
          if (xr !== null) rightX = xr * scope.horizontalPixelRatio
        }
        const y1 = yTop * scope.verticalPixelRatio
        const y2 = yBottom * scope.verticalPixelRatio
        ctx.fillStyle = b.fill
        ctx.fillRect(x, Math.min(y1, y2), Math.max(0, rightX - x), Math.abs(y2 - y1))
      }
    })
  }
}

class BoxPaneView implements IPrimitivePaneView {
  constructor(private readonly _source: BoxPrimitive) {}
  zOrder() { return 'bottom' as const }
  renderer(): IPrimitivePaneRenderer { return new BoxRenderer(this._source) }
}

export class BoxPrimitive implements ISeriesPrimitive<Time> {
  boxes: SMCBox[] = []
  chart: IChartApi | null = null
  series: ISeriesApi<'Candlestick'> | null = null
  private _requestUpdate?: () => void
  private readonly _paneViews: BoxPaneView[]

  constructor() {
    this._paneViews = [new BoxPaneView(this)]
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

  updateAllViews(): void {}

  paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews
  }

  setBoxes(boxes: SMCBox[]): void {
    this.boxes = boxes
    this._requestUpdate?.()
  }
}
