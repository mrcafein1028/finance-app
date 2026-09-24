import { useMemo } from 'react'
import { useBudgetLines, useBudgetMonths, useLedgerView, useRecurringRules, useSnapshots, type LedgerView } from '../../data/queries'
import { bucketBreakdown, incomeInPeriod, spendingByCategory, summarizeBudgetChain, type BudgetMonthSummary } from '../../domain/budget'
import { addDays } from '../../domain/dates'
import { healthIndicators, type HealthIndicators, type InsightContext } from '../../domain/insights'
import { creditCardMinimumPayment, loanTermsOf } from '../../domain/loan'
import { netWorthAt, type NetWorth } from '../../domain/networth'
import { periodOf, periodRange, previousMonth, type PeriodRange } from '../../domain/period'
import { termActiveAt, termInterest } from '../../domain/savings'
import { today } from '../../lib/clock'
import { monthLabel } from '../../lib/format'
import type { AccountOf } from '../../schemas'
import { isLoan, upcomingSchedule } from '../../services/liabilities'

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

/** Tổng hợp dùng chung cho Tổng quan, Báo cáo, Mô phỏng: chỉ số sức khỏe + ngữ cảnh insight (docs/04 §9, 07 §3). */
export function useOverview(): { data: Overview | undefined; isLoading: boolean; error: unknown } {
  const { data: view, isLoading, error } = useLedgerView()
  const months = useBudgetMonths()
  const lines = useBudgetLines()
  const snapshots = useSnapshots()
  const rules = useRecurringRules()

  const data = useMemo((): Overview | undefined => {
    if (!view || !months.data || !lines.data || !snapshots.data || !rules.data) return undefined
    const now = today()
    const startDay = view.settings.periodStartDay
    const currentMonth = periodOf(now, startDay)
    const currentRange = periodRange(currentMonth, startDay)
    const chain = summarizeBudgetChain({
      months: months.data,
      lines: lines.data,
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
      netWorthHistory: snapshots.data.map((s) => s.netWorth),
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
  }, [view, months.data, lines.data, snapshots.data, rules.data])

  return {
    data,
    isLoading: isLoading || months.isLoading || lines.isLoading || snapshots.isLoading || rules.isLoading,
    error: error ?? months.error ?? lines.error ?? snapshots.error ?? rules.error,
  }
}
