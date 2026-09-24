import { useState } from 'react'
import { Button, FormAlert, MoneyField } from '../../components/ui/form'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, type BudgetLine, type LedgerView } from '../../data/queries'
import { averageSpending, copyLines, incomeInPeriod, suggestExpectedIncome, suggestLines503020, type BudgetLineDraft } from '../../domain/budget'
import type { PeriodRange } from '../../domain/period'
import { formatMoney, monthLabel, parseMoneyInput } from '../../lib/format'
import type { BudgetMonth } from '../../schemas'
import { createBudgetMonth } from '../../services/budget'

type Strategy = 'copy' | 'rule' | 'empty'

/** W5 bước 1 — tháng chưa có ngân sách: sao chép tháng trước / theo 50-30-20 / trống. */
export function CreateBudgetPanel({
  month,
  view,
  previous,
  previousLines,
  historyRanges,
}: {
  month: string
  view: LedgerView
  previous: BudgetMonth | null
  previousLines: readonly BudgetLine[]
  historyRanges: readonly PeriodRange[]
}) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const incomes = [...historyRanges].reverse().map((r) => incomeInPeriod(view.transactions, r)).filter((x) => x > 0)
  const suggested = previous?.expectedIncome || suggestExpectedIncome(incomes, 'average3')
  const [strategy, setStrategy] = useState<Strategy>(previousLines.length > 0 ? 'copy' : 'rule')
  const [income, setIncome] = useState(suggested ? String(suggested) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const incomeValue = parseMoneyInput(income)

  const savingsAccount =
    view.accounts.find((a) => a.isEmergencyFund && !a.archivedAt && a.class === 'asset') ?? view.accounts.find((a) => a.kind === 'goal_fund' && !a.archivedAt)

  function draftLines(): BudgetLineDraft[] {
    if (strategy === 'copy') return copyLines(previousLines)
    if (strategy === 'rule' && incomeValue) {
      return suggestLines503020(incomeValue, view.categories, savingsAccount?.id ?? null, (id) =>
        averageSpending(id, view.categories, view.transactions, historyRanges),
      )
    }
    return []
  }

  async function create() {
    if (incomeValue === null) return setError('Nhập thu nhập dự kiến (có thể là 0)')
    setBusy(true)
    setError(null)
    try {
      await createBudgetMonth(getRepos(), month, { mode: previous?.mode ?? view.settings.defaultBudgetMode, expectedIncome: incomeValue, lines: draftLines() })
      await invalidate('budgetMonths', 'budgetLines')
      toast({ message: `Đã tạo ngân sách ${monthLabel(month).toLowerCase()}` })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tạo được ngân sách')
    } finally {
      setBusy(false)
    }
  }

  const options: { value: Strategy; label: string; hint: string; disabled?: boolean }[] = [
    { value: 'copy', label: 'Sao chép tháng trước', hint: previousLines.length ? `${previousLines.length} dòng ngân sách của tháng trước` : 'Tháng trước chưa có ngân sách', disabled: previousLines.length === 0 },
    { value: 'rule', label: 'Theo quy tắc 50/30/20', hint: '50% thiết yếu, 30% mong muốn, 20% tiết kiệm — chia theo mức chi thực tế gần đây' },
    { value: 'empty', label: 'Bắt đầu trống', hint: 'Tự thêm từng dòng' },
  ]

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">Chưa có ngân sách cho {monthLabel(month).toLowerCase()}</h2>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <MoneyField
        label="Thu nhập dự kiến"
        value={income}
        rawValue={income}
        onChange={(e) => setIncome(e.target.value)}
        hint={suggested ? `Gợi ý: ${formatMoney(suggested)} (${previous ? 'tháng trước' : 'trung bình các tháng gần đây'})` : undefined}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Cách tạo</legend>
        {options.map((o) => (
          <label key={o.value} className={`flex gap-3 rounded-xl border p-3 ${strategy === o.value ? 'border-brand' : 'border-border'} ${o.disabled ? 'opacity-50' : 'cursor-pointer'}`}>
            <input type="radio" name="strategy" value={o.value} disabled={o.disabled} checked={strategy === o.value} onChange={() => setStrategy(o.value)} className="mt-1 accent-[var(--color-brand)]" />
            <span>
              <span className="block font-medium">{o.label}</span>
              <span className="block text-sm text-muted">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Button onClick={create} disabled={busy}>
        {busy ? 'Đang tạo…' : 'Tạo ngân sách'}
      </Button>
    </section>
  )
}
