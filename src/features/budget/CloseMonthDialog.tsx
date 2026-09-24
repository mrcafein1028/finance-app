import { useState } from 'react'
import { Button, CheckboxField, FormAlert } from '../../components/ui/form'
import { Modal } from '../../components/ui/Modal'
import { Money } from '../../components/ui/Money'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, useRecurringRules, type LedgerView } from '../../data/queries'
import { copyLines, type BudgetMonthSummary } from '../../domain/budget'
import { explainNetWorthChange } from '../../domain/networth'
import { nextMonth } from '../../domain/period'
import { today } from '../../lib/clock'
import { formatMoney, monthLabel } from '../../lib/format'
import type { BudgetMonth } from '../../schemas'
import { closeMonth, createBudgetMonth } from '../../services/budget'
import { pendingOccurrences } from '../../services/recurring'

function Content({ view, budgetMonth, summary, hasNextBudget, onClose }: { open: boolean; view: LedgerView; budgetMonth: BudgetMonth; summary: BudgetMonthSummary; hasNextBudget: boolean; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const rules = useRecurringRules().data ?? []
  const [createNext, setCreateNext] = useState(!hasNextBudget)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pending = pendingOccurrences(rules, today()).filter((p) => p.date <= summary.range.end)
  const change = explainNetWorthChange(view.ledger, summary.range.start, summary.range.end)
  const savingsRate = summary.actualIncome > 0 ? summary.netCashFlow / summary.actualIncome : null
  const over = summary.lines.filter((l) => l.status === 'over')
  const top = [...summary.lines.filter((l) => l.line.target.kind === 'category'), ...[...summary.unbudgetedByCategory].map(([categoryId, actual]) => ({ line: { target: { kind: 'category' as const, categoryId } }, actual }))]
    .sort((a, b) => b.actual - a.actual)
    .slice(0, 5)
  const rollovers = summary.lines.filter((l) => l.line.rollover && l.available !== 0)
  const name = (l: { line: { target: { kind: string; categoryId?: string; accountId?: string } } }) =>
    l.line.target.kind === 'category' ? (view.categoryById.get(l.line.target.categoryId!)?.name ?? '?') : (view.accountById.get(l.line.target.accountId!)?.name ?? '?')

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await closeMonth(getRepos(), budgetMonth, view.ledger, view.settings.periodStartDay)
      if (createNext && !hasNextBudget) {
        const lines = summary.lines.map((l) => l.line)
        await createBudgetMonth(getRepos(), nextMonth(budgetMonth.month), { mode: budgetMonth.mode, expectedIncome: budgetMonth.expectedIncome, lines: copyLines(lines) })
      }
      await invalidate('budgetMonths', 'budgetLines', 'snapshots')
      toast({ message: `Đã đóng ${monthLabel(budgetMonth.month).toLowerCase()}` })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đóng được tháng')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={`Tổng kết ${monthLabel(budgetMonth.month).toLowerCase()}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Để sau
          </Button>
          <Button onClick={confirm} disabled={busy}>
            Đóng tháng
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        {error && <FormAlert tone="error">{error}</FormAlert>}
        {pending.length > 0 && <FormAlert tone="warning">Còn {pending.length} giao dịch định kỳ chờ xác nhận trong tháng này.</FormAlert>}
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-muted">Thu nhập</dt>
            <dd><Money value={summary.actualIncome} tone="income" /></dd>
          </div>
          <div>
            <dt className="text-muted">Chi tiêu</dt>
            <dd><Money value={summary.actualExpense} tone="expense" /></dd>
          </div>
          <div>
            <dt className="text-muted">Dòng tiền ròng</dt>
            <dd><Money value={summary.netCashFlow} sign tone="auto" /></dd>
          </div>
          <div>
            <dt className="text-muted">Tỉ lệ tiết kiệm</dt>
            <dd className="font-medium">{savingsRate === null ? 'Chưa đủ dữ liệu' : `${(savingsRate * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`}</dd>
          </div>
        </dl>

        <section>
          <h3 className="mb-1 font-medium">Chi nhiều nhất</h3>
          <ol className="space-y-1">
            {top.map((l) => (
              <li key={name(l)} className="flex justify-between">
                <span>{name(l)}</span>
                <Money value={l.actual} />
              </li>
            ))}
          </ol>
        </section>

        {over.length > 0 && (
          <section>
            <h3 className="mb-1 font-medium">Vượt ngân sách</h3>
            <ul className="space-y-1">
              {over.map((l) => (
                <li key={l.line.id} className="flex justify-between text-negative">
                  <span>{name(l)}</span>
                  <span>vượt {formatMoney(l.actual - l.budget)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="mb-1 font-medium">Net worth trong kỳ</h3>
          <p>
            <Money value={change.startNetWorth + change.openingBalances} /> → <Money value={change.endNetWorth} className="font-semibold" /> (
            <Money value={change.endNetWorth - change.startNetWorth - change.openingBalances} sign tone="auto" />)
          </p>
        </section>

        {rollovers.length > 0 && (
          <section>
            <h3 className="mb-1 font-medium">Chuyển sang tháng sau</h3>
            <ul className="space-y-1">
              {rollovers.map((l) => (
                <li key={l.line.id} className="flex justify-between">
                  <span>{name(l)}</span>
                  <Money value={l.available} sign tone="auto" />
                </li>
              ))}
            </ul>
          </section>
        )}

        {!hasNextBudget && (
          <CheckboxField label={`Tạo ngân sách ${monthLabel(nextMonth(budgetMonth.month)).toLowerCase()} (sao chép tháng này)`} checked={createNext} onChange={(e) => setCreateNext(e.target.checked)} />
        )}
      </div>
    </Modal>
  )
}

export function CloseMonthDialog(props: Parameters<typeof Content>[0]) {
  return props.open ? <Content {...props} /> : null
}
