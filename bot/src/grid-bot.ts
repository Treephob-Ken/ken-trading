import { buildLines, type GridConfig } from './config.js'
import {
  getAssetMeta,
  roundPrice,
  roundSize,
  type AssetMeta,
  type HLClients,
} from './hyperliquid.js'
import { log } from './logger.js'

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

// Live grid bot. Strategy: at every grid LINE we keep exactly one resting
// order — buys below current price, sells above. When one fills, place an
// opposite order one line up (after a buy) or one line down (after a sell).
// Realized P&L is taken directly from Hyperliquid's `closedPnl` so it
// accounts for fees and matches what the UI shows.
export class GridBot {
  private clients: HLClients
  private cfg: GridConfig
  private lines: number[]
  private meta!: AssetMeta

  private orders = new Map<number, TrackedOrder>() // oid -> order
  private ordersByLine = new Map<number, number>() // lineIdx -> oid

  private realizedPnl = 0
  private feesPaid = 0
  private totalFills = 0
  private completedRoundtrips = 0

  constructor(clients: HLClients, cfg: GridConfig) {
    this.clients = clients
    this.cfg = cfg
    this.lines = buildLines(cfg)
  }

  async start(): Promise<void> {
    this.meta = await getAssetMeta(this.clients.info, this.cfg.asset)
    log.info(
      `${this.cfg.asset} markPx=${this.meta.markPx} midPx=${this.meta.midPx} szDec=${this.meta.szDecimals} pxDec=${this.meta.pxDecimals}`,
    )

    await this.cancelExistingOrders()

    log.info(`Grid lines (${this.lines.length}):`)
    for (let i = 0; i < this.lines.length; i++) {
      log.info(`  [${i}] ${this.lines[i].toFixed(this.meta.pxDecimals)}`)
    }

    await this.subscribeFills()
    await this.placeInitialOrders()

    log.ok(`Bot live. ${this.orders.size} resting orders on ${this.cfg.asset}.`)
    this.startStatsTimer()
  }

  private async cancelExistingOrders(): Promise<void> {
    const open = await this.clients.info.openOrders({ user: this.clients.user })
    const mine = open.filter((o) => o.coin === this.cfg.asset)
    if (mine.length === 0) {
      log.ok('No existing orders to clear.')
      return
    }
    await this.clients.exchange.cancel({
      cancels: mine.map((o) => ({ a: this.meta.index, o: o.oid })),
    })
    log.ok(`Cancelled ${mine.length} pre-existing ${this.cfg.asset} orders.`)
  }

  private async placeInitialOrders(): Promise<void> {
    const currentPrice = this.meta.midPx
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
    if (this.ordersByLine.has(lineIdx)) return // already an order at this line

    const sz = roundSize(this.cfg.orderSize, this.meta)
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
        log.warn(`Order at line ${lineIdx} returned status "${status}"`)
      } else if ('resting' in status) {
        const oid = status.resting.oid
        const tracked: TrackedOrder = {
          oid,
          side,
          price,
          size: this.cfg.orderSize,
          lineIdx,
        }
        this.orders.set(oid, tracked)
        this.ordersByLine.set(lineIdx, oid)
        log.info(`-> ${side.toUpperCase()} ${sz} @ ${px} (line ${lineIdx}, oid ${oid})`)
      } else if ('filled' in status) {
        log.warn(
          `Order at line ${lineIdx} crossed on placement: filled ${status.filled.totalSz} @ ${status.filled.avgPx}`,
        )
      }
    } catch (e) {
      log.err(`placeOrder ${side} line=${lineIdx}: ${(e as Error).message}`)
    }
  }

  private async subscribeFills(): Promise<void> {
    await this.clients.subs.userFills(
      { user: this.clients.user },
      (event) => {
        if (event.isSnapshot) return // initial snapshot — historical, skip
        for (const fill of event.fills) this.handleFill(fill as UserFill)
      },
    )
    log.ok('Subscribed to userFills.')
  }

  private handleFill(fill: UserFill): void {
    if (fill.coin !== this.cfg.asset) return

    const tracked = this.orders.get(fill.oid)
    if (!tracked) return // not one of ours (or already processed)

    const price = Number(fill.px)
    const size = Number(fill.sz)
    const fee = Number(fill.fee)
    const closedPnl = Number(fill.closedPnl)

    this.totalFills++
    this.feesPaid += fee
    this.realizedPnl += closedPnl
    if (closedPnl !== 0) this.completedRoundtrips++

    this.orders.delete(fill.oid)
    this.ordersByLine.delete(tracked.lineIdx)

    log.fill(
      `${tracked.side.toUpperCase()} ${size} @ ${price.toFixed(this.meta.pxDecimals)} ` +
        `(line ${tracked.lineIdx}) fee=$${fee.toFixed(4)} pnl=$${closedPnl.toFixed(4)} ` +
        `| realized=$${this.realizedPnl.toFixed(2)} trades=${this.completedRoundtrips}`,
    )

    // Place opposite order one line away
    const newLine =
      tracked.side === 'buy' ? tracked.lineIdx + 1 : tracked.lineIdx - 1
    const newSide: 'buy' | 'sell' = tracked.side === 'buy' ? 'sell' : 'buy'
    if (newLine >= 0 && newLine < this.lines.length) {
      void this.placeOrder(newLine, newSide, this.lines[newLine])
    }
  }

  private startStatsTimer(): void {
    setInterval(() => {
      log.info(
        `STATS realized=$${this.realizedPnl.toFixed(2)} | fees=$${this.feesPaid.toFixed(2)} | ` +
          `roundtrips=${this.completedRoundtrips} | fills=${this.totalFills} | open=${this.orders.size}`,
      )
    }, 30_000)
  }

  async shutdown(): Promise<void> {
    log.warn('Cancelling all open orders before exit...')
    const open = await this.clients.info.openOrders({ user: this.clients.user })
    const mine = open.filter((o) => o.coin === this.cfg.asset)
    if (mine.length === 0) {
      log.ok('No orders to cancel.')
      return
    }
    await this.clients.exchange.cancel({
      cancels: mine.map((o) => ({ a: this.meta.index, o: o.oid })),
    })
    log.ok(`Cancelled ${mine.length} orders.`)
  }
}
