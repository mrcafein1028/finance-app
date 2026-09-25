import { useMemo } from 'react'
import { useBudgetLines, useBudgetMonths, useLedgerView, useRecurringRules, useSnapshots } from '../../data/queries'
import { today } from '../../lib/clock'
import { computeOverview, type Overview } from '../../services/overview'

export type { Overview }

/** Tổng hợp dùng chung cho Tổng quan, Báo cáo, Mô phỏng — công thức nằm ở services/overview (dùng chung với Claude). */
export function useOverview(): { data: Overview | undefined; isLoading: boolean; error: unknown } {
  const { data: view, isLoading, error } = useLedgerView()
  const months = useBudgetMonths()
  const lines = useBudgetLines()
  const snapshots = useSnapshots()
  const rules = useRecurringRules()

  const data = useMemo((): Overview | undefined => {
    if (!view || !months.data || !lines.data || !snapshots.data || !rules.data) return undefined
    return computeOverview({ view, months: months.data, lines: lines.data, snapshots: snapshots.data, now: today() })
  }, [view, months.data, lines.data, snapshots.data, rules.data])

  return {
    data,
    isLoading: isLoading || months.isLoading || lines.isLoading || snapshots.isLoading || rules.isLoading,
    error: error ?? months.error ?? lines.error ?? snapshots.error ?? rules.error,
  }
}
