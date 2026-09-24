import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { FormDialog } from '../../components/ui/FormDialog'
import { Button, MoneyField, SelectField, TextField } from '../../components/ui/form'
import { EmptyState, ErrorState, LoadingState, Money } from '../../components/ui/Money'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, useLedgerView, type LedgerView } from '../../data/queries'
import { accruedInterest, earlyWithdrawalInterest, maturityDateOf, termInterest } from '../../domain/savings'
import { today } from '../../lib/clock'
import { formatDate, formatMoney, formatPercent, parseMoneyInput, parsePercentInput } from '../../lib/format'
import type { AccountOf, DepositTerm } from '../../schemas'
import { matureDeposit, withdrawEarly } from '../../services/savings'
import { TransactionList } from '../transactions/TransactionList'
import { useTransactionDialog } from '../transactions/transactionDialogContext'

type Deposit = AccountOf<'term_deposit'>
const ACTIONS = { renew_principal: 'Tái tục gốc, nhận lãi', renew_with_interest: 'Tái tục cả gốc lẫn lãi', withdraw: 'Tất toán' } as const
const STATUS = { active: 'Đang gửi', matured: 'Đã đáo hạn', withdrawn_early: 'Rút trước hạn' } as const

export function SavingsDetailPage() {
  const { id } = useParams()
  const { data: view, isLoading, error } = useLedgerView()
  const txDialog = useTransactionDialog()
  const [dialog, setDialog] = useState<'mature' | 'early' | null>(null)
  if (isLoading) return <LoadingState />
  if (error || !view) return <ErrorState error={error} />
  const account = view.accountById.get(id ?? '')
  if (!account || account.kind !== 'term_deposit') return <EmptyState title="Không tìm thấy sổ tiết kiệm" />

  const terms = view.depositTerms.filter((t) => t.accountId === account.id).sort((a, b) => b.seq - a.seq)
  const active = terms.find((t) => t.status === 'active') ?? null
  const now = today()
  const due = active !== null && active.maturityDate <= now
  const transactions = view.transactions.filter((t) => t.accountId === account.id || t.toAccountId === account.id)

  return (
    <section className="flex flex-col gap-5">
      <Link to="/savings" className="text-sm text-brand">
        ‹ Tiết kiệm
      </Link>
      <div className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-sm text-muted">
          {account.details.bankName}
          {account.archivedAt && ' · đã tất toán'}
        </p>
        <h1 className="text-2xl font-semibold">{account.name}</h1>
        <p className="mt-2 text-3xl font-semibold">
          <Money value={view.balances.get(account.id) ?? 0} />
        </p>
        {active && (
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted">Gốc</dt>
              <dd><Money value={active.principal} /></dd>
            </div>
            <div>
              <dt className="text-muted">Lãi suất</dt>
              <dd>{formatPercent(active.annualRate)}/năm</dd>
            </div>
            <div>
              <dt className="text-muted">Đáo hạn</dt>
              <dd>{formatDate(active.maturityDate)}</dd>
            </div>
            <div>
              <dt className="text-muted">Lãi dồn tích / cả kỳ</dt>
              <dd>
                <Money value={accruedInterest(active, now)} /> / <Money value={termInterest(active)} />
              </dd>
            </div>
          </dl>
        )}
        {!account.archivedAt && active && (
          <div className="mt-5 flex flex-wrap gap-2">
            {due ? (
              <Button onClick={() => setDialog('mature')}>Xử lý đáo hạn</Button>
            ) : (
              <Button variant="secondary" onClick={() => setDialog('early')}>
                Rút trước hạn
              </Button>
            )}
          </div>
        )}
      </div>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Các kỳ gửi</h2>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-sm">
          {terms.map((t) => (
            <li key={t.id} className="flex flex-wrap justify-between gap-2 px-4 py-3">
              <span>
                Kỳ {t.seq}: {formatDate(t.startDate)} → {formatDate(t.maturityDate)} · {formatPercent(t.annualRate)}
              </span>
              <span className="text-muted">
                {STATUS[t.status]}
                {t.status !== 'active' && ` · lãi ${formatMoney(t.interestPaid)}`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <h2 className="text-lg font-semibold">Giao dịch</h2>
      {transactions.length === 0 ? <EmptyState title="Chưa có giao dịch" /> : <TransactionList transactions={transactions} ctx={view} accountId={account.id} onSelect={txDialog.openEdit} />}

      {dialog === 'mature' && active && <MatureDialog account={account} term={active} view={view} onClose={() => setDialog(null)} />}
      {dialog === 'early' && active && <EarlyDialog account={account} term={active} onClose={() => setDialog(null)} />}
    </section>
  )
}

function MatureDialog({ account, term, view, onClose }: { account: Deposit; term: DepositTerm; view: LedgerView; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const paidDuring = account.details.interestPayout !== 'at_maturity'
  const [interest, setInterest] = useState(String(paidDuring ? 0 : termInterest(term)))
  const [action, setAction] = useState(account.details.maturityAction)
  const [rate, setRate] = useState(String(Math.round(term.annualRate * 1e6) / 1e4).replace('.', ','))
  const [months, setMonths] = useState(term.termMonths)
  const payout = view.accountById.get(account.details.payoutAccountId)

  return (
    <FormDialog
      title={`Đáo hạn ${account.name}`}
      submitLabel="Xác nhận"
      onClose={onClose}
      onSubmit={async () => {
        const i = parseMoneyInput(interest)
        if (i === null) return 'Nhập lãi thực nhận (có thể là 0)'
        const r = parsePercentInput(rate, 20)
        if (action !== 'withdraw' && r === null) return 'Lãi suất kỳ mới không hợp lệ'
        await matureDeposit(getRepos(), account, term, { actualInterest: i, action, nextRate: r ?? undefined, nextTermMonths: months })
        await invalidate('accounts', 'depositTerms', 'transactions')
        toast({ message: action === 'withdraw' ? `Đã tất toán — tiền về ${payout?.name ?? 'tài khoản nhận'}` : 'Đã tái tục sổ' })
        onClose()
      }}
    >
      <MoneyField
        label="Lãi thực nhận"
        value={interest}
        rawValue={interest}
        onChange={(e) => setInterest(e.target.value)}
        hint={paidDuring ? 'Sổ trả lãi trong kỳ — lãi đã được ghi hằng tháng/trả trước' : `Tính theo ngày thực/365: ${formatMoney(termInterest(term))} — sửa theo số ngân hàng trả`}
      />
      <SelectField label="Xử lý" value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
        {Object.entries(ACTIONS).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </SelectField>
      {action !== 'withdraw' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Lãi suất kỳ mới (%/năm)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          <SelectField label="Kỳ hạn mới" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {[1, 3, 6, 9, 12, 13, 18, 24, 36].map((m) => (
              <option key={m} value={m}>
                {m} tháng
              </option>
            ))}
          </SelectField>
          <p className="text-sm text-muted sm:col-span-2">Kỳ mới: {formatDate(term.maturityDate)} → {formatDate(maturityDateOf(term.maturityDate, months))}</p>
        </div>
      )}
    </FormDialog>
  )
}

function EarlyDialog({ account, term, onClose }: { account: Deposit; term: DepositTerm; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [date, setDate] = useState(today())
  const suggested = earlyWithdrawalInterest(term, account.details.earlyWithdrawalRate, date)
  const [interest, setInterest] = useState('')

  return (
    <FormDialog
      title={`Rút trước hạn ${account.name}`}
      submitLabel="Rút"
      danger
      onClose={onClose}
      onSubmit={async () => {
        const i = interest.trim() === '' ? suggested : parseMoneyInput(interest)
        if (i === null) return 'Lãi thực nhận không hợp lệ'
        await withdrawEarly(getRepos(), account, term, date, i)
        await invalidate('accounts', 'depositTerms', 'transactions')
        toast({ message: 'Đã rút trước hạn — sổ được lưu trữ' })
        onClose()
      }}
    >
      <p className="text-sm text-muted">
        Rút trước hạn chỉ hưởng lãi không kỳ hạn {formatPercent(account.details.earlyWithdrawalRate)}/năm thay vì {formatPercent(term.annualRate)}.
        Nếu chờ đến {formatDate(term.maturityDate)} bạn nhận {formatMoney(termInterest(term))}.
      </p>
      <TextField label="Ngày rút" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <MoneyField label="Lãi thực nhận" placeholder={String(suggested)} value={interest} rawValue={interest} onChange={(e) => setInterest(e.target.value)} hint={`Dự tính: ${formatMoney(suggested)}`} />
    </FormDialog>
  )
}
