import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Button, FormAlert } from '../../components/ui/form'
import { EmptyState, ErrorState, LoadingState, Money } from '../../components/ui/Money'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, useLedgerView } from '../../data/queries'
import { goalProgress, monthlyContributionToGoal } from '../../domain/goals'
import { today } from '../../lib/clock'
import { formatDate, formatMoney } from '../../lib/format'
import { archiveAccount, deleteAccount, hasTransactions, unarchiveAccount } from '../../services/accounts'
import { kindLabel } from '../transactions/describe'
import { TransactionList } from '../transactions/TransactionList'
import { useTransactionDialog } from '../transactions/transactionDialogContext'
import { AccountFormDialog } from './AccountFormDialog'
import { ReconcileDialog } from './ReconcileDialog'

export function AccountDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: view, isLoading, error } = useLedgerView()
  const dialog = useTransactionDialog()
  const invalidate = useInvalidate()
  const toast = useToast()
  const [editOpen, setEditOpen] = useState(false)
  const [reconcileOpen, setReconcileOpen] = useState(false)
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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
  const canDelete = !hasTransactions(account, view.transactions)
  const perMonth = account.goal ? monthlyContributionToGoal(balance, account.goal.targetAmount, account.goal.targetDate, today()) : null

  async function run(action: () => Promise<unknown>, message: string) {
    setActionError(null)
    try {
      await action()
      await invalidate('accounts')
      toast({ message })
      setConfirm(null)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Không thực hiện được, vui lòng thử lại')
    }
  }

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
          <Button variant="secondary" onClick={() => setEditOpen(true)}>
            Sửa
          </Button>
          {account.archivedAt ? (
            <Button variant="secondary" onClick={() => run(() => unarchiveAccount(getRepos(), account), `Đã khôi phục "${account.name}"`)}>
              Bỏ lưu trữ
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setConfirm('archive')}>
              Lưu trữ
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" className="text-negative" onClick={() => setConfirm('delete')}>
              Xóa
            </Button>
          )}
        </div>

        {actionError && (
          <div className="mt-4">
            <FormAlert tone="error">{actionError}</FormAlert>
          </div>
        )}
        {confirm === 'archive' && (
          <div className="mt-4 flex flex-col gap-3">
            <FormAlert tone="warning">
              {balance !== 0
                ? `Tài khoản còn ${formatMoney(balance)}. Nên chuyển số dư sang tài khoản khác trước khi lưu trữ — sau khi lưu trữ, số dư này không còn tính vào net worth hiện tại.`
                : 'Tài khoản sẽ ẩn khỏi danh sách nhưng lịch sử giao dịch vẫn được giữ.'}
            </FormAlert>
            <div className="flex gap-2">
              <Button onClick={() => run(() => archiveAccount(getRepos(), account), `Đã lưu trữ "${account.name}"`)}>Xác nhận lưu trữ</Button>
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                Hủy
              </Button>
            </div>
          </div>
        )}
        {confirm === 'delete' && (
          <div className="mt-4 flex gap-2">
            <Button
              variant="danger"
              onClick={() =>
                run(async () => {
                  await deleteAccount(getRepos(), account, view.transactions)
                  navigate('/accounts', { replace: true })
                }, `Đã xóa "${account.name}"`)
              }
            >
              Xác nhận xóa
            </Button>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Hủy
            </Button>
          </div>
        )}
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
