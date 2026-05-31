// Turn an SMCResult + current price into a plain-language "what to watch" read.
// Pure and testable. Mirrors the confluence method from the SMC tutorials:
// bias (last structure) + where price sits (premium/discount) + nearest
// order block / liquidity / fair value gap.

import type { SMCResult, OrderBlock, EqualLevel, FairValueGap } from './types'

export interface SMCSummary {
  bias: 'bullish' | 'bearish' | 'neutral'
  zone: 'premium' | 'discount' | 'equilibrium' | null
  nearestDemand: OrderBlock | null   // bullish OB at/below price
  nearestSupply: OrderBlock | null   // bearish OB at/above price
  liquidityAbove: EqualLevel | null  // EQH above price (sell-side target)
  liquidityBelow: EqualLevel | null  // EQL below price (buy-side target)
  nearestFvgBelow: FairValueGap | null
  nearestFvgAbove: FairValueGap | null
  note: string
}

export function summarizeSMC(result: SMCResult, price: number): SMCSummary {
  const bias: SMCSummary['bias'] = result.structures.length
    ? result.structures[result.structures.length - 1].bias
    : 'neutral'

  let zone: SMCSummary['zone'] = null
  if (result.zones) {
    const { top, bottom, equilibrium } = result.zones
    const band = (top - bottom) * 0.05 // ±5% of range counts as equilibrium
    if (Math.abs(price - equilibrium) <= band) zone = 'equilibrium'
    else zone = price > equilibrium ? 'premium' : 'discount'
  }

  // Nearest demand OB below price (closest top ≤ price); supply above (closest bottom ≥ price).
  const demand = result.orderBlocks.filter(o => o.bias === 'bullish' && o.top <= price)
  const supply = result.orderBlocks.filter(o => o.bias === 'bearish' && o.bottom >= price)
  const nearestDemand = demand.length ? demand.reduce((a, b) => (b.top > a.top ? b : a)) : null
  const nearestSupply = supply.length ? supply.reduce((a, b) => (b.bottom < a.bottom ? b : a)) : null

  const eqh = result.equalLevels.filter(e => e.kind === 'EQH' && e.level > price)
  const eql = result.equalLevels.filter(e => e.kind === 'EQL' && e.level < price)
  const liquidityAbove = eqh.length ? eqh.reduce((a, b) => (b.level < a.level ? b : a)) : null
  const liquidityBelow = eql.length ? eql.reduce((a, b) => (b.level > a.level ? b : a)) : null

  const fvgBelow = result.fairValueGaps.filter(g => g.top <= price)
  const fvgAbove = result.fairValueGaps.filter(g => g.bottom >= price)
  const nearestFvgBelow = fvgBelow.length ? fvgBelow.reduce((a, b) => (b.top > a.top ? b : a)) : null
  const nearestFvgAbove = fvgAbove.length ? fvgAbove.reduce((a, b) => (b.bottom < a.bottom ? b : a)) : null

  return {
    bias, zone, nearestDemand, nearestSupply, liquidityAbove, liquidityBelow,
    nearestFvgBelow, nearestFvgAbove,
    note: buildNote(bias, zone, nearestDemand, nearestSupply),
  }
}

function buildNote(
  bias: SMCSummary['bias'],
  zone: SMCSummary['zone'],
  demand: OrderBlock | null,
  supply: OrderBlock | null,
): string {
  if (bias === 'neutral') return 'No confirmed structure yet — wait for a BOS/CHoCH to set direction.'

  if (bias === 'bullish') {
    if (zone === 'premium')
      return 'Bias is bullish but price is in PREMIUM (expensive). Don’t chase longs — wait for a pull-back into discount.'
    const ob = demand ? ` near the demand zone ${demand.bottom}–${demand.top}` : ''
    return `Bias is bullish and price is in ${zone ?? 'range'}. Look for a bullish CHoCH${ob} to go long; stop below the swing, target the premium zone (~2R).`
  }

  // bearish
  if (zone === 'discount')
    return 'Bias is bearish but price is in DISCOUNT (cheap). Don’t chase shorts — wait for a rally into premium.'
  const ob = supply ? ` near the supply zone ${supply.bottom}–${supply.top}` : ''
  return `Bias is bearish and price is in ${zone ?? 'range'}. Look for a bearish CHoCH${ob} to go short; stop above the swing, target the discount zone (~2R).`
}
