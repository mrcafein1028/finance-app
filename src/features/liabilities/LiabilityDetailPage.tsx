import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { FormDialog } from '../../components/ui/FormDialog'
import { Button, MoneyField, SegmentedControl, SelectField, TextField } from '../../components/ui/form'
import { EmptyState, ErrorState, LoadingState, Money } from '../../components/ui/Money'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, useLedgerView, type LedgerView } from '../../data/queries'
import { creditCardMinimumPayment, creditCardMonthsToPayoff, flatRateApr, payoffDate, totalInterest, type PrepaymentMode } from '../../domain/loan'
import { today } from '../../lib/clock'
import { formatDate, formatMoney, formatPercent, parseMoneyInput, parsePercentInput } from '../../lib/format'
import type { AccountOf } from '../../schemas'
import { changeLoanRate, isLoan, prepayLoan, previewPrepayment, recordLoanPayment, upcomingSchedule, type LoanAccount } from '../../services/liabilities'
import { AccountOptions } from '../transactions/pickers'
import { TransactionList } from '../transactions/TransactionList'
import { useTransactionDialog } from '../transactions/transactionDialogContext'

const cashLike = (a: { kind: string }) => ['cash', 'bank', 'ewallet'].includes(a.kind)

export function LiabilityDetailPage() {
  const { id } = useParams()
  const { data: view, isLoading, error } = useLedgerView()
  if (isLoading) return <LoadingState />
  if (error || !view) return <ErrorState error={error} />
  const account = view.accountById.get(id ?? '')
  if (!account) return <EmptyState title="Không tìm thấy khoản nợ" />
  if (isLoan(account)) return <Loan loan={account} view={view} />
  if (account.kind === 'credit_card') return <Card card={account} view={view} />
  return <EmptyState title="Không phải khoản nợ" />
}

function Loan({ loan, view }: { loan: LoanAccount; view: LedgerView }) {
  const txDialog = useTransactionDialog()
  const [dialog, setDialog] = useState<'pay' | 'prepay' | 'rate' | null>(null)
  const [showAll, setShowAll] = useState(false)
  const now = today()
  const outstanding = view.balances.get(loan.id) ?? 0
  const rows = upcomingSchedule(loan, view.transactions, now)
  const next = rows[0]
  const currentRate = loan.details.ratePeriods.filter((p) => p.from <= now).at(-1)?.annualRate ?? loan.details.ratePeriods[0]!.annualRate
  const transactions = view.transactions.filter((t) => t.toAccountId === loan.id || t.accountId === loan.id || (t.groupId && view.transactions.some((x) => x.groupId === t.groupId && x.toAccountId === loan.id)))

  return (
    <section className="flex flex-col gap-5">
      <Link to="/liabilities" className="text-sm text-brand">
        ‹ Khoản nợ
      </Link>
      <div className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-sm text-muted">
          {loan.details.lender ?? 'Khoản vay'}
          {loan.archivedAt && ' · đã tất toán 🎉'}
        </p>
        <h1 className="text-2xl font-semibold">{loan.name}</h1>
        <p className="mt-2 text-3xl font-semibold">
          <Money value={outstanding} /> <span className="text-base font-normal text-muted">dư nợ</span>
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">Lãi suất hiện tại</dt>
            <dd>{formatPercent(currentRate)}/năm</dd>
          </div>
          <div>
            <dt className="text-muted">{next && next.dueDate < now ? 'Kỳ quá hạn' : 'Kỳ tới'}</dt>
            <dd className={next && next.dueDate < now ? 'text-negative' : ''}>{next ? `${formatDate(next.dueDate)} · ${formatMoney(next.payment)}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted">Lãi còn phải trả</dt>
            <dd><Money value={totalInterest(rows)} /></dd>
          </div>
          <div>
            <dt className="text-muted">Trả hết</dt>
            <dd>{rows.length ? formatDate(payoffDate(rows)!) : '—'}</dd>
          </div>
        </dl>
        {loan.details.rateType === 'flat' && currentRate > 0 && (
          <p className="mt-3 text-sm text-warning">Lãi phẳng {formatPercent(currentRate)} ≈ {formatPercent(flatRateApr(currentRate, loan.details.termMonths), 1)}/năm lãi thực tế.</p>
        )}
        {!loan.archivedAt && outstanding > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => setDialog('pay')}>Ghi trả kỳ này</Button>
            <Button variant="secondary" onClick={() => setDialog('prepay')}>
              Trả trước
            </Button>
            <Button variant="secondary" onClick={() => setDialog('rate')}>
              Đổi lãi suất
            </Button>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <section aria-label="Lịch trả nợ">
          <h2 className="mb-2 text-lg font-semibold">Lịch trả nợ dự kiến</h2>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Kỳ</th>
                  <th className="px-4 py-2 font-medium">Ngày</th>
                  <th className="px-4 py-2 text-right font-medium">Gốc</th>
                  <th className="px-4 py-2 text-right font-medium">Lãi</th>
                  <th className="px-4 py-2 text-right font-medium">Tổng trả</th>
                  <th className="px-4 py-2 text-right font-medium">Dư nợ còn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular">
                {(showAll ? rows : rows.slice(0, 12)).map((r) => (
                  <tr key={r.seq}>
                    <td className="px-4 py-2">{r.seq}</td>
                    <td className="px-4 py-2">{formatDate(r.dueDate)}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(r.principal)}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(r.interest)}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatMoney(r.payment)}</td>
                    <td className="px-4 py-2 text-right text-muted">{formatMoney(r.closingBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 12 && (
            <Button variant="ghost" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Thu gọn' : `Xem đủ ${rows.length} kỳ`}
            </Button>
          )}
        </section>
      )}

      <h2 className="text-lg font-semibold">Lịch sử</h2>
      {transactions.length === 0 ? <EmptyState title="Chưa có giao dịch" /> : <TransactionList transactions={transactions} ctx={view} onSelect={txDialog.openEdit} />}

      {dialog === 'pay' && <PaymentDialog loan={loan} view={view} onClose={() => setDialog(null)} />}
      {dialog === 'prepay' && <PrepayDialog loan={loan} view={view} outstanding={outstanding} onClose={() => setDialog(null)} />}
      {dialog === 'rate' && <RateDialog loan={loan} onClose={() => setDialog(null)} />}
    </section>
  )
}

function PaymentDialog({ loan, view, onClose }: { loan: LoanAccount; view: LedgerView; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const next = upcomingSchedule(loan, view.transactions, today())[0]
  const [date, setDate] = useState(next && next.dueDate <= today() ? next.dueDate : today())
  const [principal, setPrincipal] = useState(String(next?.principal ?? 0))
  const [interest, setInterest] = useState(String(next?.interest ?? 0))
  const [fee, setFee] = useState('0')
  const [source, setSource] = useState('')
  const p = parseMoneyInput(principal)
  const i = parseMoneyInput(interest)
  const deviates = next && p !== null && i !== null && Math.abs(p + i - next.payment) > next.payment * 0.2

  return (
    <FormDialog
      title={`Trả nợ ${loan.name}`}
      onClose={onClose}
      onSubmit={async () => {
        const f = parseMoneyInput(fee)
        if (p === null || i === null || f === null) return 'Số tiền không hợp lệ'
        if (!source) return 'Chọn tài khoản trả'
        const result = await recordLoanPayment(getRepos(), loan, { date, sourceAccountId: source, principal: p, interest: i, fee: f }, { accounts: view.accounts, categories: view.categories, transactions: view.transactions, today: today() })
        await invalidate('transactions', 'accounts')
        toast({ message: result.paidOff ? `🎉 Đã trả hết ${loan.name}!` : 'Đã ghi kỳ trả nợ' })
        onClose()
      }}
    >
      {next && (
        <p className="text-sm text-muted">
          Theo lịch kỳ {next.seq} ({formatDate(next.dueDate)}): gốc {formatMoney(next.principal)} + lãi {formatMoney(next.interest)}. Sửa theo sao kê ngân hàng nếu khác.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyField label="Tiền gốc" value={principal} rawValue={principal} onChange={(e) => setPrincipal(e.target.value)} />
        <MoneyField label="Tiền lãi" value={interest} rawValue={interest} onChange={(e) => setInterest(e.target.value)} />
        <MoneyField label="Phí (nếu có)" value={fee} rawValue={fee} onChange={(e) => setFee(e.target.value)} />
        <TextField label="Ngày trả" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {deviates && <p className="text-sm text-warning">Tổng trả lệch hơn 20% so với lịch — kiểm tra lại.</p>}
      <SelectField label="Trả từ tài khoản" value={source} onChange={(e) => setSource(e.target.value)}>
        <AccountOptions accounts={view.accounts} balances={view.balances} filter={cashLike} />
      </SelectField>
      <p className="text-xs text-muted">Tiền gốc làm giảm dư nợ (không tính là chi tiêu); tiền lãi và phí được ghi là chi phí.</p>
    </FormDialog>
  )
}

function PrepayDialog({ loan, view, outstanding, onClose }: { loan: LoanAccount; view: LedgerView; outstanding: number; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<PrepaymentMode>('reduce_term')
  const [source, setSource] = useState('')
  const date = today()
  const a = parseMoneyInput(amount)
  const preview = a && a <= outstanding ? previewPrepayment(loan, outstanding, date, a, mode) : null

  return (
    <FormDialog
      title={`Trả trước ${loan.name}`}
      submitLabel="Xác nhận trả trước"
      onClose={onClose}
      onSubmit={async () => {
        if (!a) return 'Nhập số tiền trả trước'
        if (a > outstanding) return `Tối đa ${formatMoney(outstanding)}`
        if (!source) return 'Chọn tài khoản trả'
        const result = await prepayLoan(getRepos(), loan, { date, sourceAccountId: source, amount: a, mode, outstanding }, { accounts: view.accounts, categories: view.categories, transactions: view.transactions, today: date })
        await invalidate('transactions', 'accounts')
        toast({ message: result.paidOff ? `🎉 Đã trả hết ${loan.name}!` : `Đã trả trước — tiết kiệm ~${formatMoney(result.preview.interestSaved - result.preview.fee)} lãi` })
        onClose()
      }}
    >
      <MoneyField label="Số tiền trả trước" value={amount} rawValue={amount} onChange={(e) => setAmount(e.target.value)} hint={`Dư nợ hiện tại ${formatMoney(outstanding)}`} />
      <SegmentedControl
        label="Sau khi trả trước"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'reduce_term', label: 'Giảm kỳ hạn' },
          { value: 'reduce_payment', label: 'Giảm khoản trả' },
        ]}
      />
      <SelectField label="Trả từ tài khoản" value={source} onChange={(e) => setSource(e.target.value)}>
        <AccountOptions accounts={view.accounts} balances={view.balances} filter={cashLike} />
      </SelectField>
      {preview && (
        <div role="status" className="rounded-lg bg-canvas px-3 py-2 text-sm">
          <p>
            Tiết kiệm lãi: <strong>{formatMoney(preview.interestSaved)}</strong>
            {preview.fee > 0 && <> · phí trả trước {formatMoney(preview.fee)}</>}
          </p>
          {mode === 'reduce_term' ? (
            <p>
              Trả hết sớm hơn <strong>{preview.periodsSaved} kỳ</strong>
              {preview.after.length > 0 && <> ({formatDate(payoffDate(preview.after)!)})</>}
            </p>
          ) : (
            preview.after[0] && (
              <p>
                Khoản trả kỳ tới: {formatMoney(preview.before[0]!.payment)} → <strong>{formatMoney(preview.after[0].payment)}</strong>
              </p>
            )
          )}
        </div>
      )}
    </FormDialog>
  )
}

function RateDialog({ loan, onClose }: { loan: LoanAccount; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [from, setFrom] = useState(today())
  const [rate, setRate] = useState('')
  return (
    <FormDialog
      title="Đổi lãi suất"
      onClose={onClose}
      onSubmit={async () => {
        const r = parsePercentInput(rate, 60)
        if (r === null) return 'Lãi suất không hợp lệ'
        await changeLoanRate(getRepos(), loan, from, r)
        await invalidate('accounts')
        toast({ message: 'Đã cập nhật lãi suất — lịch trả nợ được tính lại' })
        onClose()
      }}
    >
      <p className="text-sm text-muted">Dùng khi hết thời gian ưu đãi hoặc ngân hàng điều chỉnh lãi thả nổi.</p>
      <ul className="text-sm">
        {loan.details.ratePeriods.map((p) => (
          <li key={p.from}>
            Từ {formatDate(p.from)}: {formatPercent(p.annualRate)}
          </li>
        ))}
      </ul>
      <TextField label="Áp dụng từ ngày" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      <TextField label="Lãi suất mới (%/năm)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
    </FormDialog>
  )
}

function Card({ card, view }: { card: AccountOf<'credit_card'>; view: LedgerView }) {
  const txDialog = useTransactionDialog()
  const balance = Math.max(0, view.balances.get(card.id) ?? 0)
  const minimum = creditCardMinimumPayment(balance, card.details.minPaymentRate)
  const [payment, setPayment] = useState(String(minimum || ''))
  const pay = parseMoneyInput(payment)
  const months = pay ? creditCardMonthsToPayoff(balance, card.details.annualRate, pay) : null
  const transactions = view.transactions.filter((t) => t.accountId === card.id || t.toAccountId === card.id)

  return (
    <section className="flex flex-col gap-5">
      <Link to="/liabilities" className="text-sm text-brand">
        ‹ Khoản nợ
      </Link>
      <div className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-sm text-muted">Thẻ tín dụng {card.details.issuer ?? ''}</p>
        <h1 className="text-2xl font-semibold">{card.name}</h1>
        <p className="mt-2 text-3xl font-semibold">
          <Money value={balance} /> <span className="text-base font-normal text-muted">dư nợ</span>
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">Hạn mức</dt>
            <dd><Money value={card.details.creditLimit} /></dd>
          </div>
          <div>
            <dt className="text-muted">Đã dùng</dt>
            <dd className={balance / card.details.creditLimit > 0.5 ? 'text-negative' : ''}>{formatPercent(balance / card.details.creditLimit, 0)}</dd>
          </div>
          <div>
            <dt className="text-muted">Tối thiểu phải trả</dt>
            <dd><Money value={minimum} /></dd>
          </div>
          <div>
            <dt className="text-muted">Sao kê / hạn trả</dt>
            <dd>
              Ngày {card.details.statementDay} / ngày {card.details.dueDay}
            </dd>
          </div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => txDialog.openNew({ type: 'transfer', toAccountId: card.id })}>Thanh toán thẻ</Button>
          <Button variant="secondary" onClick={() => txDialog.openNew({ type: 'expense', accountId: card.id })}>
            Ghi chi tiêu / lãi, phí
          </Button>
        </div>
      </div>
      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">Bao lâu thì trả hết?</h2>
        <div className="mt-3 max-w-sm">
          <MoneyField label="Nếu mỗi tháng trả" value={payment} rawValue={payment} onChange={(e) => setPayment(e.target.value)} />
        </div>
        <p role="status" className="mt-3 text-sm">
          {!pay
            ? 'Nhập số tiền để tính.'
            : months === null
              ? `⚠ Khoản trả này không đủ trả lãi ${formatPercent(card.details.annualRate)}/năm — dư nợ sẽ không bao giờ hết.`
              : months === 0
                ? 'Không còn dư nợ.'
                : `Trả hết sau khoảng ${months} tháng${months >= 24 ? ` (~${(months / 12).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} năm)` : ''}.`}
        </p>
      </section>
      <h2 className="text-lg font-semibold">Giao dịch</h2>
      {transactions.length === 0 ? <EmptyState title="Chưa có giao dịch" /> : <TransactionList transactions={transactions} ctx={view} accountId={card.id} onSelect={txDialog.openEdit} />}
    </section>
  )
}
