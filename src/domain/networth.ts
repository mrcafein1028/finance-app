import { indexTransactionsByAccount, ledgerBalance, netWorthEffect } from './balance'
import { addDays } from './dates'
import { periodRange } from './period'
import { createPriceBook, tradeCashFlow, valueHolding, type HoldingValuation, type PriceBook } from './investment'
import { sum } from './money'
import { termActiveAt, unpaidAccruedInterest } from './savings'
import type {
  Account,
  AccountKind,
  AssetValuation,
  DepositTerm,
  Holding,
  InvestmentTrade,
  IsoDate,
  Money,
  MonthKey,
  NetWorthSnapshot,
  PriceQuote,
  Transaction,
} from './types'

/** Toàn bộ dữ liệu gốc cần để tính giá trị tài sản tại bất kỳ ngày nào. */
export interface LedgerData {
  accounts: readonly Account[]
  transactions: readonly Transaction[]
  holdings?: readonly Holding[]
  trades?: readonly InvestmentTrade[]
  prices?: readonly PriceQuote[]
  valuations?: readonly AssetValuation[]
  depositTerms?: readonly DepositTerm[]
  /** Cài đặt G4: cộng lãi dồn tích chưa nhận vào giá trị sổ tiết kiệm. */
  includeAccruedInterest?: boolean
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}

/** Dựng chỉ mục một lần, sau đó tính giá trị cho nhiều ngày/nhiều account mà không quét lại toàn bộ dữ liệu. */
export function createLedger(data: LedgerData) {
  const txByAccount = indexTransactionsByAccount(data.transactions)
  const holdingsByAccount = groupBy(data.holdings ?? [], (h) => h.accountId)
  const tradesByHolding = groupBy(data.trades ?? [], (t) => t.holdingId)
  const valuationsByAccount = groupBy(data.valuations ?? [], (v) => v.accountId)
  const termsByAccount = groupBy(data.depositTerms ?? [], (t) => t.accountId)
  const prices: PriceBook = createPriceBook(data.prices ?? [])
  const includeAccrued = data.includeAccruedInterest ?? true

  const transactionsOf = (accountId: string) => txByAccount.get(accountId) ?? []

  function holdingValuations(account: Account, date: IsoDate): HoldingValuation[] {
    return (holdingsByAccount.get(account.id) ?? []).map((h) => valueHolding(h, tradesByHolding.get(h.id) ?? [], prices, date))
  }

  /** Giá trị account tại cuối ngày `date` theo loại (docs/04 §3). Nợ: dư nợ (dương). */
  function valueOf(account: Account, date: IsoDate): Money {
    if (date < account.openingDate) return 0
    const balance = ledgerBalance(account, transactionsOf(account.id), date)
    switch (account.kind) {
      case 'term_deposit': {
        if (!includeAccrued) return balance
        const term = termActiveAt(termsByAccount.get(account.id) ?? [], date)
        return balance + (term ? unpaidAccruedInterest(term, account.details.interestPayout, date) : 0)
      }
      case 'investment': {
        const holdings = holdingsByAccount.get(account.id) ?? []
        const cashFromTrades = sum(holdings.map((h) => tradeCashFlow(tradesByHolding.get(h.id) ?? [], date)))
        return balance + cashFromTrades + sum(holdingValuations(account, date).map((v) => v.marketValue))
      }
      case 'other_asset': {
        let latest: AssetValuation | undefined
        for (const v of valuationsByAccount.get(account.id) ?? []) if (v.date <= date && (!latest || v.date >= latest.date)) latest = v
        // Định giá = giá trị ĐẦU ngày định giá (giống số dư đầu); giao dịch từ ngày đó trở đi vẫn được
        // cộng dồn — VD định giá 3 tỷ rồi bán 3 tỷ cùng ngày → giá trị còn 0.
        if (!latest) return balance
        const after = transactionsOf(account.id).filter((t) => t.date >= latest.date && t.date <= date)
        return latest.value + ledgerBalance({ ...account, openingBalance: 0, openingDate: latest.date }, after, date)
      }
      default:
        return balance
    }
  }

  return { accounts: data.accounts, valueOf, holdingValuations, transactionsOf, prices }
}

export type Ledger = ReturnType<typeof createLedger>

/** Account có được tính vào net worth tại ngày `date` không: bật includeInNetWorth, chưa lưu trữ trước ngày đó. */
export function countsTowardNetWorth(account: Account, date: IsoDate): boolean {
  if (!account.includeInNetWorth) return false
  return account.archivedAt === null || account.archivedAt.slice(0, 10) > date
}

export interface NetWorth {
  date: IsoDate
  totalAssets: Money
  totalLiabilities: Money
  netWorth: Money
  liquidAssets: Money
  /** Giá trị theo loại / account (có dấu như số dư gốc: tài sản thấu chi có thể âm). */
  byKind: Partial<Record<AccountKind, Money>>
  byAccount: Record<string, Money>
}

/**
 * Net worth tại cuối ngày `date` (docs/04 §8). Số dư âm của tài sản (thấu chi) được tính sang nợ,
 * dư nợ âm (trả thừa) được tính sang tài sản — net worth không đổi, còn các tổng luôn ≥ 0.
 */
export function netWorthAt(ledger: Ledger, date: IsoDate): NetWorth {
  let assets = 0
  let liabilities = 0
  let liquid = 0
  const byKind: Partial<Record<AccountKind, Money>> = {}
  const byAccount: Record<string, Money> = {}

  for (const account of ledger.accounts) {
    if (!countsTowardNetWorth(account, date) || date < account.openingDate) continue
    const value = ledger.valueOf(account, date)
    byAccount[account.id] = value
    byKind[account.kind] = (byKind[account.kind] ?? 0) + value
    const signed = account.class === 'asset' ? value : -value
    if (signed >= 0) assets += signed
    else liabilities -= signed
    if (account.isLiquid && value > 0) liquid += value
  }
  return { date, totalAssets: assets, totalLiabilities: liabilities, netWorth: assets - liabilities, liquidAssets: liquid, byKind, byAccount }
}

export interface NetWorthChange {
  from: IsoDate
  to: IsoDate
  startNetWorth: Money
  endNetWorth: Money
  /** Số dư ban đầu của account bắt đầu theo dõi trong kỳ. */
  openingBalances: Money
  income: Money
  /** Số âm: chi tiêu làm giảm net worth. */
  expense: Money
  refund: Money
  adjustment: Money
  /** Chuyển tiền với account không tính vào net worth. */
  externalTransfer: Money
  /** Giá thị trường đầu tư thay đổi. */
  market: Money
  /** Định giá lại tài sản khác. */
  revaluation: Money
  /** Lãi tiết kiệm dồn tích (chưa nhận). */
  accruedInterest: Money
  /** Phần còn lại (VD account bị lưu trữ giữa kỳ) — thường bằng 0. */
  other: Money
}

/**
 * Phân rã ΔNW trong kỳ [from, to] cho biểu đồ thác nước (docs/04 §8, R2).
 * Đẳng thức luôn đúng tới từng đồng: start + Σ các mục = end (bất biến bắt buộc, docs/08 §1).
 */
export function explainNetWorthChange(ledger: Ledger, from: IsoDate, to: IsoDate): NetWorthChange {
  const before = addDays(from, -1)
  const start = netWorthAt(ledger, before)
  const end = netWorthAt(ledger, to)
  const result: NetWorthChange = {
    from,
    to,
    startNetWorth: start.netWorth,
    endNetWorth: end.netWorth,
    openingBalances: 0,
    income: 0,
    expense: 0,
    refund: 0,
    adjustment: 0,
    externalTransfer: 0,
    market: 0,
    revaluation: 0,
    accruedInterest: 0,
    other: 0,
  }
  const included = new Set(ledger.accounts.filter((a) => countsTowardNetWorth(a, to) && countsTowardNetWorth(a, before)).map((a) => a.id))

  for (const account of ledger.accounts) {
    const signOf = (v: Money) => (account.class === 'asset' ? v : -v)
    const startValue = signOf(start.byAccount[account.id] ?? 0)
    const endValue = signOf(end.byAccount[account.id] ?? 0)
    if (!included.has(account.id)) {
      result.other += endValue - startValue
      continue
    }
    let flows = 0
    for (const tx of ledger.transactionsOf(account.id)) {
      if (tx.date < from || tx.date > to) continue
      const effect = netWorthEffect(tx, account)
      flows += effect
      if (tx.type === 'income') result.income += effect
      else if (tx.type === 'expense') result.expense += effect
      else if (tx.type === 'refund') result.refund += effect
      else if (tx.type === 'adjustment') result.adjustment += effect
      else {
        const other = tx.accountId === account.id ? tx.toAccountId : tx.accountId
        if (!included.has(other)) result.externalTransfer += effect
      }
    }
    // Account mở trong kỳ: số dư ban đầu là "mang vào", không phải biến động thị trường.
    const opening = account.openingDate >= from && account.openingDate <= to ? signOf(account.openingBalance) : 0
    result.openingBalances += opening
    const residual = endValue - startValue - flows - opening
    if (account.kind === 'investment') result.market += residual
    else if (account.kind === 'other_asset') result.revaluation += residual
    else if (account.kind === 'term_deposit') result.accruedInterest += residual
    else result.other += residual
  }
  return result
}

/** Tổng các mục phân rã — luôn bằng endNetWorth − startNetWorth. */
export const sumOfChange = (c: NetWorthChange) =>
  c.openingBalances + c.income + c.expense + c.refund + c.adjustment + c.externalTransfer + c.market + c.revaluation + c.accruedInterest + c.other

/** Snapshot cuối kỳ ngân sách `month` (docs/03 §3.11) — cache, luôn tính lại được. */
export function buildSnapshot(
  ledger: Ledger,
  month: MonthKey,
  periodStartDay: number,
  computedAt: string,
): Omit<NetWorthSnapshot, 'id'> {
  const asOf = periodRange(month, periodStartDay).end
  const nw = netWorthAt(ledger, asOf)
  return {
    month,
    asOf,
    totalAssets: nw.totalAssets,
    totalLiabilities: nw.totalLiabilities,
    netWorth: nw.netWorth,
    liquidAssets: nw.liquidAssets,
    byKind: nw.byKind,
    byAccount: nw.byAccount,
    computedAt,
    stale: false,
  }
}
