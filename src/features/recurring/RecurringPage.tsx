import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../components/ui/form'
import { EmptyState, ErrorState, LoadingState, Money } from '../../components/ui/Money'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, useLedgerView, useRecurringRules, type LedgerView } from '../../data/queries'
import { describeSchedule } from '../../domain/recurring'
import { today } from '../../lib/clock'
import { formatDate } from '../../lib/format'
import type { RecurringRule } from '../../schemas'
import { confirmOccurrence, pendingOccurrences, skipOccurrence } from '../../services/recurring'
import { RecurringRuleDialog } from './RecurringRuleDialog'

const targetLabel = (rule: RecurringRule, view: LedgerView) => {
  const t = rule.template
  const from = view.accountById.get(t.accountId)?.name ?? '?'
  return t.type === 'transfer' ? `${from} → ${view.accountById.get(t.toAccountId ?? '')?.name ?? '?'}` : `${view.categoryById.get(t.categoryId ?? '')?.name ?? '?'} · ${from}`
}

/** W14 — danh sách quy tắc lặp và các lần đang chờ xác nhận. */
export function RecurringPage() {
  const { data: view, isLoading, error } = useLedgerView()
  const rules = useRecurringRules()
  const invalidate = useInvalidate()
  const toast = useToast()
  const [dialog, setDialog] = useState<{ open: boolean; rule: RecurringRule | null }>({ open: false, rule: null })

  if (isLoading || rules.isLoading) return <LoadingState />
  if (error || rules.error || !view) return <ErrorState error={error ?? rules.error} />
  const list = [...(rules.data ?? [])].sort((a, b) => a.nextDate.localeCompare(b.nextDate))
  const pending = pendingOccurrences(list, today())

  async function handle(action: () => Promise<unknown>, message: string) {
    await action()
    await invalidate('recurringRules', 'transactions')
    toast({ message })
  }

  return (
    <section className="flex flex-col gap-5">
      <Link to="/transactions" className="text-sm text-brand">
        ‹ Giao dịch
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Giao dịch định kỳ</h1>
        <Button onClick={() => setDialog({ open: true, rule: null })}>Thêm định kỳ</Button>
      </div>

      {pending.length > 0 && (
        <section aria-label="Chờ xác nhận">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">Chờ xác nhận</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-warning/50 bg-surface">
            {pending.map(({ rule, date }) => (
              <li key={`${rule.id}:${date}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span>
                  <span className="block font-medium">{rule.name}</span>
                  <span className="block text-sm text-muted">
                    {formatDate(date)} · <Money value={rule.template.amount} />
                  </span>
                </span>
                <span className="flex gap-2">
                  <Button variant="secondary" onClick={() => handle(() => skipOccurrence(getRepos(), rule, date), 'Đã bỏ qua lần này')}>
                    Bỏ qua
                  </Button>
                  <Button onClick={() => handle(() => confirmOccurrence(getRepos(), rule, date), `Đã ghi ${rule.name}`)}>Xác nhận</Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {list.length === 0 ? (
        <EmptyState title="Chưa có giao dịch định kỳ">Tạo cho lương, tiền nhà, internet… để không phải nhập tay mỗi tháng.</EmptyState>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {list.map((rule) => (
            <li key={rule.id}>
              <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas" onClick={() => setDialog({ open: true, rule })} aria-label={`Quy tắc ${rule.name}`}>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {rule.name}
                    {rule.pausedAt && <span className="ml-2 rounded bg-canvas px-1.5 py-0.5 text-xs text-muted">Tạm dừng</span>}
                    {rule.mode === 'confirm' && <span className="ml-2 rounded bg-canvas px-1.5 py-0.5 text-xs text-muted">Cần xác nhận</span>}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {describeSchedule(rule)} · {targetLabel(rule, view)}
                  </span>
                  <span className="block text-sm text-muted">{rule.endDate && rule.nextDate > rule.endDate ? 'Đã kết thúc' : `Lần tới: ${formatDate(rule.nextDate)}`}</span>
                </span>
                <Money value={rule.template.type === 'expense' ? -rule.template.amount : rule.template.amount} sign={rule.template.type !== 'transfer'} tone={rule.template.type === 'transfer' ? 'none' : 'auto'} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <RecurringRuleDialog open={dialog.open} view={view} rule={dialog.rule} onClose={() => setDialog({ open: false, rule: null })} />
    </section>
  )
}
