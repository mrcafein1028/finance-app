import { useState } from 'react'
import { Button, FormAlert, MoneyField } from '../../components/ui/form'
import { EmptyState, ErrorState, LoadingState, Money } from '../../components/ui/Money'
import { MonthNav, ProgressBar } from '../../components/ui/MonthNav'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, useSettings, type LedgerView } from '../../data/queries'
import { bucketOf, type BudgetLineSummary, type BudgetMonthSummary } from '../../domain/budget'
import { periodOf, previousMonth } from '../../domain/period'
import { today } from '../../lib/clock'
import { formatMoney, parseMoneyInput } from '../../lib/format'
import type { BudgetMonth } from '../../schemas'
import { reopenMonth, updateExpectedIncome } from '../../services/budget'
import { BudgetLineDialog, type LineDialogState } from './BudgetLineDialog'
import { CloseMonthDialog } from './CloseMonthDialog'
import { CreateBudgetPanel } from './CreateBudgetPanel'
import { useBudget } from './useBudget'

const STATUS_TEXT = { ok: 'Trong hạn mức', warning: 'Sắp hết', full: 'Vừa hết', over: 'Vượt' } as const

export function BudgetPage() {
  const startDay = useSettings().data?.periodStartDay ?? 1
  // Chưa chọn tháng → kỳ chứa hôm nay (tính theo ngày bắt đầu kỳ trong cài đặt).
  const [picked, setMonth] = useState<string | null>(null)
  const month = picked ?? periodOf(today(), startDay)
  const data = useBudget(month)
  const [lineDialog, setLineDialog] = useState<LineDialogState | null>(null)
  const [closing, setClosing] = useState(false)

  if (data.isLoading) return <LoadingState />
  if (data.error || !data.view) return <ErrorState error={data.error} />
  const { view, budgetMonth, summary, monthLines = [], historyRanges = [] } = data
  const previous = data.months.find((m) => m.month === previousMonth(month)) ?? null
  const closed = budgetMonth?.status === 'closed'
  const ended = data.range.end < today()

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Ngân sách</h1>
        {budgetMonth && !closed && <Button onClick={() => setLineDialog({ line: null })}>Thêm dòng</Button>}
      </div>
      <MonthNav month={month} startDay={data.startDay} onChange={setMonth} />

      {!budgetMonth || !summary ? (
        <CreateBudgetPanel
          key={month}
          month={month}
          view={view}
          previous={previous}
          previousLines={(data.chain?.get(previousMonth(month))?.lines ?? []).map((l) => l.line)}
          historyRanges={historyRanges}
        />
      ) : (
        <>
          {closed && (
            <FormAlert tone="success">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>Tháng đã đóng — ngân sách được khóa.</span>
                <ReopenButton budgetMonth={budgetMonth} />
              </div>
            </FormAlert>
          )}
          <SummaryCard summary={summary} budgetMonth={budgetMonth} disabled={closed} />
          {ended && !closed && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/40 bg-surface px-4 py-3">
              <span className="text-sm">Tháng đã kết thúc — xem tổng kết và đóng tháng.</span>
              <Button onClick={() => setClosing(true)}>Đóng tháng</Button>
            </div>
          )}
          <LineSections summary={summary} view={view} onSelect={closed ? undefined : (line) => setLineDialog({ line: line.line })} />
          <Unbudgeted summary={summary} view={view} onAdd={closed ? undefined : (categoryId) => setLineDialog({ line: null, preset: { kind: 'category', categoryId } })} />
          {monthLines.length === 0 && <EmptyState title="Chưa có dòng ngân sách nào">Bấm “Thêm dòng” để đặt hạn mức cho từng danh mục.</EmptyState>}
        </>
      )}

      <BudgetLineDialog
        open={lineDialog !== null}
        month={month}
        view={view}
        state={lineDialog ?? { line: null }}
        monthLines={monthLines}
        historyRanges={historyRanges}
        onClose={() => setLineDialog(null)}
      />
      {budgetMonth && summary && (
        <CloseMonthDialog
          open={closing}
          view={view}
          budgetMonth={budgetMonth}
          summary={summary}
          hasNextBudget={data.months.some((m) => m.month > month)}
          onClose={() => setClosing(false)}
        />
      )}
    </section>
  )
}

function ReopenButton({ budgetMonth }: { budgetMonth: BudgetMonth }) {
  const invalidate = useInvalidate()
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        await reopenMonth(getRepos(), budgetMonth)
        await invalidate('budgetMonths')
      }}
    >
      Mở lại tháng
    </Button>
  )
}

function SummaryCard({ summary, budgetMonth, disabled }: { summary: BudgetMonthSummary; budgetMonth: BudgetMonth; disabled: boolean }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [income, setIncome] = useState(String(budgetMonth.expectedIncome))
  const zeroBased = budgetMonth.mode === 'zero_based'
  const categorySpend = summary.lines.filter((l) => l.line.target.kind === 'category')
  const totalBudget = categorySpend.reduce((s, l) => s + l.budget, 0)
  const totalActual = categorySpend.reduce((s, l) => s + l.actual, 0)
  const totalPace = categorySpend.reduce((s, l) => s + l.pace, 0)

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {editing ? (
          <form
            className="flex items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              const value = parseMoneyInput(income)
              if (value === null) return
              await updateExpectedIncome(getRepos(), budgetMonth, value)
              await invalidate('budgetMonths')
              toast({ message: 'Đã cập nhật thu nhập dự kiến' })
              setEditing(false)
            }}
          >
            <MoneyField label="Thu nhập dự kiến" value={income} rawValue={income} onChange={(e) => setIncome(e.target.value)} />
            <Button type="submit">Lưu</Button>
          </form>
        ) : (
          <div>
            <p className="text-sm text-muted">Thu nhập dự kiến</p>
            <p className="text-xl font-semibold">
              <Money value={summary.expectedIncome} />
              {!disabled && (
                <button type="button" className="ml-2 text-sm font-normal text-brand" onClick={() => setEditing(true)}>
                  Sửa
                </button>
              )}
            </p>
          </div>
        )}
        <div className="text-right">
          <p className="text-sm text-muted">{zeroBased ? 'Chưa phân bổ' : 'Đã lập ngân sách'}</p>
          <p className={`text-xl font-semibold ${zeroBased && summary.unassigned < 0 ? 'text-negative' : zeroBased && summary.unassigned === 0 ? 'text-positive' : ''}`}>
            <Money value={zeroBased ? summary.unassigned : summary.totalPlanned} />
          </p>
          {zeroBased && (
            <p className="text-xs text-muted">
              {summary.unassigned === 0 ? 'Mọi đồng đã được giao việc ✓' : summary.unassigned < 0 ? 'Phân bổ vượt thu nhập dự kiến' : 'Hãy giao việc cho số tiền này'}
            </p>
          )}
        </div>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-sm">
          <span>
            Đã chi <Money value={totalActual} /> / <Money value={totalBudget} />
          </span>
          <span className="text-muted">Vạch dọc: mức nên chi đến hôm nay</span>
        </div>
        <ProgressBar value={totalActual} max={totalBudget} pace={totalPace} tone={totalActual > totalBudget ? 'over' : totalActual >= totalBudget * 0.8 ? 'warning' : 'ok'} label="Tổng chi so với ngân sách" />
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-muted">Thu thực tế</dt>
          <dd><Money value={summary.actualIncome} tone="income" /></dd>
        </div>
        <div>
          <dt className="text-muted">Chi thực tế</dt>
          <dd><Money value={summary.actualExpense} tone="expense" /></dd>
        </div>
        <div>
          <dt className="text-muted">Còn lại</dt>
          <dd><Money value={summary.netCashFlow} sign tone="auto" /></dd>
        </div>
      </dl>
    </div>
  )
}

function lineName(l: BudgetLineSummary, view: LedgerView) {
  return l.line.target.kind === 'category' ? (view.categoryById.get(l.line.target.categoryId)?.name ?? 'Danh mục đã xóa') : (view.accountById.get(l.line.target.accountId)?.name ?? 'Tài khoản đã xóa')
}

function LineSections({ summary, view, onSelect }: { summary: BudgetMonthSummary; view: LedgerView; onSelect?: (l: BudgetLineSummary) => void }) {
  const groups: { title: string; lines: BudgetLineSummary[] }[] = [
    { title: 'Thiết yếu', lines: [] },
    { title: 'Mong muốn', lines: [] },
    { title: 'Tiết kiệm & trả nợ', lines: [] },
  ]
  for (const l of summary.lines) {
    if (l.line.target.kind === 'account') groups[2]!.lines.push(l)
    else groups[bucketOf(l.line.target.categoryId, view.categoryById) === 'needs' ? 0 : 1]!.lines.push(l)
  }
  return (
    <>
      {groups
        .filter((g) => g.lines.length > 0)
        .map((g) => (
          <section key={g.title} aria-label={g.title}>
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">{g.title}</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {g.lines.map((l) => {
                const name = lineName(l, view)
                const isSaving = l.line.target.kind === 'account'
                const tone = l.status === 'over' ? 'over' : l.status === 'warning' || l.status === 'full' ? 'warning' : 'ok'
                return (
                  <li key={l.line.id}>
                    <button type="button" disabled={!onSelect} onClick={() => onSelect?.(l)} aria-label={`Dòng ngân sách ${name}`} className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-canvas disabled:hover:bg-transparent">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{name}</span>
                        <span className={`text-xs font-medium ${l.status === 'over' ? 'text-negative' : l.status === 'warning' ? 'text-warning' : 'text-muted'}`}>
                          {isSaving ? (l.actual >= l.budget ? 'Đã hoàn thành' : `${Math.round((l.usage ?? 0) * 100)}%`) : STATUS_TEXT[l.status]}
                          {!isSaving && l.aheadOfPace && l.status !== 'full' && ' · đang tiêu nhanh'}
                        </span>
                      </span>
                      <ProgressBar value={l.actual} max={l.budget} pace={isSaving ? undefined : l.pace} tone={isSaving ? 'ok' : tone} label={`${name}: ${formatMoney(l.actual)} / ${formatMoney(l.budget)}`} />
                      <span className="flex justify-between text-sm text-muted">
                        <span>
                          {isSaving ? 'Đã góp' : 'Đã chi'} {formatMoney(l.actual)} / {formatMoney(l.budget)}
                          {l.carryIn !== 0 && ` (gồm ${formatMoney(l.carryIn, { sign: true })} từ tháng trước)`}
                        </span>
                        <span className={l.available < 0 ? 'text-negative' : ''}>{l.available < 0 ? `Vượt ${formatMoney(-l.available)}` : `Còn ${formatMoney(l.available)}`}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
    </>
  )
}

function Unbudgeted({ summary, view, onAdd }: { summary: BudgetMonthSummary; view: LedgerView; onAdd?: (categoryId: string) => void }) {
  const items = [...summary.unbudgetedByCategory].filter(([, v]) => v > 0)
  if (items.length === 0) return null
  return (
    <section aria-label="Chưa lập ngân sách">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">Chưa lập ngân sách · {formatMoney(summary.unbudgetedSpend)}</h2>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-dashed border-border bg-surface">
        {items.map(([categoryId, amount]) => (
          <li key={categoryId} className="flex items-center justify-between gap-2 px-4 py-3">
            <span>{view.categoryById.get(categoryId)?.name ?? 'Danh mục đã xóa'}</span>
            <span className="flex items-center gap-3">
              <Money value={amount} />
              {onAdd && (
                <Button variant="secondary" className="px-3 py-1.5 text-sm" onClick={() => onAdd(categoryId)}>
                  Lập
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
