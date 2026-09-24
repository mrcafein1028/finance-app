import { bucketBreakdown, incomeInPeriod, spendingByCategory } from './budget'
import { addDays, diffDays } from './dates'
import { netWorthAt, type Ledger } from './networth'
import { nextMonth, periodOf, periodRange, previousMonth, type PeriodRange } from './period'
import type { Category, IsoDate, Money, MonthKey, Transaction } from './types'

// Dữ liệu cho các biểu đồ báo cáo (docs/07 §2). Hàm thuần: nhận sổ cái/giao dịch, trả mảng điểm.

/** Các kỳ gần nhất kết thúc bằng kỳ chứa `today` (cũ → mới). */
export function recentMonths(today: IsoDate, count: number, startDay: number): MonthKey[] {
  const months: MonthKey[] = []
  for (let m = periodOf(today, startDay), i = 0; i < count; m = previousMonth(m), i++) months.unshift(m)
  return months
}

/** Mọi kỳ từ kỳ chứa `from` tới kỳ chứa `today`. */
export function monthsBetween(from: IsoDate, today: IsoDate, startDay: number, max = 120): MonthKey[] {
  const months: MonthKey[] = []
  for (let m = periodOf(from, startDay); months.length < max; m = nextMonth(m)) {
    months.push(m)
    if (m >= periodOf(today, startDay)) break
  }
  return months
}

export interface NetWorthPoint {
  month: MonthKey
  date: IsoDate
  assets: Money
  /** Âm để vẽ bên dưới trục. */
  liabilities: Money
  netWorth: Money
}

/** R1 — net worth cuối mỗi kỳ (kỳ hiện tại tính tới hôm nay). */
export function netWorthSeries(ledger: Ledger, months: readonly MonthKey[], startDay: number, today: IsoDate): NetWorthPoint[] {
  return months.map((month) => {
    const end = periodRange(month, startDay).end
    const date = end < today ? end : today
    const nw = netWorthAt(ledger, date)
    return { month, date, assets: nw.totalAssets, liabilities: -nw.totalLiabilities, netWorth: nw.netWorth }
  })
}

export interface CashflowPoint {
  month: MonthKey
  income: Money
  needs: Money
  wants: Money
  expense: Money
  net: Money
  /** null khi chưa có thu nhập. */
  savingsRate: number | null
}

/** R5/R7/R8 — thu, chi theo nhóm, tỉ lệ tiết kiệm mỗi kỳ. */
export function cashflowSeries(transactions: readonly Transaction[], categories: readonly Category[], months: readonly MonthKey[], startDay: number): CashflowPoint[] {
  return months.map((month) => {
    const range = periodRange(month, startDay)
    const b = bucketBreakdown(transactions, categories, range)
    const expense = b.needs + b.wants
    return { month, income: b.income, needs: b.needs, wants: b.wants, expense, net: b.income - expense, savingsRate: b.income > 0 ? (b.income - expense) / b.income : null }
  })
}

export interface CategoryAmount {
  categoryId: string
  amount: Money
}

/** Chi tiêu theo danh mục cấp 1 (gộp con vào cha) trong kỳ, lớn → nhỏ. */
export function spendingByTopCategory(transactions: readonly Transaction[], categories: readonly Category[], range: PeriodRange): CategoryAmount[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const totals = new Map<string, Money>()
  for (const [id, amount] of spendingByCategory(transactions, range)) {
    const top = byId.get(id)?.parentId ?? id
    totals.set(top, (totals.get(top) ?? 0) + amount)
  }
  return [...totals].map(([categoryId, amount]) => ({ categoryId, amount })).filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount)
}

export interface DaySpend {
  date: IsoDate
  amount: Money
}

/** R14 — tổng chi mỗi ngày trong kỳ (kể cả ngày 0 đồng). */
export function dailySpending(transactions: readonly Transaction[], range: PeriodRange): DaySpend[] {
  const days = diffDays(range.start, range.end) + 1
  const totals = new Map<IsoDate, Money>()
  for (const t of transactions) {
    if (t.date < range.start || t.date > range.end) continue
    if (t.type === 'expense') totals.set(t.date, (totals.get(t.date) ?? 0) + t.amount)
    if (t.type === 'refund') totals.set(t.date, (totals.get(t.date) ?? 0) - t.amount)
  }
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(range.start, i)
    return { date, amount: Math.max(0, totals.get(date) ?? 0) }
  })
}

/** Trung bình trượt `window` điểm (điểm đầu dùng số điểm có). */
export function movingAverage(values: readonly number[], window = 3): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1)
    return slice.reduce((s, v) => s + v, 0) / slice.length
  })
}

export { incomeInPeriod }
