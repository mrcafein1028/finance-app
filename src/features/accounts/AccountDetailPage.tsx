import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '../../components/ui/form'
import { EmptyState, ErrorState, LoadingState, Money } from '../../components/ui/Money'
import { useLedgerView } from '../../data/queries'
import { goalProgress, monthlyContributionToGoal } from '../../domain/goals'
import { today } from '../../lib/clock'
import { formatDate, formatMoney } from '../../lib/format'
import { kindLabel } from '../transactions/describe'
import { TransactionList } from '../transactions/TransactionList'
import { useTransactionDialog } from '../transactions/transactionDialogContext'
import { AccountAdmin } from './AccountAdmin'
import { AccountFormDialog } from './AccountFormDialog'
import { ReconcileDialog } from './ReconcileDialog'

export function AccountDetailPage() {
  const { id } = useParams()
  const { data: view, isLoading, error } = useLedgerView()
  const dialog = useTransactionDialog()
  const [editOpen, setEditOpen] = useState(false)
  const [reconcileOpen, setReconcileOpen] = useState(false)

  if (isLoading) return <LoadingState />
  if (error || !view) return <ErrorState error={error} />
  const account = view.accountById.get(id ?? '')
  if (!account) {
    return (
      <EmptyState title="Không tìm thấy tài khoản">
        <Link to="/accounts" className="text-brand">
          Về danh sách tài khoản
        </Link>
      </EmptyState>
    )
  }

  const balance = view.balances.get(account.id) ?? 0
  const transactions = view.transactions.filter((t) => t.accountId === account.id || t.toAccountId === account.id)
  const perMonth = account.goal ? monthlyContributionToGoal(balance, account.goal.targetAmount, account.goal.targetDate, today()) : null

  return (
    <section className="flex flex-col gap-5">
      <Link to="/accounts" className="text-sm text-brand">
        ‹ Tài khoản & quỹ
      </Link>
      <div className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-sm text-muted">
          {kindLabel(account.kind)}
          {account.archivedAt && ' · đã lưu trữ'}
        </p>
        <h1 className="text-2xl font-semibold">{account.name}</h1>
        <p className="mt-2 text-3xl font-semibold">
          <Money value={balance} tone={balance < 0 ? 'expense' : 'none'} />
        </p>
        <p className="mt-1 text-sm text-muted">
          Bắt đầu theo dõi {formatDate(account.openingDate)} với {formatMoney(account.openingBalance)}
        </p>
        {account.goal && (
          <div className="mt-4">
            <div className="flex justify-between text-sm">
              <span>Mục tiêu {formatMoney(account.goal.targetAmount)}</span>
              <span>{goalProgress(balance, account.goal.targetAmount)}%</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={goalProgress(balance, account.goal.targetAmount)} aria-valuemin={0} aria-valuemax={100} aria-label="Tiến độ mục tiêu">
              <div className="h-full rounded-full bg-brand" style={{ width: `${goalProgress(balance, account.goal.targetAmount)}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted">
              {balance >= account.goal.targetAmount
                ? '🎉 Đã đạt mục tiêu!'
                : perMonth !== null
                  ? `Cần góp ${formatMoney(perMonth)}/tháng để đạt trước ${formatDate(account.goal.targetDate!)}`
                  : `Còn thiếu ${formatMoney(account.goal.targetAmount - balance)}`}
            </p>
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          {!account.archivedAt && (
            <>
              <Button onClick={() => dialog.openNew({ type: account.kind === 'goal_fund' ? 'transfer' : 'expense', ...(account.kind === 'goal_fund' ? { toAccountId: account.id } : { accountId: account.id }) })}>
                {account.kind === 'goal_fund' ? 'Góp vào quỹ' : 'Thêm giao dịch'}
              </Button>
              <Button variant="secondary" onClick={() => setReconcileOpen(true)}>
                Đối soát số dư
              </Button>
            </>
          )}
        </div>
        <AccountAdmin account={account} view={view} onEdit={() => setEditOpen(true)} backTo="/accounts" />
      </div>

      <h2 className="text-lg font-semibold">Giao dịch</h2>
      {transactions.length === 0 ? (
        <EmptyState title="Chưa có giao dịch nào" />
      ) : (
        <TransactionList transactions={transactions} ctx={view} accountId={account.id} onSelect={dialog.openEdit} />
      )}

      <AccountFormDialog open={editOpen} editing={account} onClose={() => setEditOpen(false)} />
      <ReconcileDialog open={reconcileOpen} account={account} onClose={() => setReconcileOpen(false)} />
    </section>
  )
}
