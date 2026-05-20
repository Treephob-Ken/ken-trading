import { buildLines, deriveOrderSize, type GridConfig } from './config.js'
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

  private currentPrice = 0
  private startedAt = 0
  private state: BotStats['state'] = 'init'
  private stopReason: string | undefined
  private allMidsSub: { unsubscribe(): Promise<void> } | null = null
  private statsTimer: NodeJS.Timeout | null = null
  private shuttingDown = false

  // Exchange-side safety triggers — these are real orders on Hyperliquid that
  // close position even if the bot/server is offline.
  private slTriggerOid: number | null = null
  private tpTriggerOid: number | null = null

  constructor(clients: HLClients, cfg: GridConfig, logger?: Logger) {
    this.clients = clients
    this.cfg = cfg
    this.lines = buildLines(cfg)
    this.log = logger ?? defaultLog
  }

  async start(): Promise<void> {
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

    await this.setLeverage()
    await this.cancelExistingOrders()

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
    } else {
      await this.placeInitialOrders()
      await this.placeSafetyTriggers()
      this.state = 'live'
      this.log.ok(`Bot live. ${this.orders.size} resting orders on ${this.cfg.asset}.`)
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
          a: this.meta.index,
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
        asset: this.meta.index,
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
      cancels: mine.map((o) => ({ a: this.meta.index, o: o.oid })),
    })
    this.log.ok(`Cancelled ${mine.length} pre-existing ${this.cfg.asset} orders.`)
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
            a: this.meta.index,
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
    if (this.state === 'stopped' || this.shuttingDown) return

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
          cancels: mine.map((o) => ({ a: this.meta.index, o: o.oid })),
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
            a: this.meta.index,
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
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    if (this.statsTimer) clearInterval(this.statsTimer)
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
      cancels: mine.map((o) => ({ a: this.meta.index, o: o.oid })),
    })
    this.log.ok(`Cancelled ${mine.length} orders.`)
  }
}
