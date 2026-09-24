import { useState } from 'react'
import { Link } from 'react-router'
import { FormDialog } from '../../components/ui/FormDialog'
import { Button, MoneyField, SelectField, TextField } from '../../components/ui/form'
import { EmptyState, ErrorState, LoadingState, Money } from '../../components/ui/Money'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, useLedgerView, type LedgerView } from '../../data/queries'
import { diffDays } from '../../domain/dates'
import { maturityDateOf, simpleInterest, termActiveAt, termDays } from '../../domain/savings'
import { today } from '../../lib/clock'
import { formatDate, formatMoney, formatPercent, parseMoneyInput, parsePercentInput } from '../../lib/format'
import type { AccountOf } from '../../schemas'
import { openDeposit } from '../../services/savings'
import { AccountOptions } from '../transactions/pickers'

type Deposit = AccountOf<'term_deposit'>

export function SavingsPage() {
  const { data: view, isLoading, error } = useLedgerView()
  const [opening, setOpening] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  if (isLoading) return <LoadingState />
  if (error || !view) return <ErrorState error={error} />

  const deposits = view.accounts.filter((a): a is Deposit => a.kind === 'term_deposit')
  const active = deposits.filter((a) => !a.archivedAt)
  const closed = deposits.filter((a) => a.archivedAt)
  const total = active.reduce((s, a) => s + (view.balances.get(a.id) ?? 0), 0)

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tiết kiệm</h1>
          <p className="text-sm text-muted">
            Tổng giá trị (gồm lãi dồn tích): <Money value={total} className="font-semibold text-ink" />
          </p>
        </div>
        <Button onClick={() => setOpening(true)}>Mở sổ</Button>
      </div>
      {active.length === 0 ? (
        <EmptyState title="Chưa có sổ tiết kiệm nào">Thêm sổ đang có hoặc mở sổ mới từ tài khoản ngân hàng.</EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {active.map((a) => (
            <DepositCard key={a.id} account={a} view={view} />
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <section>
          <Button variant="ghost" onClick={() => setShowClosed((v) => !v)} aria-expanded={showClosed}>
            {showClosed ? 'Ẩn' : 'Hiện'} {closed.length} sổ đã tất toán
          </Button>
          {showClosed && (
            <ul className="mt-2 grid gap-3 opacity-75 md:grid-cols-2">
              {closed.map((a) => (
                <DepositCard key={a.id} account={a} view={view} />
              ))}
            </ul>
          )}
        </section>
      )}
      {opening && <OpenDepositDialog view={view} onClose={() => setOpening(false)} />}
    </section>
  )
}

function DepositCard({ account, view }: { account: Deposit; view: LedgerView }) {
  const now = today()
  const term = termActiveAt(view.depositTerms.filter((t) => t.accountId === account.id), now) ?? view.depositTerms.filter((t) => t.accountId === account.id).sort((a, b) => b.seq - a.seq)[0]
  const due = term && term.status === 'active' && term.maturityDate <= now
  return (
    <li>
      <Link to={`/savings/${account.id}`} className={`flex flex-col gap-2 rounded-2xl border bg-surface p-4 hover:bg-canvas ${due ? 'border-warning' : 'border-border'}`}>
        <span className="flex justify-between gap-2">
          <span className="font-medium">{account.name}</span>
          <Money value={view.balances.get(account.id) ?? 0} className="font-semibold" />
        </span>
        <span className="text-sm text-muted">
          {account.details.bankName}
          {term && ` · ${formatMoney(term.principal)} · ${formatPercent(term.annualRate)}/năm · ${term.termMonths} tháng`}
        </span>
        {term && !account.archivedAt && (
          <span className={`text-sm ${due ? 'font-medium text-warning' : 'text-muted'}`}>
            {due ? `Đã đáo hạn ${formatDate(term.maturityDate)} — cần xử lý` : `Đáo hạn ${formatDate(term.maturityDate)} (còn ${diffDays(now, term.maturityDate)} ngày)`}
          </span>
        )}
        {account.archivedAt && <span className="text-sm text-muted">Đã tất toán</span>}
      </Link>
    </li>
  )
}

const TERMS = [1, 3, 6, 9, 12, 13, 18, 24, 36]

function OpenDepositDialog({ view, onClose }: { view: LedgerView; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [name, setName] = useState('')
  const [bankName, setBankName] = useState('')
  const [principal, setPrincipal] = useState('')
  const [rate, setRate] = useState('')
  const [termMonths, setTermMonths] = useState(6)
  const [startDate, setStartDate] = useState(today())
  const [payout, setPayout] = useState<Deposit['details']['interestPayout']>('at_maturity')
  const [action, setAction] = useState<Deposit['details']['maturityAction']>('renew_principal')
  const [sourceId, setSourceId] = useState('')
  const [payoutId, setPayoutId] = useState('')
  const [earlyRate, setEarlyRate] = useState('0,1')

  const p = parseMoneyInput(principal)
  const r = parsePercentInput(rate, 20)
  const maturity = maturityDateOf(startDate || today(), termMonths)
  const preview = p && r !== null && startDate ? simpleInterest(p, r, termDays({ startDate, maturityDate: maturity })) : null
  const cashLike = (a: { kind: string }) => ['cash', 'bank', 'ewallet', 'goal_fund'].includes(a.kind)

  async function submit() {
    if (!name.trim() || !bankName.trim()) return 'Nhập tên sổ và ngân hàng'
    if (!p) return 'Nhập số tiền gửi'
    if (r === null) return 'Lãi suất không hợp lệ (VD 5,5)'
    const early = parsePercentInput(earlyRate, 20)
    if (early === null) return 'Lãi không kỳ hạn không hợp lệ'
    if (!payoutId) return 'Chọn tài khoản nhận lãi / nhận tiền khi tất toán'
    if (mode === 'new') {
      if (!sourceId) return 'Chọn tài khoản trích tiền gửi'
      const source = view.accountById.get(sourceId)!
      if (startDate < source.openingDate) return `Ngày mở sổ phải từ ${formatDate(source.openingDate)} (ngày bắt đầu theo dõi "${source.name}")`
      if ((view.balances.get(sourceId) ?? 0) < p) return `"${source.name}" không đủ ${formatMoney(p)}`
    }
    if (startDate > today()) return 'Ngày mở sổ không được ở tương lai'
    await openDeposit(
      getRepos(),
      {
        name: name.trim(),
        bankName: bankName.trim(),
        principal: p,
        annualRate: r,
        termMonths,
        startDate,
        interestPayout: payout,
        maturityAction: action,
        payoutAccountId: payoutId,
        earlyWithdrawalRate: early,
        sourceAccountId: mode === 'new' ? sourceId : null,
      },
      view.accounts.length,
    )
    await invalidate('accounts', 'depositTerms', 'transactions')
    toast({ message: `Đã thêm sổ "${name.trim()}"` })
    onClose()
  }

  return (
    <FormDialog title="Mở sổ tiết kiệm" onSubmit={submit} onClose={onClose}>
      <SelectField label="Loại" value={mode} onChange={(e) => setMode(e.target.value as 'new' | 'existing')}>
        <option value="new">Sổ mới — trích tiền từ tài khoản</option>
        <option value="existing">Sổ đã có từ trước</option>
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Tên sổ" placeholder="VD: Sổ ABC 6 tháng" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Ngân hàng" value={bankName} onChange={(e) => setBankName(e.target.value)} />
      </div>
      <MoneyField label="Số tiền gửi" value={principal} rawValue={principal} onChange={(e) => setPrincipal(e.target.value)} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Lãi suất (%/năm)" inputMode="decimal" placeholder="5,5" value={rate} onChange={(e) => setRate(e.target.value)} />
        <SelectField label="Kỳ hạn" value={termMonths} onChange={(e) => setTermMonths(Number(e.target.value))}>
          {TERMS.map((m) => (
            <option key={m} value={m}>
              {m} tháng
            </option>
          ))}
        </SelectField>
        <TextField label="Ngày gửi" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </div>
      {preview !== null && (
        <p role="status" className="rounded-lg bg-canvas px-3 py-2 text-sm">
          Đáo hạn <strong>{formatDate(maturity)}</strong> · lãi dự kiến <strong>{formatMoney(preview)}</strong>
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Nhận lãi" value={payout} onChange={(e) => setPayout(e.target.value as typeof payout)}>
          <option value="at_maturity">Cuối kỳ</option>
          <option value="monthly">Hằng tháng</option>
          <option value="upfront">Trả trước</option>
        </SelectField>
        <SelectField label="Khi đáo hạn" value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
          <option value="renew_principal">Tái tục gốc, nhận lãi</option>
          <option value="renew_with_interest">Tái tục cả gốc lẫn lãi</option>
          <option value="withdraw">Tất toán</option>
        </SelectField>
      </div>
      {mode === 'new' && (
        <SelectField label="Trích tiền từ" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          <AccountOptions accounts={view.accounts} balances={view.balances} filter={cashLike} />
        </SelectField>
      )}
      <SelectField label="Tài khoản nhận lãi / tiền tất toán" value={payoutId} onChange={(e) => setPayoutId(e.target.value)}>
        <AccountOptions accounts={view.accounts} balances={view.balances} filter={cashLike} />
      </SelectField>
      <TextField label="Lãi không kỳ hạn khi rút trước hạn (%/năm)" inputMode="decimal" value={earlyRate} onChange={(e) => setEarlyRate(e.target.value)} />
    </FormDialog>
  )
}
