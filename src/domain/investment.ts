import { DomainError } from './errors'
import { D, round, type Dec } from './money'
import type { Holding, InvestmentTrade, IsoDate, Money, PriceQuote } from './types'

// Giá vốn bình quân (docs/04 §7). Số lượng tính bằng Decimal (0,00125 BTC không mất chính xác).

export interface Position {
  quantity: Dec
  /** Giá vốn bình quân / đơn vị (chưa làm tròn, để không trôi sai số qua nhiều lệnh). */
  avgCost: Dec
  costBasis: Money
  realized: Money
  feesAndTaxes: Money
}

/** Thứ tự lệnh: theo ngày, cùng ngày theo thời điểm nhập. */
export const sortTrades = (trades: readonly InvestmentTrade[]) =>
  [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))

/** Vị thế của một mã tính tới cuối ngày `date`. Bán quá số đang có → DomainError (bất biến I5). */
export function positionAt(trades: readonly InvestmentTrade[], date: IsoDate): Position {
  let quantity = new D(0)
  let avgCost = new D(0)
  let realized = 0
  let feesAndTaxes = 0

  for (const t of sortTrades(trades)) {
    if (t.date > date) break
    const q = new D(t.quantity)
    feesAndTaxes += t.fee + t.tax
    if (t.side === 'buy') {
      const total = quantity.plus(q)
      avgCost = quantity.times(avgCost).plus(q.times(t.price)).div(total)
      quantity = total
    } else {
      if (q.gt(quantity)) {
        throw new DomainError('oversell', `Ngày ${t.date}: bán ${t.quantity} nhưng chỉ đang có ${quantity.toString()}`)
      }
      realized += round(q.times(new D(t.price).minus(avgCost)))
      quantity = quantity.minus(q)
      if (quantity.isZero()) avgCost = new D(0)
    }
  }
  return { quantity, avgCost, costBasis: round(quantity.times(avgCost)), realized, feesAndTaxes }
}

/**
 * Tiền mặt thay đổi do lệnh trong TK đầu tư tới ngày `date`: mua −qty×giá, bán +qty×giá.
 * Vị thế đầu kỳ (isOpening) không trừ tiền. Phí/thuế là giao dịch chi phí riêng nên không tính ở đây.
 */
export function tradeCashFlow(trades: readonly InvestmentTrade[], date: IsoDate): Money {
  let flow = 0
  for (const t of trades) {
    if (t.date > date || t.isOpening) continue
    const gross = round(new D(t.quantity).times(t.price))
    flow += t.side === 'buy' ? -gross : gross
  }
  return flow
}

/** Tra giá theo ngày: bản ghi gần nhất có ngày ≤ date. */
export function createPriceBook(quotes: readonly PriceQuote[]) {
  const bySymbol = new Map<string, PriceQuote[]>()
  for (const q of quotes) {
    const list = bySymbol.get(q.symbol) ?? []
    list.push(q)
    bySymbol.set(q.symbol, list)
  }
  for (const list of bySymbol.values()) list.sort((a, b) => a.date.localeCompare(b.date))

  return {
    latest(symbol: string, date: IsoDate): PriceQuote | undefined {
      const list = bySymbol.get(symbol)
      if (!list) return undefined
      let found: PriceQuote | undefined
      for (const q of list) {
        if (q.date > date) break
        found = q
      }
      return found
    },
  }
}

export type PriceBook = ReturnType<typeof createPriceBook>

export interface HoldingValuation {
  holding: Holding
  position: Position
  price: Money
  /** Ngày của giá đang dùng; null = chưa có giá nào, đang dùng giá vốn. */
  priceDate: IsoDate | null
  marketValue: Money
  unrealized: Money
  /** Lãi/lỗ chưa thực hiện / giá vốn; null nếu giá vốn 0. */
  returnPct: number | null
  /** Lãi/lỗ sau phí = thực hiện + chưa thực hiện − phí & thuế. */
  netProfit: Money
}

export function valueHolding(holding: Holding, trades: readonly InvestmentTrade[], prices: PriceBook, date: IsoDate): HoldingValuation {
  const position = positionAt(trades, date)
  const quote = prices.latest(holding.symbol, date)
  const priceDec = quote ? new D(quote.price) : position.avgCost
  const marketValue = round(position.quantity.times(priceDec))
  const unrealized = marketValue - position.costBasis
  return {
    holding,
    position,
    price: round(priceDec),
    priceDate: quote?.date ?? null,
    marketValue,
    unrealized,
    returnPct: position.costBasis > 0 ? unrealized / position.costBasis : null,
    netProfit: position.realized + unrealized - position.feesAndTaxes,
  }
}
