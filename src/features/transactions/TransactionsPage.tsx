import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Button, SelectField, TextField } from '../../components/ui/form'
import { EmptyState, ErrorState, LoadingState, Money } from '../../components/ui/Money'
import { MonthNav } from '../../components/ui/MonthNav'
import { useLedgerView, useSettings } from '../../data/queries'
import { isInPeriod, periodOf, periodRange } from '../../domain/period'
import { today } from '../../lib/clock'
import { AccountOptions, CategoryOptions } from './pickers'
import { TransactionList } from './TransactionList'
import { useTransactionDialog } from './transactionDialogContext'

const TYPE_FILTERS = [
  { value: '', label: 'Tất cả loại' },
  { value: 'expense', label: 'Chi' },
  { value: 'income', label: 'Thu' },
  { value: 'transfer', label: 'Chuyển khoản' },
  { value: 'refund', label: 'Hoàn tiền' },
  { value: 'adjustment', label: 'Điều chỉnh' },
]

export function TransactionsPage() {
  const { data: view, isLoading, error } = useLedgerView()
  const startDay = useSettings().data?.periodStartDay ?? 1
  const dialog = useTransactionDialog()
  const [picked, setMonth] = useState<string | null>(null)
  const month = picked ?? periodOf(today(), startDay)
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const range = periodRange(month, startDay)

  const filtered = useMemo(() => {
    if (!view) return []
    const q = search.trim().toLocaleLowerCase('vi')
    return view.transactions.filter(
      (t) =>
        isInPeriod(t.date, range) &&
        (!accountId || t.accountId === accountId || t.toAccountId === accountId) &&
        (!categoryId || t.categoryId === categoryId) &&
        (!type || t.type === type) &&
        (!q || (t.note ?? '').toLocaleLowerCase('vi').includes(q) || (t.categoryId && view.categoryById.get(t.categoryId)?.name.toLocaleLowerCase('vi').includes(q))),
    )
  }, [view, range.start, range.end, accountId, categoryId, type, search]) // eslint-disable-line react-hooks/exhaustive-deps

  const income = filtered.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const spending = filtered.reduce((s, t) => s + (t.type === 'expense' ? t.amount : t.type === 'refund' ? -t.amount : 0), 0)

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Giao dịch</h1>
        <div className="flex gap-2">
          <Link to="/transactions/recurring" className="rounded-lg border border-border bg-surface px-4 py-2.5 font-medium hover:bg-canvas">
            Định kỳ
          </Link>
          <Button onClick={() => dialog.openNew()}>Thêm giao dịch</Button>
        </div>
      </div>

      <MonthNav month={month} startDay={startDay} onChange={setMonth} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField label="Tài khoản" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {view && <AccountOptions accounts={view.accounts} balances={view.balances} placeholder="Tất cả tài khoản" />}
        </SelectField>
        <SelectField label="Loại" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPE_FILTERS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Danh mục chi" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {view && <CategoryOptions categories={view.categories} type="expense" placeholder="Tất cả danh mục" />}
        </SelectField>
        <TextField label="Tìm kiếm" type="search" placeholder="Ghi chú, danh mục…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <dl className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-surface p-4 text-sm">
        <div>
          <dt className="text-muted">Thu</dt>
          <dd><Money value={income} tone="income" /></dd>
        </div>
        <div>
          <dt className="text-muted">Chi</dt>
          <dd><Money value={spending} tone="expense" /></dd>
        </div>
        <div>
          <dt className="text-muted">Còn lại</dt>
          <dd><Money value={income - spending} sign tone="auto" /></dd>
        </div>
      </dl>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} />
      ) : filtered.length === 0 ? (
        <EmptyState title="Chưa có giao dịch nào trong tháng này">Bấm “Thêm giao dịch” hoặc nút + để ghi khoản đầu tiên.</EmptyState>
      ) : (
        view && <TransactionList transactions={filtered} ctx={view} onSelect={dialog.openEdit} />
      )}
    </section>
  )
}
