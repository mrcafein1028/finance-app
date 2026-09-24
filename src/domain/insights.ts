import { formatDate, formatMoney, formatMoneyCompact } from '../lib/format'
import type { BucketBreakdown, BudgetMonthSummary } from './budget'
import { addDays, diffDays } from './dates'
import type { HoldingValuation } from './investment'
import { creditCardMinimumPayment, creditCardMonthsToPayoff, flatRateApr, prepay, type LoanTerms } from './loan'
import { D, ratio, round, sum } from './money'
import type { IsoDate, Money } from './types'

// ---------------------------------------------------------------------------
// Chỉ số sức khỏe tài chính (docs/04 §9)
// ---------------------------------------------------------------------------

export type Rating = 'good' | 'fair' | 'attention'

export interface Indicator {
  /** null = chưa đủ dữ liệu (không bao giờ NaN/∞). */
  value: number | null
  rating: Rating | null
}

export interface HealthInputs {
  /** Kỳ vừa đo (thường là tháng đã kết thúc gần nhất). */
  period: { income: Money; netCashFlow: Money } | null
  /** Tối đa 3 kỳ đã kết thúc gần nhất: thu nhập và chi Thiết yếu. */
  recentMonths: readonly { income: Money; needs: Money }[]
  /** Σ giá trị account đánh dấu quỹ khẩn cấp; null nếu chưa đánh dấu → dùng liquidAssets. */
  emergencyFund: Money | null
  liquidAssets: Money
  totalAssets: Money
  totalLiabilities: Money
  /** Σ khoản phải trả hàng tháng theo lịch (vay) + tối thiểu thẻ. */
  monthlyDebtPayments: Money
  creditCards: readonly { balance: Money; limit: Money }[]
  buckets: BucketBreakdown | null
  netWorthStart: Money | null
  netWorthEnd: Money
}

export interface HealthIndicators {
  savingsRate: Indicator
  emergencyMonths: Indicator
  debtToIncome: Indicator
  debtToAsset: Indicator
  creditUtilization: Indicator
  /** Độ lệch lớn nhất (điểm %) so với 50/30/20. */
  budgetRuleDeviation: Indicator
  netWorthGrowth: Indicator
  averageMonthlyNeeds: Money | null
  averageMonthlyIncome: Money | null
}

const indicator = (value: number | null, rate: (v: number) => Rating): Indicator => ({
  value,
  rating: value === null ? null : rate(value),
})

const average = (values: readonly number[]) => (values.length ? round(new D(sum(values)).div(values.length)) : null)

export function healthIndicators(h: HealthInputs): HealthIndicators {
  const months = h.recentMonths.slice(-3)
  const avgNeeds = average(months.map((m) => m.needs))
  const avgIncome = average(months.map((m) => m.income))
  const fund = h.emergencyFund ?? h.liquidAssets
  const cardBalance = sum(h.creditCards.map((c) => Math.max(0, c.balance)))
  const cardLimit = sum(h.creditCards.map((c) => c.limit))
  const shares = h.buckets?.shares ?? null
  const deviation = shares
    ? Math.max(Math.abs(shares.needs - 0.5), Math.abs(shares.wants - 0.3), Math.abs(shares.savings - 0.2)) * 100
    : null
  const growth =
    h.netWorthStart === null || h.netWorthStart === 0 ? null : (h.netWorthEnd - h.netWorthStart) / Math.abs(h.netWorthStart)

  return {
    savingsRate: indicator(h.period ? ratio(h.period.netCashFlow, h.period.income) : null, (v) =>
      v >= 0.2 ? 'good' : v >= 0.1 ? 'fair' : 'attention',
    ),
    emergencyMonths: indicator(avgNeeds === null ? null : ratio(fund, avgNeeds), (v) => (v >= 6 ? 'good' : v >= 3 ? 'fair' : 'attention')),
    debtToIncome: indicator(avgIncome === null ? null : ratio(h.monthlyDebtPayments, avgIncome), (v) =>
      v <= 0.3 ? 'good' : v <= 0.4 ? 'fair' : 'attention',
    ),
    debtToAsset: indicator(ratio(h.totalLiabilities, h.totalAssets), (v) => (v <= 0.3 ? 'good' : v <= 0.5 ? 'fair' : 'attention')),
    creditUtilization: indicator(ratio(cardBalance, cardLimit), (v) => (v < 0.3 ? 'good' : v <= 0.5 ? 'fair' : 'attention')),
    budgetRuleDeviation: indicator(deviation, (v) => (v <= 5 ? 'good' : v <= 15 ? 'fair' : 'attention')),
    netWorthGrowth: indicator(growth, (v) => (v > 0.005 ? 'good' : v >= -0.005 ? 'fair' : 'attention')),
    averageMonthlyNeeds: avgNeeds,
    averageMonthlyIncome: avgIncome,
  }
}

// ---------------------------------------------------------------------------
// Bộ sinh insight (docs/07 §3)
// ---------------------------------------------------------------------------

export type InsightPriority = 'high' | 'medium' | 'low'

export interface Insight {
  /** Duy nhất theo luật + đối tượng — dùng để "Ẩn" trong kỳ. */
  id: string
  code: string
  priority: InsightPriority
  tone: 'warning' | 'info' | 'positive'
  message: string
  /** Đường dẫn tới nơi xử lý. */
  href?: string
}

export interface InsightContext {
  today: IsoDate
  budget: BudgetMonthSummary | null
  categoryNames: ReadonlyMap<string, string>
  health: HealthIndicators
  emergencyFund: Money
  flatLoans?: readonly { accountId: string; name: string; annualRate: number; termMonths: number }[]
  creditCards?: readonly {
    accountId: string
    name: string
    balance: Money
    limit: Money
    annualRate: number
    minPaymentRate: number
    /** Số kỳ liên tiếp gần nhất chỉ trả tối thiểu. */
    minimumOnlyStreak?: number
  }[]
  deposits?: readonly { accountId: string; bankName: string; principal: Money; maturityDate: IsoDate; expectedInterest: Money }[]
  /** Chi tiêu các tháng trước (tối đa 3) theo danh mục, để so xu hướng. */
  categoryHistory?: ReadonlyMap<string, readonly Money[]>
  lastMonth?: { label: string; income: Money; netCashFlow: Money } | null
  netWorthNow?: Money
  netWorthHistory?: readonly Money[]
  loans?: readonly { accountId: string; name: string; terms: LoanTerms; outstanding: Money; annualRate: number; prepaymentFeeRate: number }[]
  /** Lãi suất tiết kiệm tốt nhất đang có — mốc so sánh cho I-PREPAY. */
  bestSavingsRate?: number
  emergencyTargetMonths?: number
  liquidAssets?: Money
  holdings?: readonly HoldingValuation[]
}

const pct = (value: number, digits = 0) =>
  new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: digits }).format(value)
const num = (value: number, digits = 1) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(value)

type Rule = (ctx: InsightContext) => Insight[]

const overBudget: Rule = ({ budget, categoryNames }) =>
  (budget?.lines ?? [])
    .filter((l) => l.status === 'over' && l.line.target.kind === 'category' && l.budget > 0)
    .map((l) => {
      const name = l.line.target.kind === 'category' ? (categoryNames.get(l.line.target.categoryId) ?? 'Danh mục') : ''
      const over = l.actual - l.budget
      return {
        id: `I-OVER:${l.line.targetKey}`,
        code: 'I-OVER',
        priority: 'high',
        tone: 'warning',
        message: `${name} đã vượt ${pct(over / l.budget)} (${formatMoney(over)}) ngân sách tháng.`,
        href: '/budget',
      }
    })

const paceWarning: Rule = ({ budget, categoryNames, today }) => {
  if (!budget) return []
  const elapsed = Math.min(diffDays(budget.range.start, today) + 1, diffDays(budget.range.start, budget.range.end) + 1)
  if (elapsed <= 0) return []
  return budget.lines
    .filter((l) => l.line.target.kind === 'category' && l.budget > 0 && l.actual < l.budget && l.actual > l.pace * 1.2)
    .flatMap((l) => {
      const perDay = l.actual / elapsed
      const exhaustDay = addDays(budget.range.start, Math.ceil(l.budget / perDay) - 1)
      if (exhaustDay > budget.range.end) return []
      const name = l.line.target.kind === 'category' ? (categoryNames.get(l.line.target.categoryId) ?? 'Danh mục') : ''
      return [
        {
          id: `I-PACE:${l.line.targetKey}`,
          code: 'I-PACE',
          priority: 'high' as const,
          tone: 'warning' as const,
          message: `Với tốc độ hiện tại, ${name} sẽ vượt ngân sách vào khoảng ngày ${formatDate(exhaustDay)}.`,
          href: '/budget',
        },
      ]
    })
}

const emergencyFund: Rule = ({ health, emergencyFund: fund }) => {
  const months = health.emergencyMonths.value
  const needs = health.averageMonthlyNeeds
  if (months === null || needs === null || months >= 3) return []
  return [
    {
      id: 'I-EMERG',
      code: 'I-EMERG',
      priority: 'high',
      tone: 'warning',
      message: `Quỹ khẩn cấp đủ cho ${num(months)} tháng chi tiêu thiết yếu. Cần thêm ${formatMoneyCompact(3 * needs - fund)} để đạt 3 tháng.`,
      href: '/accounts',
    },
  ]
}

const flatLoan: Rule = ({ flatLoans = [] }) =>
  flatLoans.map((l) => ({
    id: `I-FLAT:${l.accountId}`,
    code: 'I-FLAT',
    priority: 'high',
    tone: 'warning',
    message: `Khoản vay ${l.name} lãi phẳng ${pct(l.annualRate, 1)} tương đương ~${pct(flatRateApr(l.annualRate, l.termMonths), 1)}/năm thực tế.`,
    href: `/liabilities/${l.accountId}`,
  }))

const creditCard: Rule = ({ creditCards = [] }) =>
  creditCards.flatMap((c) => {
    const utilization = ratio(c.balance, c.limit)
    const minimumOnly = (c.minimumOnlyStreak ?? 0) >= 2
    if (!minimumOnly && (utilization === null || utilization <= 0.5)) return []
    let message = `Thẻ ${c.name} đang dùng ${pct(utilization ?? 0)} hạn mức.`
    if (minimumOnly) {
      const months = creditCardMonthsToPayoff(c.balance, c.annualRate, creditCardMinimumPayment(c.balance, c.minPaymentRate))
      message =
        months === null
          ? `Chỉ trả tối thiểu, dư nợ thẻ ${c.name} sẽ không bao giờ trả hết.`
          : `Chỉ trả tối thiểu, dư nợ thẻ ${c.name} sẽ mất ~${months >= 24 ? `${num(months / 12)} năm` : `${months} tháng`} để trả hết.`
    }
    return [{ id: `I-CARD:${c.accountId}`, code: 'I-CARD', priority: 'high' as const, tone: 'warning' as const, message, href: `/liabilities/${c.accountId}` }]
  })

const maturing: Rule = ({ deposits = [], today }) =>
  deposits
    .filter((d) => d.maturityDate <= addDays(today, 7))
    .map((d) => ({
      id: `I-MATURE:${d.accountId}:${d.maturityDate}`,
      code: 'I-MATURE',
      priority: 'medium',
      tone: 'info',
      message:
        d.maturityDate <= today
          ? `Sổ ${formatMoneyCompact(d.principal)} tại ${d.bankName} đã đáo hạn ngày ${formatDate(d.maturityDate)} — hãy xác nhận tái tục hoặc tất toán.`
          : `Sổ ${formatMoneyCompact(d.principal)} tại ${d.bankName} đáo hạn ngày ${formatDate(d.maturityDate)} — lãi dự kiến ${formatMoneyCompact(d.expectedInterest)}.`,
      href: `/savings/${d.accountId}`,
    }))

const spendingTrend: Rule = ({ budget, categoryHistory, categoryNames }) => {
  if (!budget || !categoryHistory) return []
  const current = new Map<string, Money>()
  for (const l of budget.lines) {
    if (l.line.target.kind === 'category') current.set(l.line.target.categoryId, l.actual)
  }
  for (const [id, amount] of budget.unbudgetedByCategory) current.set(id, amount)

  return [...current].flatMap(([categoryId, amount]) => {
    const history = categoryHistory.get(categoryId)?.slice(-3) ?? []
    if (history.length === 0) return []
    const avg = sum(history) / history.length
    if (avg <= 0 || amount <= avg * 1.3) return []
    return [
      {
        id: `I-TREND:${categoryId}`,
        code: 'I-TREND',
        priority: 'medium' as const,
        tone: 'info' as const,
        message: `Chi ${categoryNames.get(categoryId) ?? 'danh mục'} tăng ${pct(amount / avg - 1)} so với trung bình ${history.length} tháng.`,
        href: '/reports',
      },
    ]
  })
}

const goodSavings: Rule = ({ lastMonth }) => {
  const rate = lastMonth ? ratio(lastMonth.netCashFlow, lastMonth.income) : null
  if (!lastMonth || rate === null || rate < 0.2) return []
  return [
    {
      id: `I-SAVE:${lastMonth.label}`,
      code: 'I-SAVE',
      priority: 'low',
      tone: 'positive',
      message: `Bạn đã tiết kiệm ${pct(rate)} thu nhập ${lastMonth.label} — vượt mục tiêu 20%.`,
      href: '/reports',
    },
  ]
}

const netWorthHigh: Rule = ({ netWorthNow, netWorthHistory = [] }) => {
  if (netWorthNow === undefined || netWorthHistory.length === 0 || netWorthNow <= Math.max(...netWorthHistory)) return []
  return [{ id: 'I-NWHIGH', code: 'I-NWHIGH', priority: 'low', tone: 'positive', message: 'Net worth đạt mức cao nhất từ trước đến nay.', href: '/reports' }]
}

const prepayOpportunity: Rule = (ctx) => {
  const { loans = [], health, bestSavingsRate = 0, today } = ctx
  const needs = health.averageMonthlyNeeds
  if (needs === null || ctx.liquidAssets === undefined) return []
  const idle = ctx.liquidAssets - (ctx.emergencyTargetMonths ?? 6) * needs
  if (idle <= 0) return []
  const candidate = [...loans].filter((l) => l.outstanding > 0 && l.annualRate > bestSavingsRate).sort((a, b) => b.annualRate - a.annualRate)[0]
  if (!candidate) return []
  const amount = Math.min(idle, candidate.outstanding)
  const result = prepay(candidate.terms, candidate.outstanding, today, amount, 'reduce_term', candidate.prepaymentFeeRate)
  const saved = result.interestSaved - result.fee
  if (saved <= 0) return []
  return [
    {
      id: `I-PREPAY:${candidate.accountId}`,
      code: 'I-PREPAY',
      priority: 'medium',
      tone: 'info',
      message: `Trả trước ${formatMoneyCompact(amount)} khoản vay ${candidate.name} (${pct(candidate.annualRate, 1)}) sẽ tiết kiệm ~${formatMoneyCompact(saved)} lãi (đã trừ phí). Thông tin tham khảo, không phải tư vấn tài chính.`,
      href: `/liabilities/${candidate.accountId}`,
    },
  ]
}

const stalePrices: Rule = ({ holdings = [], today }) => {
  const stale = holdings.filter((h) => h.position.quantity.gt(0) && (h.priceDate === null || diffDays(h.priceDate, today) > 30))
  if (stale.length === 0) return []
  return [
    {
      id: `I-STALE:${today.slice(0, 7)}`,
      code: 'I-STALE',
      priority: 'medium',
      tone: 'info',
      message: `Giá ${stale.length} mã đầu tư đã cũ — net worth có thể chưa chính xác.`,
      href: '/investments',
    },
  ]
}

const unbudgeted: Rule = ({ budget }) => {
  if (!budget || budget.actualExpense <= 0 || budget.unbudgetedSpend <= budget.actualExpense * 0.1) return []
  return [
    {
      id: `I-UNBUDGET:${budget.month}`,
      code: 'I-UNBUDGET',
      priority: 'medium',
      tone: 'info',
      message: `${formatMoneyCompact(budget.unbudgetedSpend)} chi tiêu chưa thuộc dòng ngân sách nào.`,
      href: '/budget',
    },
  ]
}

export const INSIGHT_RULES: readonly Rule[] = [
  overBudget,
  paceWarning,
  emergencyFund,
  flatLoan,
  creditCard,
  maturing,
  spendingTrend,
  prepayOpportunity,
  stalePrices,
  unbudgeted,
  goodSavings,
  netWorthHigh,
]

const PRIORITY_ORDER: Record<InsightPriority, number> = { high: 0, medium: 1, low: 2 }

/** Mọi insight đang đúng, trừ những cái người dùng đã ẩn, sắp theo ưu tiên (ổn định theo thứ tự luật). */
export function generateInsights(ctx: InsightContext, dismissed: ReadonlySet<string> = new Set()): Insight[] {
  return INSIGHT_RULES.flatMap((rule) => rule(ctx))
    .filter((i) => !dismissed.has(i.id))
    .map((insight, order) => ({ insight, order }))
    .sort((a, b) => PRIORITY_ORDER[a.insight.priority] - PRIORITY_ORDER[b.insight.priority] || a.order - b.order)
    .map((x) => x.insight)
}

/** 3 insight quan trọng nhất cho Dashboard (D4). */
export const topInsights = (ctx: InsightContext, dismissed?: ReadonlySet<string>, limit = 3) => generateInsights(ctx, dismissed).slice(0, limit)
