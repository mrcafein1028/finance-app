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

/** Thứ tự lệnh: theo ngày, cùng ngày theo thời điểm nhập; trùng cả thời điểm thì mua trước bán (không thể bán thứ chưa mua). */
const SIDE_ORDER = { buy: 0, sell: 1 } as const
export const sortTrades = (trades: readonly InvestmentTrade[]) =>
  [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || SIDE_ORDER[a.side] - SIDE_ORDER[b.side] || a.id.localeCompare(b.id))

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

// ---------------------------------------------------------------- nhập lệnh (form F5)

/** Phí / thuế nhập theo số tiền hoặc theo % giá trị lệnh (VD CCQ: phí bán 1,5%, thuế TNCN khi bán 0,1%). */
export type CostInput = { mode: 'amount'; amount: Money } | { mode: 'percent'; rate: number }

export interface TradeEntry {
  side: 'buy' | 'sell'
  /** Số lượng dạng chuỗi thập phân (VD "196.5"). */
  quantity: string
  /** Nhập giá mỗi đơn vị, HOẶC tổng giá trị lệnh (trước phí, thuế) — app tự suy ra giá. */
  price: { mode: 'unit'; unitPrice: Money } | { mode: 'total'; total: Money }
  fee: CostInput
  tax: CostInput
}

export interface TradeAmounts {
  /** Giá / đơn vị lưu vào lệnh (số nguyên đồng). */
  unitPrice: Money
  /** Giá trị lệnh = số lượng × giá. */
  gross: Money
  fee: Money
  tax: Money
  /** Mua: tiền phải trả (giá trị + phí + thuế). Bán: tiền thực nhận (giá trị − phí − thuế). */
  cash: Money
  /** Nhập theo tổng tiền: giá làm tròn tới đồng nên giá trị tính lại có thể lệch vài đồng so với số đã nhập. */
  roundingDifference: Money
}

const costOf = (c: CostInput, gross: Money): Money => (c.mode === 'amount' ? c.amount : round(new D(gross).times(c.rate)))

export function tradeAmounts(e: TradeEntry): TradeAmounts {
  const q = new D(e.quantity)
  if (!q.isFinite() || q.lte(0)) throw new DomainError('invalid_quantity', 'Số lượng phải lớn hơn 0')
  const unitPrice = e.price.mode === 'unit' ? e.price.unitPrice : round(new D(e.price.total).div(q))
  const gross = round(q.times(unitPrice))
  const fee = costOf(e.fee, gross)
  const tax = costOf(e.tax, gross)
  const cash = e.side === 'buy' ? gross + fee + tax : gross - fee - tax
  return { unitPrice, gross, fee, tax, cash, roundingDifference: e.price.mode === 'total' ? gross - e.price.total : 0 }
}
