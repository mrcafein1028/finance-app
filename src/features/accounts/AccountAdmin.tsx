import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button, CheckboxField, FormAlert } from '../../components/ui/form'
import { FormDialog } from '../../components/ui/FormDialog'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useBudgetLines, useInvalidate, useRecurringRules, type LedgerView } from '../../data/queries'
import { formatMoney } from '../../lib/format'
import type { Account } from '../../schemas'
import { deleteAccountCascade, deletionImpact } from '../../services/accountEdit'
import { archiveAccount, unarchiveAccount } from '../../services/accounts'

/**
 * Hàng "quản lý" dưới các nút chính của mọi trang chi tiết tài khoản: Sửa thông tin · Lưu trữ / Dùng lại · Xóa.
 * Cố ý nhạt hơn các nút nghiệp vụ để khó bấm nhầm.
 */
export function AccountAdmin({ account, view, onEdit, backTo }: { account: Account; view: LedgerView; onEdit: () => void; backTo: string }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [confirm, setConfirm] = useState<null | 'archive' | 'delete'>(null)
  const [error, setError] = useState<string | null>(null)
  const balance = view.balances.get(account.id) ?? 0

  async function toggleArchive() {
    setError(null)
    try {
      if (account.archivedAt) await unarchiveAccount(getRepos(), account)
      else await archiveAccount(getRepos(), account)
      await invalidate('accounts')
      setConfirm(null)
      toast({ message: account.archivedAt ? `Đã dùng lại "${account.name}"` : `Đã lưu trữ "${account.name}"` })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được')
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="flex flex-wrap gap-x-1 gap-y-1 text-sm">
        <Button variant="ghost" className="px-3 py-1.5 text-sm" onClick={onEdit}>
          Sửa thông tin
        </Button>
        <Button variant="ghost" className="px-3 py-1.5 text-sm" onClick={() => (account.archivedAt ? void toggleArchive() : setConfirm('archive'))}>
          {account.archivedAt ? 'Dùng lại' : 'Lưu trữ'}
        </Button>
        <Button variant="ghost" className="px-3 py-1.5 text-sm text-negative" onClick={() => setConfirm('delete')}>
          Xóa…
        </Button>
      </div>
      {error && (
        <div className="mt-3">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      )}
      {confirm === 'archive' && (
        <div className="mt-3 flex flex-col gap-3">
          <FormAlert tone="warning">
            {balance !== 0
              ? `Tài khoản còn ${formatMoney(balance)}. Lưu trữ sẽ ẩn tài khoản và không tính số này vào net worth hiện tại nữa — nên chuyển hết số dư trước (hoặc trả hết nợ).`
              : 'Tài khoản sẽ ẩn khỏi danh sách và ô chọn tài khoản; lịch sử và báo cáo cũ vẫn giữ nguyên.'}
          </FormAlert>
          <div className="flex gap-2">
            <Button onClick={() => void toggleArchive()}>Xác nhận lưu trữ</Button>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Hủy
            </Button>
          </div>
        </div>
      )}
      {confirm === 'delete' && <DeleteAccountDialog account={account} view={view} backTo={backTo} onClose={() => setConfirm(null)} />}
    </div>
  )
}

function DeleteAccountDialog({ account, view, backTo, onClose }: { account: Account; view: LedgerView; backTo: string; onClose: () => void }) {
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const toast = useToast()
  const rules = useRecurringRules().data ?? []
  const lines = useBudgetLines().data ?? []
  const [understood, setUnderstood] = useState(false)
  const impact = deletionImpact(account, { accounts: view.accounts, transactions: view.transactions, trades: view.trades, holdings: view.holdings, recurringRules: rules, budgetLines: lines })
  const hasData = impact.transactions + impact.trades + impact.recurringRules + impact.budgetLines > 0
  const items = [
    [impact.transactions, 'giao dịch (gồm cả các phần cùng nghiệp vụ, VD gốc + lãi của một lần trả nợ)'],
    [impact.trades, 'lệnh mua / bán'],
    [impact.recurringRules, 'giao dịch định kỳ dùng tài khoản này'],
    [impact.budgetLines, 'dòng ngân sách dành cho tài khoản này'],
  ] as const

  return (
    <FormDialog
      title={`Xóa "${account.name}"`}
      submitLabel="Xóa vĩnh viễn"
      danger
      onClose={onClose}
      onSubmit={async () => {
        if (impact.blockedBy) return `Sổ tiết kiệm "${impact.blockedBy}" đang nhận lãi vào tài khoản này — đổi tài khoản nhận lãi của sổ đó trước.`
        if (hasData && !understood) return 'Tích xác nhận bạn hiểu dữ liệu sẽ bị xóa vĩnh viễn'
        await deleteAccountCascade(getRepos(), account.id)
        await invalidate()
        toast({ message: `Đã xóa "${account.name}"${impact.transactions ? ` và ${impact.transactions} giao dịch liên quan` : ''}` })
        navigate(backTo, { replace: true })
      }}
    >
      {impact.blockedBy ? (
        <FormAlert tone="error">Sổ tiết kiệm “{impact.blockedBy}” đang nhận lãi vào tài khoản này. Vào sổ đó → Sửa thông tin → đổi tài khoản nhận lãi, rồi quay lại xóa.</FormAlert>
      ) : hasData ? (
        <>
          <p className="text-sm">Xóa hẳn tài khoản này sẽ xóa luôn:</p>
          <ul aria-label="Dữ liệu sẽ bị xóa" className="list-disc space-y-1 pl-5 text-sm">
            {items
              .filter(([n]) => n > 0)
              .map(([n, label]) => (
                <li key={label}>
                  <strong>{n}</strong> {label}
                </li>
              ))}
          </ul>
          <FormAlert tone="warning">
            Số dư các tài khoản liên quan (VD tài khoản ngân hàng đã chuyển tiền sang đây) sẽ tính lại như chưa từng có các giao dịch này. Không hoàn tác được — nếu chưa chắc, hãy <strong>Lưu trữ</strong> thay vì xóa, hoặc tải file sao lưu trước (Cài đặt).
          </FormAlert>
          <CheckboxField label="Tôi hiểu, xóa vĩnh viễn tài khoản và dữ liệu trên" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
        </>
      ) : (
        <p className="text-sm">Tài khoản chưa có dữ liệu nào khác — xóa hẳn khỏi app.</p>
      )}
    </FormDialog>
  )
}
