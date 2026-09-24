import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../components/ui/form'
import { EmptyState, ErrorState, LoadingState, Money } from '../../components/ui/Money'
import { useLedgerView } from '../../data/queries'
import { goalProgress } from '../../domain/goals'
import type { Account } from '../../schemas'
import { kindLabel } from '../transactions/describe'
import { AccountFormDialog } from './AccountFormDialog'

const SECTIONS: { title: string; kinds: Account['kind'][]; managedHere: boolean }[] = [
  { title: 'Tiền & ngân hàng', kinds: ['cash', 'bank', 'ewallet'], managedHere: true },
  { title: 'Quỹ mục tiêu', kinds: ['goal_fund'], managedHere: true },
]

export function AccountsPage() {
  const { data: view, isLoading, error } = useLedgerView()
  const [dialog, setDialog] = useState<{ open: boolean; kind: 'bank' | 'goal_fund' }>({ open: false, kind: 'bank' })
  const [showArchived, setShowArchived] = useState(false)

  if (isLoading) return <LoadingState />
  if (error || !view) return <ErrorState error={error} />

  const managed = view.accounts.filter((a) => SECTIONS.some((s) => s.kinds.includes(a.kind)))
  const active = managed.filter((a) => !a.archivedAt)
  const archived = managed.filter((a) => a.archivedAt)
  const total = active.reduce((s, a) => s + (view.balances.get(a.id) ?? 0), 0)

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tài khoản & quỹ</h1>
          <p className="text-sm text-muted">
            Tổng tiền đang có: <Money value={total} className="font-semibold text-ink" />
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setDialog({ open: true, kind: 'goal_fund' })}>
            Thêm quỹ
          </Button>
          <Button onClick={() => setDialog({ open: true, kind: 'bank' })}>Thêm tài khoản</Button>
        </div>
      </div>

      {active.length === 0 && (
        <EmptyState title="Chưa có tài khoản nào">Thêm tài khoản tiền mặt, ngân hàng hoặc ví điện tử với số dư hiện tại.</EmptyState>
      )}

      {SECTIONS.map((section) => {
        const list = active.filter((a) => section.kinds.includes(a.kind))
        if (list.length === 0) return null
        return (
          <section key={section.title} aria-label={section.title}>
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">{section.title}</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {list.map((a) => (
                <AccountRow key={a.id} account={a} balance={view.balances.get(a.id) ?? 0} />
              ))}
            </ul>
          </section>
        )
      })}

      {archived.length > 0 && (
        <section>
          <Button variant="ghost" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
            {showArchived ? 'Ẩn' : 'Hiện'} {archived.length} tài khoản đã lưu trữ
          </Button>
          {showArchived && (
            <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface opacity-75">
              {archived.map((a) => (
                <AccountRow key={a.id} account={a} balance={view.balances.get(a.id) ?? 0} />
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="text-sm text-muted">
        Sổ tiết kiệm, đầu tư và khoản nợ có trang riêng:{' '}
        <Link to="/savings" className="text-brand">
          Tiết kiệm
        </Link>
        {' · '}
        <Link to="/investments" className="text-brand">
          Đầu tư
        </Link>
        {' · '}
        <Link to="/liabilities" className="text-brand">
          Khoản nợ
        </Link>
      </p>

      <AccountFormDialog open={dialog.open} editing={null} initialKind={dialog.kind} onClose={() => setDialog((d) => ({ ...d, open: false }))} />
    </section>
  )
}

function AccountRow({ account, balance }: { account: Account; balance: number }) {
  const goal = account.goal
  return (
    <li>
      <Link to={`/accounts/${account.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-canvas">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {account.name}
            {account.isEmergencyFund && <span className="ml-2 rounded bg-canvas px-1.5 py-0.5 text-xs text-muted">Khẩn cấp</span>}
          </span>
          <span className="block text-sm text-muted">
            {kindLabel(account.kind)}
            {account.archivedAt && ' · đã lưu trữ'}
          </span>
          {goal && (
            <span className="mt-1.5 flex items-center gap-2 text-xs text-muted">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas">
                <span className="block h-full rounded-full bg-brand" style={{ width: `${goalProgress(balance, goal.targetAmount)}%` }} />
              </span>
              {goalProgress(balance, goal.targetAmount)}% mục tiêu
            </span>
          )}
        </span>
        <Money value={balance} tone={balance < 0 ? 'expense' : 'none'} className="font-medium" />
      </Link>
    </li>
  )
}
