import { useState } from 'react'
import { FormDialog } from '../../components/ui/FormDialog'
import { FormAlert, MoneyField, SelectField, TextField } from '../../components/ui/form'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, type LedgerView } from '../../data/queries'
import { today } from '../../lib/clock'
import { parseMoneyInput, parsePercentInput } from '../../lib/format'
import type { AccountOf, TermDepositDetails } from '../../schemas'
import { depositOpeningOf, editableTerm, updateDeposit } from '../../services/accountEdit'
import { percentText } from '../liabilities/labels'
import { AccountOptions } from '../transactions/pickers'

const TERMS = [1, 3, 6, 9, 12, 13, 18, 24, 36]

export function EditDepositDialog({ account, view, onClose }: { account: AccountOf<'term_deposit'>; view: LedgerView; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const d = account.details
  const term = editableTerm(account, view.depositTerms, view.transactions)
  const opening = depositOpeningOf(account, view.transactions, view.depositTerms)
  const [name, setName] = useState(account.name)
  const [bank, setBank] = useState(d.bankName)
  const [payout, setPayout] = useState<TermDepositDetails['interestPayout']>(d.interestPayout)
  const [action, setAction] = useState<TermDepositDetails['maturityAction']>(d.maturityAction)
  const [payoutAccount, setPayoutAccount] = useState(d.payoutAccountId)
  const [early, setEarly] = useState(percentText(d.earlyWithdrawalRate))
  const [principal, setPrincipal] = useState(term ? String(term.principal) : '')
  const [rate, setRate] = useState(term ? percentText(term.annualRate) : '')
  const [months, setMonths] = useState(term?.termMonths ?? 6)
  const [start, setStart] = useState(term?.startDate ?? '')

  return (
    <FormDialog
      title="Sửa sổ tiết kiệm"
      onClose={onClose}
      onSubmit={async () => {
        const e = parsePercentInput(early, 20)
        if (!name.trim() || !bank.trim()) return 'Nhập tên sổ và ngân hàng'
        if (e === null) return 'Lãi không kỳ hạn không hợp lệ'
        let termValues: { principal: number; annualRate: number; termMonths: number; startDate: string } | undefined
        if (term) {
          const p = parseMoneyInput(principal)
          const r = parsePercentInput(rate, 30)
          if (!p) return 'Nhập số tiền gửi'
          if (r === null) return 'Lãi suất không hợp lệ'
          if (!start || start > today()) return 'Ngày gửi không hợp lệ (không được ở tương lai)'
          termValues = { principal: p, annualRate: r, termMonths: months, startDate: start }
        }
        await updateDeposit(
          getRepos(),
          account,
          { name: name.trim(), details: { bankName: bank.trim(), interestPayout: payout, maturityAction: action, payoutAccountId: payoutAccount, earlyWithdrawalRate: e }, term: termValues },
          { accounts: view.accounts, terms: view.depositTerms, transactions: view.transactions },
        )
        await invalidate('accounts', 'depositTerms', 'transactions', 'snapshots')
        toast({ message: `Đã lưu "${name.trim()}"` })
        onClose()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Tên sổ" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Ngân hàng" value={bank} onChange={(e) => setBank(e.target.value)} />
      </div>
      {term ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <MoneyField label="Số tiền gửi" value={principal} rawValue={principal} onChange={(e) => setPrincipal(e.target.value)} />
            <TextField label="Lãi suất (%/năm)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            <TextField label="Ngày gửi" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            <SelectField label="Kỳ hạn" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {TERMS.map((m) => (
                <option key={m} value={m}>
                  {m} tháng
                </option>
              ))}
            </SelectField>
          </div>
          {opening && <p className="text-sm text-muted">Sổ mở từ “{view.accountById.get(opening.accountId)?.name}”: sửa số tiền / ngày gửi sẽ sửa luôn giao dịch chuyển tiền mở sổ.</p>}
        </>
      ) : (
        <FormAlert tone="warning">Sổ đã phát sinh lãi hoặc tái tục nên không sửa được số tiền, lãi suất, ngày gửi, cách nhận lãi. Nếu nhập nhầm từ đầu: Xóa sổ rồi mở lại.</FormAlert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Nhận lãi" value={payout} disabled={!term} onChange={(e) => setPayout(e.target.value as typeof payout)}>
          <option value="at_maturity">Cuối kỳ</option>
          <option value="monthly">Hằng tháng</option>
          <option value="upfront">Trả trước</option>
        </SelectField>
        <SelectField label="Khi đáo hạn" value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
          <option value="renew_principal">Tái tục gốc, nhận lãi</option>
          <option value="renew_with_interest">Tái tục cả gốc lẫn lãi</option>
          <option value="withdraw">Tất toán</option>
        </SelectField>
        <SelectField label="Tài khoản nhận lãi / tiền tất toán" value={payoutAccount} onChange={(e) => setPayoutAccount(e.target.value)}>
          <AccountOptions accounts={view.accounts} balances={view.balances} keep={d.payoutAccountId} filter={(a) => a.class === 'asset' && a.id !== account.id && ['cash', 'bank', 'ewallet', 'goal_fund'].includes(a.kind)} />
        </SelectField>
        <TextField label="Lãi không kỳ hạn khi rút trước hạn (%/năm)" inputMode="decimal" value={early} onChange={(e) => setEarly(e.target.value)} />
      </div>
    </FormDialog>
  )
}
