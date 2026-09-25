import type { Repositories } from '../data/repositories'
import { bucketBreakdown, incomeInPeriod, spendingByCategory, summarizeBudgetChain, type BudgetMonthSummary } from '../domain/budget'
import { addDays } from '../domain/dates'
import { healthIndicators, type HealthIndicators, type InsightContext } from '../domain/insights'
import { creditCardMinimumPayment, loanTermsOf } from '../domain/loan'
import { createLedger, netWorthAt, type Ledger, type NetWorth } from '../domain/networth'
import { periodOf, periodRange, previousMonth, type PeriodRange } from '../domain/period'
import { termActiveAt, termInterest } from '../domain/savings'
import { monthLabel } from '../lib/format'
import type {
  Account,
  AccountOf,
  AssetValuation,
  BudgetLine,
  BudgetMonth,
  Category,
  DepositTerm,
  Holding,
  InvestmentTrade,
  NetWorthSnapshot,
  PriceQuote,
  RecurringRule,
  Settings,
  Transaction,
} from '../schemas'
import { isLoan, upcomingSchedule } from './liabilities'

// Tổng hợp thuần (không React) dùng chung cho giao diện và máy chủ MCP (Claude): cùng dữ liệu → cùng con số.

/** Dữ liệu gốc cần để dựng sổ cái. */
export interface LedgerRaw {
  settings: Settings
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  holdings: Holding[]
  trades: InvestmentTrade[]
  prices: PriceQuote[]
  valuations: AssetValuation[]
  depositTerms: DepositTerm[]
}

export interface LedgerView extends LedgerRaw {
  ledger: Ledger
  /** Giá trị hiện tại (hôm nay) theo account — tài sản: giá trị; nợ: dư nợ. */
  balances: Map<string, number>
  categoryById: Map<string, Category>
  accountById: Map<string, Account>
}

/** Toàn bộ dữ liệu gốc + sổ cái đã dựng sẵn — nền cho mọi màn hình tính số dư / net worth. */
export function buildLedgerView(raw: LedgerRaw, date: string): LedgerView {
  const ledger = createLedger({
    accounts: raw.accounts,
    transactions: raw.transactions,
    holdings: raw.holdings,
    trades: raw.trades,
    prices: raw.prices,
    valuations: raw.valuations,
    depositTerms: raw.depositTerms,
    includeAccruedInterest: raw.settings.includeAccruedInterest,
  })
  return {
    ...raw,
    ledger,
    balances: new Map(raw.accounts.map((a) => [a.id, ledger.valueOf(a, date)])),
    categoryById: new Map(raw.categories.map((c) => [c.id, c])),
    accountById: new Map(raw.accounts.map((a) => [a.id, a])),
  }
}

export interface Overview {
  view: LedgerView
  now: string
  currentMonth: string
  currentRange: PeriodRange
  budget: BudgetMonthSummary | null
  /** Tổng hợp ngân sách mọi tháng (có chuyển dư). */
  chain: Map<string, BudgetMonthSummary>
  netWorth: NetWorth
  /** Net worth cuối kỳ trước (so sánh Δ tháng). */
  previousNetWorth: number | null
  lastEnded: { month: string; range: PeriodRange; income: number; netCashFlow: number } | null
  health: HealthIndicators
  insightContext: InsightContext
  monthlyDebtPayments: number
}

export interface OverviewInputs {
  view: LedgerView
  months: readonly BudgetMonth[]
  lines: readonly BudgetLine[]
  snapshots: readonly NetWorthSnapshot[]
  now: string
}

/** Chỉ số sức khỏe + ngữ cảnh insight + ngân sách tháng (docs/04 §9, 07 §3). */
export function computeOverview({ view, months, lines, snapshots, now }: OverviewInputs): Overview {
  const startDay = view.settings.periodStartDay
  const currentMonth = periodOf(now, startDay)
  const currentRange = periodRange(currentMonth, startDay)
  const chain = summarizeBudgetChain({
    months,
    lines,
    categories: view.categories,
    accounts: view.accounts,
    transactions: view.transactions,
    rangeOf: (m) => periodRange(m, startDay),
    allowNegativeRollover: view.settings.allowNegativeRollover,
    alertThresholds: view.settings.alertThresholds,
    today: now,
  })
  const netWorth = netWorthAt(view.ledger, now)
  const earliest = view.accounts.reduce<string | null>((min, a) => (min === null || a.openingDate < min ? a.openingDate : min), null)

  // 3 kỳ đã kết thúc gần nhất (chỉ những kỳ đã bắt đầu theo dõi).
  const ended: PeriodRange[] = []
  for (let m = previousMonth(currentMonth), i = 0; i < 3; m = previousMonth(m), i++) {
    const r = periodRange(m, startDay)
    if (earliest && r.end >= earliest) ended.push(r)
  }
  const recent = ended.map((r) => ({ income: incomeInPeriod(view.transactions, r), needs: bucketBreakdown(view.transactions, view.categories, r).needs }))
  const last = ended[0]
  const lastEnded = last
    ? {
        month: last.month,
        range: last,
        income: incomeInPeriod(view.transactions, last),
        netCashFlow: bucketBreakdown(view.transactions, view.categories, last).savings,
      }
    : null

  const loans = view.accounts.filter(isLoan).filter((a) => !a.archivedAt)
  const cards = view.accounts.filter((a): a is AccountOf<'credit_card'> => a.kind === 'credit_card' && !a.archivedAt)
  const nextPayments = loans.map((l) => upcomingSchedule(l, view.transactions, now)[0]?.payment ?? 0)
  const monthlyDebtPayments =
    nextPayments.reduce((s, p) => s + p, 0) + cards.reduce((s, c) => s + creditCardMinimumPayment(Math.max(0, view.balances.get(c.id) ?? 0), c.details.minPaymentRate), 0)
  const emergency = view.accounts.filter((a) => a.isEmergencyFund && !a.archivedAt)
  const emergencyFund = emergency.length ? emergency.reduce((s, a) => s + (view.balances.get(a.id) ?? 0), 0) : null
  const previousNetWorth = last && earliest && last.end >= earliest ? netWorthAt(view.ledger, last.end).netWorth : null

  const health = healthIndicators({
    period: lastEnded ? { income: lastEnded.income, netCashFlow: lastEnded.netCashFlow } : null,
    recentMonths: recent,
    emergencyFund,
    liquidAssets: netWorth.liquidAssets,
    totalAssets: netWorth.totalAssets,
    totalLiabilities: netWorth.totalLiabilities,
    monthlyDebtPayments,
    creditCards: cards.map((c) => ({ balance: view.balances.get(c.id) ?? 0, limit: c.details.creditLimit })),
    buckets: last ? bucketBreakdown(view.transactions, view.categories, last) : null,
    netWorthStart: previousNetWorth === null ? null : last ? netWorthAt(view.ledger, addDays(last.start, -1)).netWorth : null,
    netWorthEnd: previousNetWorth ?? netWorth.netWorth,
  })

  const categoryHistory = new Map<string, number[]>()
  for (const r of [...ended].reverse()) {
    const spent = spendingByCategory(view.transactions, r)
    for (const c of view.categories) {
      if (c.type !== 'expense') continue
      const list = categoryHistory.get(c.id) ?? []
      list.push(spent.get(c.id) ?? 0)
      categoryHistory.set(c.id, list)
    }
  }

  const deposits = view.accounts
    .filter((a): a is AccountOf<'term_deposit'> => a.kind === 'term_deposit' && !a.archivedAt)
    .flatMap((a) => {
      const term = termActiveAt(view.depositTerms.filter((t) => t.accountId === a.id && t.status === 'active'), now) ?? view.depositTerms.find((t) => t.accountId === a.id && t.status === 'active')
      return term ? [{ accountId: a.id, bankName: a.details.bankName, principal: term.principal, maturityDate: term.maturityDate, expectedInterest: termInterest(term), rate: term.annualRate }] : []
    })

  const insightContext: InsightContext = {
    today: now,
    budget: chain.get(currentMonth) ?? null,
    categoryNames: new Map(view.categories.map((c) => [c.id, c.name])),
    health,
    emergencyFund: emergencyFund ?? netWorth.liquidAssets,
    flatLoans: loans.filter((l) => l.details.rateType === 'flat').map((l) => ({ accountId: l.id, name: l.name, annualRate: l.details.ratePeriods.at(-1)!.annualRate, termMonths: l.details.termMonths })),
    creditCards: cards.map((c) => ({ accountId: c.id, name: c.name, balance: view.balances.get(c.id) ?? 0, limit: c.details.creditLimit, annualRate: c.details.annualRate, minPaymentRate: c.details.minPaymentRate })),
    deposits,
    categoryHistory,
    lastMonth: lastEnded ? { label: monthLabel(lastEnded.month).toLowerCase(), income: lastEnded.income, netCashFlow: lastEnded.netCashFlow } : null,
    netWorthNow: netWorth.netWorth,
    netWorthHistory: snapshots.map((s) => s.netWorth),
    loans: loans.map((l) => ({
      accountId: l.id,
      name: l.name,
      terms: loanTermsOf(l.details),
      outstanding: view.balances.get(l.id) ?? 0,
      annualRate: l.details.ratePeriods.filter((p) => p.from <= now).at(-1)?.annualRate ?? l.details.ratePeriods[0]!.annualRate,
      prepaymentFeeRate: l.details.prepaymentFeeRate,
    })),
    bestSavingsRate: deposits.reduce((m, d) => Math.max(m, d.rate), 0),
    emergencyTargetMonths: view.settings.emergencyTargetMonths,
    liquidAssets: netWorth.liquidAssets,
    holdings: view.accounts.filter((a) => a.kind === 'investment' && !a.archivedAt).flatMap((a) => view.ledger.holdingValuations(a, now)),
  }

  return { view, now, currentMonth, currentRange, chain, budget: chain.get(currentMonth) ?? null, netWorth, previousNetWorth, lastEnded, health, insightContext, monthlyDebtPayments }
}

/** Mọi dữ liệu của người dùng hiện tại, đọc song song (dùng ở máy chủ MCP — giao diện đọc qua TanStack Query). */
export interface FullData extends LedgerRaw {
  budgetMonths: BudgetMonth[]
  budgetLines: BudgetLine[]
  snapshots: NetWorthSnapshot[]
  recurringRules: RecurringRule[]
}

export async function loadFullData(repos: Repositories): Promise<FullData> {
  const [settings, accounts, categories, transactions, holdings, trades, prices, valuations, depositTerms, budgetMonths, budgetLines, snapshots, recurringRules] =
    await Promise.all([
      repos.settings.get(),
      repos.accounts.list(),
      repos.categories.list(),
      repos.transactions.list(),
      repos.holdings.list(),
      repos.trades.list(),
      repos.priceQuotes.list(),
      repos.assetValuations.list(),
      repos.depositTerms.list(),
      repos.budgetMonths.list(),
      repos.budgetLines.list(),
      repos.snapshots.list(),
      repos.recurringRules.list(),
    ])
  return { settings, accounts, categories, transactions, holdings, trades, prices, valuations, depositTerms, budgetMonths, budgetLines, snapshots, recurringRules }
}

export interface UpcomingItem {
  date: string
  label: string
  amount: number
  /** Trang trong app để xử lý. */
  href: string
  overdue?: boolean
  kind: 'loan_payment' | 'deposit_maturity' | 'card_due' | 'recurring'
}

/** "7 ngày tới" (D5): kỳ trả nợ, sổ đáo hạn, hạn thanh toán thẻ, giao dịch định kỳ — kể cả việc đã quá hạn. */
export function upcomingItems(overview: Overview, rules: readonly RecurringRule[], days: number): UpcomingItem[] {
  const { view, now } = overview
  const horizon = addDays(now, days)
  const items: UpcomingItem[] = []
  for (const loan of view.accounts.filter(isLoan).filter((a) => !a.archivedAt)) {
    const next = upcomingSchedule(loan, view.transactions, now)[0]
    if (next && next.dueDate <= horizon) items.push({ kind: 'loan_payment', date: next.dueDate, label: `Trả nợ ${loan.name}`, amount: next.payment, href: `/liabilities/${loan.id}`, overdue: next.dueDate < now })
  }
  for (const d of overview.insightContext.deposits ?? []) {
    if (d.maturityDate <= horizon) items.push({ kind: 'deposit_maturity', date: d.maturityDate, label: `Đáo hạn sổ tại ${d.bankName}`, amount: d.principal + d.expectedInterest, href: `/savings/${d.accountId}`, overdue: d.maturityDate < now })
  }
  for (const card of view.accounts.filter((a): a is AccountOf<'credit_card'> => a.kind === 'credit_card' && !a.archivedAt)) {
    const due = [now.slice(0, 8) + String(card.details.dueDay).padStart(2, '0'), addDays(now, 31).slice(0, 8) + String(card.details.dueDay).padStart(2, '0')].find((d) => d >= now)
    const balance = view.balances.get(card.id) ?? 0
    if (due && due <= horizon && balance > 0) items.push({ kind: 'card_due', date: due, label: `Hạn thanh toán ${card.name}`, amount: balance, href: `/liabilities/${card.id}` })
  }
  for (const rule of rules) {
    if (!rule.pausedAt && rule.nextDate > now && rule.nextDate <= horizon && (!rule.endDate || rule.nextDate <= rule.endDate)) {
      items.push({ kind: 'recurring', date: rule.nextDate, label: rule.name, amount: rule.template.amount, href: '/transactions/recurring' })
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date))
}
