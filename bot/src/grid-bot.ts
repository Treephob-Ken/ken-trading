import { buildCenteredGrid, buildLines, deriveOrderSize, type GridConfig } from './config.js'
import {
  getAssetMeta,
  roundPrice,
  roundSize,
  type AssetMeta,
  type HLClients,
} from './hyperliquid.js'
import { log as defaultLog, type Logger } from './logger.js'

interface TrackedOrder {
  oid: number
  side: 'buy' | 'sell'
  price: number
  size: number
  lineIdx: number
}

interface UserFill {
  coin: string
  px: string
  sz: string
  side: 'B' | 'A'
  oid: number
  fee: string
  closedPnl: string
  time: number
}

export interface BotStats {
  asset: string
  startedAt: number
  currentPrice: number
  netPosition: number          // positive = long, negative = short
  realizedPnl: number
  unrealizedPnl: number
  totalPnl: number
  feesPaid: number
  fills: number
  roundtrips: number
  openOrders: number
  orderSize: number
  effectiveBudget: number      // worst-case notional used
  aprPct: number
  state: 'init' | 'waiting-trigger' | 'live' | 'stopped'
  stopReason?: string
  lines: number[]
  // Safety triggers — null if not configured
  stopLossPrice: number | null
  takeProfitPrice: number | null
  slDistancePct: number | null     // % price has to drop to hit SL (positive number)
  tpDistancePct: number | null     // % price has to rise to hit TP
  slArmedOnExchange: boolean       // has an exchange-side trigger order been placed?
  tpArmedOnExchange: boolean
  leverage: number
  // Approximate liquidation price for the current net position at this leverage.
  // null when flat (no liquidation risk).
  liquidationPrice: number | null
  liquidationDistancePct: number | null
  // True when SL is BEYOND the liquidation distance — i.e. exchange would
  // liquidate before SL ever fires. Most common at high leverage.
  slUnreachable: boolean
  // Activity diagnostics — let the UI answer "is this grid working hard enough?"
  lastFillAt: number | null            // ms epoch of most recent fill, null if none yet
  lastRoundtripAt: number | null       // ms epoch of most recent roundtrip
  fillsPerHour: number                 // rolling rate over last 1h (or scaled-up for younger bots)
  roundtripsPerHour: number            // rolling rate over last 1h
  gridPositionPct: number | null       // where price sits in [lower, upper] as 0-100%; null if outside or no price yet
  nearestLineIdx: number | null        // index of the grid line closest to current price
  distanceToNearestLinePct: number | null  // % distance from price to that nearest line
}

// Live grid bot. Strategy: at every grid LINE we keep exactly one resting
// order - buys below current price, sells above. When one fills, place an
// opposite order one line up (after a buy) or one line down (after a sell).
// Realized P&L is taken directly from Hyperliquid's `closedPnl` so it
// accounts for fees and matches what the UI shows.
//
// Global safety: stopLossPrice / takeProfitPrice / triggerPrice are checked
// on every price tick (via allMids subscription).
export class GridBot {
  private clients: HLClients
  private cfg: GridConfig
  private lines: number[]
  private meta!: AssetMeta
  private orderSize: number = 0
  private log: Logger

  private orders = new Map<number, TrackedOrder>() // oid -> order
  private ordersByLine = new Map<number, number>() // lineIdx -> oid

  private realizedPnl = 0
  private feesPaid = 0
  private totalFills = 0
  private completedRoundtrips = 0
  private netPosition = 0
  // Rolling fill/roundtrip timestamps (ms) — capped so memory stays bounded.
  // Used to compute fills-per-hour and roundtrips-per-hour for the UI.
  private fillTimes: number[] = []
  private roundtripTimes: number[] = []

  private currentPrice = 0
  private startedAt = 0
  private state: BotStats['state'] = 'init'
  private stopReason: string | undefined
  private allMidsSub: { unsubscribe(): Promise<void> } | null = null
  private statsTimer: NodeJS.Timeout | null = null
  private shuttingDown = false

  private rebalancing = false
  private slPct: number | null = null
  private tpPct: number | null = null
  private referenceAtr = 0
  private baseSpacing = 0
  private rebalanceTimer: NodeJS.Timeout | null = null
  private slTriggerOid: number | null = null
  private tpTriggerOid: number | null = null

  constructor(clients: HLClients, cfg: GridConfig, logger?: Logger) {
    this.clients = clients
    this.cfg = cfg
    this.lines = buildLines(cfg)
    this.log = logger ?? defaultLog
  }

  // opts.reconcile = true means "the bot was running before a restart; adopt
  // whatever orders already exist on Hyperliquid that match the grid plan,
  // cancel the ones that don't, and place the missing ones." Used by
  // maybeAutostartGridBots on server boot. Default (false) is the existing
  // clean-slate behavior — every existing order for this asset is cancelled
  // and a fresh grid goes up.
  async start(opts: { reconcile?: boolean } = {}): Promise<void> {
    this.startedAt = Date.now()
    this.meta = await getAssetMeta(this.clients.info, this.cfg.asset)
    this.currentPrice = this.meta.midPx
    this.orderSize = deriveOrderSize(this.cfg)

    this.log.info(
      `${this.cfg.asset} markPx=${this.meta.markPx} midPx=${this.meta.midPx} szDec=${this.meta.szDecimals} pxDec=${this.meta.pxDecimals}`,
    )
    if (this.cfg.investment && !this.cfg.orderSize) {
      this.log.info(
        `Budget mode: $${this.cfg.investment} USDC at ${this.cfg.leverage ?? 1}x -> orderSize=${this.orderSize.toFixed(this.meta.szDecimals)} per grid`,
      )
    }
    if (this.cfg.stopLossPrice) this.log.info(`Stop loss armed at ${this.cfg.stopLossPrice}`)
    if (this.cfg.takeProfitPrice) this.log.info(`Take profit armed at ${this.cfg.takeProfitPrice}`)

    // Calculate initial base spacing (average spacing across current lines)
    let spacingSum = 0
    for (let i = 1; i < this.lines.length; i++) {
      spacingSum += this.lines[i] - this.lines[i - 1]
    }
    this.baseSpacing = spacingSum / Math.max(1, this.lines.length - 1)

    // Store stop loss / take profit percentage offsets from the range bounds
    const origLower = this.cfg.lower
    const origUpper = this.cfg.upper
    this.slPct = this.cfg.stopLossPrice ? (origLower - this.cfg.stopLossPrice) / origLower : null
    this.tpPct = this.cfg.takeProfitPrice ? (this.cfg.takeProfitPrice - origUpper) / origUpper : null

    await this.setLeverage()
    if (!opts.reconcile) {
      await this.cancelExistingOrders()
    }

    this.log.info(`Grid lines (${this.lines.length}):`)
    for (let i = 0; i < this.lines.length; i++) {
      this.log.info(`  [${i}] ${this.lines[i].toFixed(this.meta.pxDecimals)}`)
    }

    await this.subscribeFills()
    await this.subscribePrices()

    if (this.cfg.triggerPrice && !this.triggerArmed(this.currentPrice)) {
      this.state = 'waiting-trigger'
      this.log.info(
        `Waiting for trigger price ${this.cfg.triggerPrice} (current ${this.currentPrice})...`,
      )
    } else if (opts.reconcile) {
      // Arm SL/TP on the exchange BEFORE adopting the pre-existing grid orders.
      // In reconcile mode the old grid orders could fill at any moment, so the
      // position must be protected before we touch them. The old run's SL/TP
      // (if any) will be cancelled as orphans inside reconcileExistingOrders,
      // but our brand-new oids are exempted, so coverage never drops to zero.
      await this.placeSafetyTriggers()
      await this.reconcileExistingOrders()
      this.state = 'live'
      this.log.ok(`Bot resumed. ${this.orders.size} resting orders on ${this.cfg.asset}.`)
    } else {
      await this.placeSafetyTriggers()
      await this.placeInitialOrders()
      this.state = 'live'
      this.log.ok(`Bot live. ${this.orders.size} resting orders on ${this.cfg.asset}.`)
    }

    if (this.cfg.rebalanceIntervalMs) {
      if (this.cfg.adaptiveSpacing) {
        const stats = await this.fetchAtrStats()
        if (stats) {
          this.referenceAtr = stats.referenceAtr
          this.log.info(`Initialized reference ATR: ${this.referenceAtr.toFixed(this.meta.pxDecimals)}`)
        }
      }
      this.startRebalanceTimer()
    }

    this.startStatsTimer()
  }

  // Place exchange-side stop orders so the range-breakout exits fire even
  // if this bot process dies. The bot's own onPriceTick still does a full
  // cancel-all + close as the primary path; these are defense-in-depth.
  //
  // Both are STOP orders (tpsl='sl'). Hyperliquid maps side+tpsl='sl' as:
  //   side=sell, tpsl=sl => fires when price <= triggerPx  (closes long)
  //   side=buy,  tpsl=sl => fires when price >= triggerPx  (closes short)
  //
  // We label them "SL" (downside breakout) and "TP" (upside breakout) by
  // user-facing intent, but mechanically both are stops. Each is reduce-
  // only, so they're a no-op if the position direction doesn't match —
  // the bot's price-tick monitor catches the opposite case.
  private async placeSafetyTriggers(): Promise<void> {
    const maxQty = this.cfg.gridCount * this.orderSize
    if (this.cfg.stopLossPrice) {
      this.slTriggerOid = await this.placeStopOrder('SL', 'sell', this.cfg.stopLossPrice, maxQty)
    }
    if (this.cfg.takeProfitPrice) {
      this.tpTriggerOid = await this.placeStopOrder('TP', 'buy', this.cfg.takeProfitPrice, maxQty)
    }
  }

  private async placeStopOrder(
    label: string,
    side: 'buy' | 'sell',
    triggerPrice: number,
    size: number,
  ): Promise<number | null> {
    try {
      // Limit price set past the trigger so the IOC always crosses the book.
      const limitMul = side === 'sell' ? 0.95 : 1.05
      const res = await this.clients.exchange.order({
        orders: [{
          a: this.meta.assetId,
          b: side === 'buy',
          p: roundPrice(triggerPrice * limitMul, this.meta),
          s: roundSize(size, this.meta),
          r: true,
          t: { trigger: {
            triggerPx: roundPrice(triggerPrice, this.meta),
            isMarket: true,
            tpsl: 'sl',  // always a stop — direction is implied by `side`
          }},
        }],
        grouping: 'na',
      })
      const status = res.response.data.statuses[0]
      if (typeof status === 'object' && 'resting' in status) {
        const oid = status.resting.oid
        this.log.ok(`${label} exchange-side stop placed @ ${triggerPrice} (${side}, oid ${oid})`)
        return oid
      }
      this.log.warn(`${label} stop placement returned unexpected status`)
      return null
    } catch (e) {
      this.log.warn(`Could not place ${label} stop order: ${(e as Error).message}`)
      return null
    }
  }

  private async setLeverage(): Promise<void> {
    const lev = this.cfg.leverage ?? 1
    if (lev === 1) return
    try {
      await this.clients.exchange.updateLeverage({
        // Must be assetId (HL global ID), not the in-dex index. For HIP-3
        // perps these differ and using index targets the wrong asset.
        asset: this.meta.assetId,
        isCross: true,
        leverage: lev,
      })
      this.log.ok(`Leverage set to ${lev}x (cross)`)
    } catch (e) {
      this.log.warn(`Could not set leverage to ${lev}x: ${(e as Error).message}`)
    }
  }

  private triggerArmed(price: number): boolean {
    if (!this.cfg.triggerPrice) return true
    return price >= this.cfg.lower && price <= this.cfg.upper
  }

  private async cancelExistingOrders(): Promise<void> {
    const open = await this.clients.info.openOrders({ user: this.clients.user })
    const mine = open.filter((o) => o.coin === this.cfg.asset)
    if (mine.length === 0) {
      this.log.ok('No existing orders to clear.')
      return
    }
    await this.clients.exchange.cancel({
      cancels: mine.map((o) => ({ a: this.meta.assetId, o: o.oid })),
    })
    this.log.ok(`Cancelled ${mine.length} pre-existing ${this.cfg.asset} orders.`)
  }

  // Reconcile mode: the bot was running before a process restart. Existing
  // resting orders for this asset are orphans from the previous run that we
  // want to ADOPT into our tracking instead of canceling + re-placing.
  //
  // For each currently-resting HL order:
  //   - If its price matches one of our planned grid lines (within 1 tick),
  //     adopt it: populate this.orders / this.ordersByLine so future fills
  //     are tracked correctly.
  //   - If no line matches (stale order from an earlier grid bounds), cancel it.
  //
  // After adoption, walk the grid lines and place fresh orders for any that
  // weren't matched — same buy-below / sell-above rule as placeInitialOrders.
  private async reconcileExistingOrders(): Promise<void> {
    const open = await this.clients.info.openOrders({ user: this.clients.user })
    const mine = open.filter((o) => o.coin === this.cfg.asset)
    this.log.info(`Reconciling: found ${mine.length} resting ${this.cfg.asset} order(s) on Hyperliquid.`)

    // Pre-compute the rounded grid prices so matching is exact against HL's
    // own string-formatted prices.
    const linePrices = this.lines.map((px) => roundPrice(px, this.meta))

    const orphanCancels: { a: number; o: number }[] = []
    let adopted = 0

    for (const o of mine) {
      const px = String(o.limitPx)
      const sideRaw = (o as { side?: 'B' | 'A' }).side
      const side: 'buy' | 'sell' = sideRaw === 'B' ? 'buy' : 'sell'
      const sz = Number(o.sz)

      // Match by exact rounded-price string. Hyperliquid returns the same
      // string it stored when we placed the order, so equality is reliable.
      let lineIdx = linePrices.indexOf(px)
      if (lineIdx < 0) {
        // Tiny numeric fallback for edge cases where formatting changed.
        const numericPx = Number(px)
        for (let i = 0; i < this.lines.length; i++) {
          if (Math.abs(this.lines[i] - numericPx) / numericPx < 1e-5) { lineIdx = i; break }
        }
      }

      if (lineIdx < 0 || this.ordersByLine.has(lineIdx)) {
        // Don't cancel the SL/TP triggers we just placed — they protect the
        // position while we sort the grid out. Old-run SL/TP (different oid)
        // are still cancelled as orphans and immediately replaced.
        if (o.oid === this.slTriggerOid || o.oid === this.tpTriggerOid) {
          continue
        }
        // Orphan: doesn't match any line, or two HL orders mapped to the same line.
        orphanCancels.push({ a: this.meta.assetId, o: o.oid })
        continue
      }

      this.orders.set(o.oid, { oid: o.oid, side, price: Number(px), size: sz, lineIdx })
      this.ordersByLine.set(lineIdx, o.oid)
      adopted++
    }

    if (orphanCancels.length > 0) {
      await this.clients.exchange.cancel({ cancels: orphanCancels })
      this.log.warn(`Cancelled ${orphanCancels.length} orphan order(s) that didn't match any grid line.`)
    }
    this.log.ok(`Adopted ${adopted} existing order(s); ${this.lines.length - adopted} grid line(s) still need orders.`)

    // Place orders for the lines that didn't have one adopted, using the same
    // buy-below / sell-above rule as a fresh start.
    const px = this.currentPrice
    for (let i = 0; i < this.lines.length; i++) {
      if (this.ordersByLine.has(i)) continue
      const line = this.lines[i]
      if (line < px) {
        await this.placeOrder(i, 'buy', line)
      } else if (line > px) {
        await this.placeOrder(i, 'sell', line)
      }
    }
  }

  private async placeInitialOrders(): Promise<void> {
    const currentPrice = this.currentPrice
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i]
      if (line < currentPrice) {
        await this.placeOrder(i, 'buy', line)
      } else if (line > currentPrice) {
        await this.placeOrder(i, 'sell', line)
      }
    }
  }

  private async placeOrder(
    lineIdx: number,
    side: 'buy' | 'sell',
    price: number,
  ): Promise<void> {
    if (this.shuttingDown) return
    if (this.ordersByLine.has(lineIdx)) return // already an order at this line

    const sz = roundSize(this.orderSize, this.meta)
    const px = roundPrice(price, this.meta)
    try {
      const res = await this.clients.exchange.order({
        orders: [
          {
            a: this.meta.assetId,
            b: side === 'buy',
            p: px,
            s: sz,
            r: false,
            t: { limit: { tif: 'Gtc' } },
          },
        ],
        grouping: 'na',
      })
      const status = res.response.data.statuses[0]
      if (typeof status === 'string') {
        this.log.warn(`Order at line ${lineIdx} returned status "${status}"`)
      } else if ('resting' in status) {
        const oid = status.resting.oid
        const tracked: TrackedOrder = {
          oid,
          side,
          price,
          size: this.orderSize,
          lineIdx,
        }
        this.orders.set(oid, tracked)
        this.ordersByLine.set(lineIdx, oid)
        this.log.info(`-> ${side.toUpperCase()} ${sz} @ ${px} (line ${lineIdx}, oid ${oid})`)
      } else if ('filled' in status) {
        this.log.warn(
          `Order at line ${lineIdx} crossed on placement: filled ${status.filled.totalSz} @ ${status.filled.avgPx}`,
        )
      }
    } catch (e) {
      this.log.err(`placeOrder ${side} line=${lineIdx}: ${(e as Error).message}`)
    }
  }

  private async subscribeFills(): Promise<void> {
    await this.clients.subs.userFills(
      { user: this.clients.user },
      (event) => {
        if (event.isSnapshot) return // initial snapshot - historical, skip
        for (const fill of event.fills) this.handleFill(fill as UserFill)
      },
    )
    this.log.ok('Subscribed to userFills.')
  }

  private async subscribePrices(): Promise<void> {
    this.allMidsSub = await this.clients.subs.allMids((event) => {
      const mid = event.mids[this.cfg.asset]
      if (!mid) return
      const price = Number(mid)
      if (!Number.isFinite(price) || price <= 0) return
      this.currentPrice = price
      this.onPriceTick(price)
    })
    this.log.ok('Subscribed to live prices (allMids).')
  }

  private onPriceTick(price: number): void {
    if (this.state === 'stopped' || this.shuttingDown || this.rebalancing) return

    if (this.state === 'waiting-trigger' && this.triggerArmed(price)) {
      this.log.ok(`Trigger price reached at ${price}. Placing initial grid...`)
      this.state = 'live'
      void this.placeInitialOrders()
      return
    }

    if (this.state !== 'live') return

    if (this.cfg.stopLossPrice && price <= this.cfg.stopLossPrice) {
      void this.haltAndClose(`Stop loss hit @ ${price.toFixed(this.meta.pxDecimals)} (SL=${this.cfg.stopLossPrice})`)
      return
    }
    if (this.cfg.takeProfitPrice && price >= this.cfg.takeProfitPrice) {
      void this.haltAndClose(`Take profit hit @ ${price.toFixed(this.meta.pxDecimals)} (TP=${this.cfg.takeProfitPrice})`)
      return
    }
  }

  private async haltAndClose(reason: string): Promise<void> {
    if (this.state === 'stopped') return
    this.state = 'stopped'
    this.stopReason = reason
    this.log.warn(reason)
    this.log.warn('Cancelling all orders and closing position...')

    try {
      const open = await this.clients.info.openOrders({ user: this.clients.user })
      const mine = open.filter((o) => o.coin === this.cfg.asset)
      if (mine.length > 0) {
        await this.clients.exchange.cancel({
          cancels: mine.map((o) => ({ a: this.meta.assetId, o: o.oid })),
        })
        this.log.ok(`Cancelled ${mine.length} open orders.`)
      }
      this.orders.clear()
      this.ordersByLine.clear()
      this.slTriggerOid = null
      this.tpTriggerOid = null

      if (Math.abs(this.netPosition) > 0) {
        const closeSide: 'buy' | 'sell' = this.netPosition > 0 ? 'sell' : 'buy'
        const closeSz = roundSize(Math.abs(this.netPosition), this.meta)
        const slip = closeSide === 'sell' ? 0.99 : 1.01
        const closePx = roundPrice(this.currentPrice * slip, this.meta)
        await this.clients.exchange.order({
          orders: [{
            a: this.meta.assetId,
            b: closeSide === 'buy',
            p: closePx,
            s: closeSz,
            r: true,
            t: { limit: { tif: 'Ioc' } },
          }],
          grouping: 'na',
        })
        this.log.ok(`Closed ${closeSide.toUpperCase()} ${closeSz} ${this.cfg.asset} @ ~${closePx}`)
      }
    } catch (e) {
      this.log.err(`Halt-and-close failed: ${(e as Error).message}`)
    }

    this.log.warn(`Bot HALTED - ${reason}. Realized PnL = $${this.realizedPnl.toFixed(2)}`)
  }

  private handleFill(fill: UserFill): void {
    if (fill.coin !== this.cfg.asset) return
    if (this.rebalancing) return

    const tracked = this.orders.get(fill.oid)
    if (!tracked) return

    const price = Number(fill.px)
    const size = Number(fill.sz)
    const fee = Number(fill.fee)
    const closedPnl = Number(fill.closedPnl)

    this.totalFills++
    this.feesPaid += fee
    this.realizedPnl += closedPnl
    if (closedPnl !== 0) this.completedRoundtrips++

    const nowMs = Date.now()
    this.fillTimes.push(nowMs)
    if (this.fillTimes.length > 500) this.fillTimes.shift()
    if (closedPnl !== 0) {
      this.roundtripTimes.push(nowMs)
      if (this.roundtripTimes.length > 500) this.roundtripTimes.shift()
    }

    if (tracked.side === 'buy') this.netPosition += size
    else this.netPosition -= size

    this.orders.delete(fill.oid)
    this.ordersByLine.delete(tracked.lineIdx)

    this.log.fill(
      `${tracked.side.toUpperCase()} ${size} @ ${price.toFixed(this.meta.pxDecimals)} ` +
        `(line ${tracked.lineIdx}) fee=$${fee.toFixed(4)} pnl=$${closedPnl.toFixed(4)} ` +
        `| realized=$${this.realizedPnl.toFixed(2)} trades=${this.completedRoundtrips} pos=${this.netPosition.toFixed(this.meta.szDecimals)}`,
    )

    if (this.state !== 'live') return

    const newLine =
      tracked.side === 'buy' ? tracked.lineIdx + 1 : tracked.lineIdx - 1
    const newSide: 'buy' | 'sell' = tracked.side === 'buy' ? 'sell' : 'buy'
    if (newLine >= 0 && newLine < this.lines.length) {
      void this.placeOrder(newLine, newSide, this.lines[newLine])
    }
  }

  private startStatsTimer(): void {
    this.statsTimer = setInterval(() => {
      this.log.info(
        `STATS state=${this.state} px=${this.currentPrice.toFixed(this.meta.pxDecimals)} ` +
          `realized=$${this.realizedPnl.toFixed(2)} fees=$${this.feesPaid.toFixed(2)} ` +
          `roundtrips=${this.completedRoundtrips} fills=${this.totalFills} open=${this.orders.size} ` +
          `pos=${this.netPosition.toFixed(this.meta.szDecimals)}`,
      )
    }, 30_000)
  }

  private avgEntryPrice(): number {
    return (this.cfg.lower + this.cfg.upper) / 2
  }

  getStats(): BotStats {
    const avgEntry = this.avgEntryPrice()
    const unrealized = this.netPosition * (this.currentPrice - avgEntry)
    const total = this.realizedPnl + unrealized
    const runtimeMs = this.startedAt ? Date.now() - this.startedAt : 0
    const budgetBasis = this.cfg.investment ??
      (this.orderSize * this.cfg.gridCount * this.cfg.upper) /
        (this.cfg.leverage ?? 1)
    const yearMs = 365 * 24 * 3600 * 1000
    const aprPct =
      runtimeMs > 0 && budgetBasis > 0
        ? (total / budgetBasis) * (yearMs / runtimeMs) * 100
        : 0

    // Distances to triggers — as a positive % regardless of direction.
    const px = this.currentPrice
    const sl = this.cfg.stopLossPrice ?? null
    const tp = this.cfg.takeProfitPrice ?? null
    const slDistancePct = sl && px > 0 ? ((px - sl) / px) * 100 : null
    const tpDistancePct = tp && px > 0 ? ((tp - px) / px) * 100 : null

    // Approximate cross-margin liquidation price. With leverage L, a move of
    // roughly 1/L against the position liquidates (ignoring fees / maint).
    // For a long position, price falls; for short, price rises.
    const lev = this.cfg.leverage ?? 1
    let liquidationPrice: number | null = null
    let liquidationDistancePct: number | null = null
    if (lev > 1 && Math.abs(this.netPosition) > 0 && avgEntry > 0) {
      const move = avgEntry / lev
      liquidationPrice = this.netPosition > 0 ? avgEntry - move : avgEntry + move
      liquidationDistancePct = px > 0 ? Math.abs((liquidationPrice - px) / px) * 100 : null
    }

    // SL unreachable: liquidation hits before SL (long position case).
    const slUnreachable =
      sl !== null &&
      liquidationPrice !== null &&
      this.netPosition > 0 &&
      liquidationPrice > sl

    // ── Activity diagnostics ────────────────────────────────────────────────
    const nowMs = Date.now()
    const oneHourMs = 3_600_000
    const lookbackMs = Math.min(oneHourMs, runtimeMs || oneHourMs)
    const cutoff = nowMs - lookbackMs
    const recentFills = this.fillTimes.filter((t) => t >= cutoff).length
    const recentRoundtrips = this.roundtripTimes.filter((t) => t >= cutoff).length
    // Normalize to an hourly rate even if we only have a few minutes of data.
    const scale = lookbackMs > 0 ? oneHourMs / lookbackMs : 0
    const fillsPerHour = recentFills * scale
    const roundtripsPerHour = recentRoundtrips * scale

    const lastFillAt = this.fillTimes.length > 0 ? this.fillTimes[this.fillTimes.length - 1] : null
    const lastRoundtripAt = this.roundtripTimes.length > 0
      ? this.roundtripTimes[this.roundtripTimes.length - 1]
      : null

    // Grid position — where price sits between the configured lower and upper.
    let gridPositionPct: number | null = null
    if (px > 0 && this.cfg.upper > this.cfg.lower) {
      const raw = ((px - this.cfg.lower) / (this.cfg.upper - this.cfg.lower)) * 100
      gridPositionPct = Math.max(0, Math.min(100, raw))
    }

    // Nearest grid line to current price — useful "next fill is X% away" hint.
    let nearestLineIdx: number | null = null
    let distanceToNearestLinePct: number | null = null
    if (px > 0 && this.lines.length > 0) {
      let best = 0
      let bestDist = Math.abs(this.lines[0] - px)
      for (let i = 1; i < this.lines.length; i++) {
        const d = Math.abs(this.lines[i] - px)
        if (d < bestDist) { best = i; bestDist = d }
      }
      nearestLineIdx = best
      distanceToNearestLinePct = (bestDist / px) * 100
    }

    return {
      asset: this.cfg.asset,
      startedAt: this.startedAt,
      currentPrice: this.currentPrice,
      netPosition: this.netPosition,
      realizedPnl: this.realizedPnl,
      unrealizedPnl: unrealized,
      totalPnl: total,
      feesPaid: this.feesPaid,
      fills: this.totalFills,
      roundtrips: this.completedRoundtrips,
      openOrders: this.orders.size,
      orderSize: this.orderSize,
      effectiveBudget: budgetBasis,
      aprPct,
      state: this.state,
      stopReason: this.stopReason,
      lines: this.lines,
      stopLossPrice: sl,
      takeProfitPrice: tp,
      slDistancePct,
      tpDistancePct,
      slArmedOnExchange: this.slTriggerOid !== null,
      tpArmedOnExchange: this.tpTriggerOid !== null,
      leverage: lev,
      liquidationPrice,
      liquidationDistancePct,
      slUnreachable,
      lastFillAt,
      lastRoundtripAt,
      fillsPerHour,
      roundtripsPerHour,
      gridPositionPct,
      nearestLineIdx,
      distanceToNearestLinePct,
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    if (this.statsTimer) clearInterval(this.statsTimer)
    if (this.rebalanceTimer) clearInterval(this.rebalanceTimer)
    if (this.allMidsSub) {
      try { await this.allMidsSub.unsubscribe() } catch { /* ignore */ }
    }
    this.log.warn('Cancelling all open orders before exit...')
    const open = await this.clients.info.openOrders({ user: this.clients.user })
    const mine = open.filter((o) => o.coin === this.cfg.asset)
    if (mine.length === 0) {
      this.log.ok('No orders to cancel.')
      return
    }
    await this.clients.exchange.cancel({
      cancels: mine.map((o) => ({ a: this.meta.assetId, o: o.oid })),
    })
    this.log.ok(`Cancelled ${mine.length} orders.`)
  }

  private startRebalanceTimer(): void {
    const intervalMs = this.cfg.rebalanceIntervalMs ?? 300_000 // default 5m
    this.rebalanceTimer = setInterval(() => {
      void this.checkRebalance()
    }, intervalMs)
  }

  private async checkRebalance(): Promise<void> {
    if (this.state !== 'live' || this.rebalancing || this.shuttingDown) return

    const lower = this.lines[0]
    const upper = this.lines[this.lines.length - 1]
    if (lower === undefined || upper === undefined) return

    const center = (lower + upper) / 2
    const halfRange = (upper - lower) / 2
    const drift = Math.abs(this.currentPrice - center)
    const driftRatio = halfRange > 0 ? drift / halfRange : 0

    if (driftRatio > 0.8) {
      this.log.info(`Price drifted > 80% toward grid edge (driftRatio=${driftRatio.toFixed(2)}). Triggering rebalance centered at ${this.currentPrice}...`)
      await this.triggerRebalance()
    }
  }

  private async triggerRebalance(): Promise<void> {
    this.rebalancing = true
    try {
      // 1. Cancel all orders
      await this.cancelExistingOrders()
      this.orders.clear()
      this.ordersByLine.clear()
      this.slTriggerOid = null
      this.tpTriggerOid = null

      // 2. Fetch current ATR and compute new spacing if adaptive spacing is enabled
      let currentSpacing = this.baseSpacing
      if (this.cfg.adaptiveSpacing && this.referenceAtr > 0) {
        const stats = await this.fetchAtrStats()
        if (stats) {
          const currentAtr = stats.currentAtr
          const scale = currentAtr / this.referenceAtr
          currentSpacing = this.baseSpacing * scale
          this.log.info(`Adaptive spacing: current ATR=${currentAtr.toFixed(this.meta.pxDecimals)}, reference ATR=${this.referenceAtr.toFixed(this.meta.pxDecimals)}, scale=${scale.toFixed(2)}x, spacing=${currentSpacing.toFixed(this.meta.pxDecimals)}`)
        }
      }

      // 3. Recalculate grid centered on current price
      const count = this.cfg.gridCount
      const mode = this.cfg.mode
      const newLines = buildCenteredGrid(this.currentPrice, currentSpacing, count, mode)
      if (newLines.length < 2) {
        throw new Error('Failed to generate valid grid lines during centering')
      }
      this.lines = newLines
      const newL = newLines[0]
      const newU = newLines[newLines.length - 1]

      this.log.info(`New centered grid range: [${newL.toFixed(this.meta.pxDecimals)}, ${newU.toFixed(this.meta.pxDecimals)}] with ${count} grids`)

      // 4. Update safety trigger prices if percentages are set
      if (this.slPct !== null) {
        this.cfg.stopLossPrice = newL * (1 - this.slPct)
        this.log.info(`Updated Stop Loss price to ${this.cfg.stopLossPrice.toFixed(this.meta.pxDecimals)}`)
      }
      if (this.tpPct !== null) {
        this.cfg.takeProfitPrice = newU * (1 + this.tpPct)
        this.log.info(`Updated Take Profit price to ${this.cfg.takeProfitPrice.toFixed(this.meta.pxDecimals)}`)
      }

      // 5. Place initial orders & safety triggers
      await this.placeInitialOrders()
      await this.placeSafetyTriggers()
      this.log.ok(`Grid rebalanced successfully. ${this.orders.size} active grid orders.`)
    } catch (e) {
      this.log.err(`Failed during rebalance execution: ${(e as Error).message}`)
    } finally {
      this.rebalancing = false
    }
  }

  private async fetchAtrStats(): Promise<{ currentAtr: number; referenceAtr: number } | null> {
    try {
      // Fetch last 150 hourly candles (150 * 3600 * 1000 ms)
      const lookbackMs = 150 * 60 * 60 * 1000
      const startTime = Date.now() - lookbackMs
      const response = await this.clients.info.candleSnapshot({
        coin: this.cfg.asset,
        interval: '1h',
        startTime,
      })

      if (!response || response.length < 15) {
        this.log.warn(`Not enough candles fetched to compute ATR (got ${response?.length ?? 0})`)
        return null
      }

      // Convert to format required for ATR computation
      const candles = response.map((c) => ({
        high: Number(c.h),
        low: Number(c.l),
        close: Number(c.c),
        open: Number(c.o),
      }))

      const atrValues: number[] = []
      let trSum = 0
      for (let i = 0; i < candles.length; i++) {
        const c = candles[i]
        let tr = c.high - c.low
        if (i > 0) {
          const prevC = candles[i - 1]
          tr = Math.max(
            c.high - c.low,
            Math.abs(c.high - prevC.close),
            Math.abs(c.low - prevC.close),
          )
        }
        trSum += tr
        if (i >= 14) {
          let sum = 0
          for (let j = i - 13; j <= i; j++) {
            let t = candles[j].high - candles[j].low
            if (j > 0) {
              t = Math.max(t, Math.abs(candles[j].high - candles[j - 1].close), Math.abs(candles[j].low - candles[j - 1].close))
            }
            sum += t
          }
          atrValues.push(sum / 14)
        } else {
          atrValues.push(trSum / (i + 1))
        }
      }

      const currentAtr = atrValues[atrValues.length - 1] || 0
      const sumAtr = atrValues.reduce((s, x) => s + x, 0)
      const referenceAtr = sumAtr / atrValues.length

      return { currentAtr, referenceAtr }
    } catch (e) {
      this.log.warn(`Failed to fetch ATR stats: ${(e as Error).message}`)
      return null
    }
  }
}
