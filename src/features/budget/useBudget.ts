import { useMemo } from 'react'
import { useBudgetLines, useBudgetMonths, useLedgerView } from '../../data/queries'
import { summarizeBudgetChain, type BudgetMonthSummary } from '../../domain/budget'
import { previousMonth, periodRange, type PeriodRange } from '../../domain/period'
import { today } from '../../lib/clock'

/** Dữ liệu trang Ngân sách: tổng hợp cả chuỗi tháng để phần chuyển dư luôn đúng. */
export function useBudget(month: string) {
  const { data: view, isLoading, error } = useLedgerView()
  const months = useBudgetMonths()
  const lines = useBudgetLines()
  const startDay = view?.settings.periodStartDay ?? 1

  const result = useMemo(() => {
    if (!view || !months.data || !lines.data) return undefined
    const chain = summarizeBudgetChain({
      months: months.data,
      lines: lines.data,
      categories: view.categories,
      accounts: view.accounts,
      transactions: view.transactions,
      rangeOf: (m) => periodRange(m, startDay),
      allowNegativeRollover: view.settings.allowNegativeRollover,
      alertThresholds: view.settings.alertThresholds,
      today: today(),
    })
    const budgetMonth = months.data.find((m) => m.month === month) ?? null
    const summary: BudgetMonthSummary | null = chain.get(month) ?? null
    // 3 kỳ trước tháng đang xem — làm gợi ý "TB 3 tháng".
    const historyRanges: PeriodRange[] = []
    for (let m = previousMonth(month), i = 0; i < 3; m = previousMonth(m), i++) historyRanges.push(periodRange(m, startDay))
    return { chain, budgetMonth, summary, historyRanges, monthLines: lines.data.filter((l) => l.month === month) }
  }, [view, months.data, lines.data, month, startDay])

  return {
    view,
    startDay,
    range: periodRange(month, startDay),
    months: months.data ?? [],
    ...result,
    isLoading: isLoading || months.isLoading || lines.isLoading,
    error: error ?? months.error ?? lines.error,
  }
}
