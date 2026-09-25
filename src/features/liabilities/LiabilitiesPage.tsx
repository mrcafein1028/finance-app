import { useState } from 'react'
import { Link } from 'react-router'
import { FormDialog } from '../../components/ui/FormDialog'
import { Button, MoneyField, SelectField, TextField } from '../../components/ui/form'
import { EmptyState, ErrorState, LoadingState, Money } from '../../components/ui/Money'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, useLedgerView, type LedgerView } from '../../data/queries'
import { buildSchedule, creditCardMinimumPayment, flatRateApr, payoffDate, totalInterest, type LoanTerms } from '../../domain/loan'
import { today } from '../../lib/clock'
import { formatDate, formatMoney, formatPercent, parseMoneyInput, parsePercentInput } from '../../lib/format'
import type { AccountOf, LoanRateType } from '../../schemas'
import { createCreditCard, createLoan, isLoan, upcomingSchedule } from '../../services/liabilities'
import { AccountOptions } from '../transactions/pickers'
import { RATE_TYPES } from './labels'

export function LiabilitiesPage() {
  const { data: view, isLoading, error } = useLedgerView()
  const [dialog, setDialog] = useState<'loan' | 'card' | null>(null)
  if (isLoading) return <LoadingState />
  if (error || !view) return <ErrorState error={error} />
  const loans = view.accounts.filter(isLoan).filter((a) => !a.archivedAt)
  const cards = view.accounts.filter((a): a is AccountOf<'credit_card'> => a.kind === 'credit_card' && !a.archivedAt)
  const total = [...loans, ...cards].reduce((s, a) => s + (view.balances.get(a.id) ?? 0), 0)
  const now = today()

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Khoản nợ</h1>
          <p className="text-sm text-muted">
            Tổng dư nợ: <Money value={total} className="font-semibold text-ink" />
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setDialog('card')}>
            Thêm thẻ tín dụng
          </Button>
          <Button onClick={() => setDialog('loan')}>Thêm khoản vay</Button>
        </div>
      </div>

      <section aria-label="Khoản vay">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">Khoản vay</h2>
        {loans.length === 0 ? (
          <EmptyState title="Không có khoản vay nào">Tuyệt vời! Nếu đang có khoản vay nhà, xe, tiêu dùng hay vay người thân, thêm vào để theo dõi lịch trả.</EmptyState>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {loans.map((loan) => {
              const next = upcomingSchedule(loan, view.transactions, now)[0]
              const rows = upcomingSchedule(loan, view.transactions, now)
              return (
                <li key={loan.id}>
                  <Link to={`/liabilities/${loan.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-canvas">
                    <span className="min-w-0">
                      <span className="block font-medium">{loan.name}</span>
                      <span className="block text-sm text-muted">
                        {formatPercent(loan.details.ratePeriods.at(-1)?.annualRate ?? 0)}/năm
                        {next && (
                          <span className={next.dueDate < now ? 'text-negative' : ''}>
                            {' · '}
                            {next.dueDate < now ? 'Quá hạn' : 'Kỳ tới'} {formatDate(next.dueDate)}: {formatMoney(next.payment)}
                          </span>
                        )}
                      </span>
                      {rows.length > 0 && <span className="block text-sm text-muted">Trả hết {formatDate(payoffDate(rows)!)}</span>}
                    </span>
                    <Money value={view.balances.get(loan.id) ?? 0} className="font-medium" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-label="Thẻ tín dụng">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">Thẻ tín dụng</h2>
        {cards.length === 0 ? (
          <EmptyState title="Chưa có thẻ tín dụng" />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {cards.map((card) => {
              const balance = view.balances.get(card.id) ?? 0
              const utilization = balance / card.details.creditLimit
              return (
                <li key={card.id}>
                  <Link to={`/liabilities/${card.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-canvas">
                    <span>
                      <span className="block font-medium">{card.name}</span>
                      <span className={`block text-sm ${utilization > 0.5 ? 'text-negative' : 'text-muted'}`}>
                        Dùng {formatPercent(Math.max(0, utilization), 0)} hạn mức · tối thiểu {formatMoney(creditCardMinimumPayment(Math.max(0, balance), card.details.minPaymentRate))}
                      </span>
                    </span>
                    <Money value={balance} className="font-medium" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {dialog === 'loan' && <LoanDialog view={view} onClose={() => setDialog(null)} />}
      {dialog === 'card' && <CardDialog view={view} onClose={() => setDialog(null)} />}
    </section>
  )
}

function LoanDialog({ view, onClose }: { view: LedgerView; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [kind, setKind] = useState<'loan' | 'bnpl' | 'personal_debt'>('loan')
  const [mode, setMode] = useState<'new' | 'existing'>('existing')
  const [name, setName] = useState('')
  const [lender, setLender] = useState('')
  const [principal, setPrincipal] = useState('')
  const [current, setCurrent] = useState('')
  const [rateType, setRateType] = useState<LoanRateType>('equal_principal')
  const [rate, setRate] = useState('')
  const [months, setMonths] = useState('')
  const [startDate, setStartDate] = useState(today())
  const [paymentDay, setPaymentDay] = useState(Number(today().slice(8)) > 28 ? 28 : Number(today().slice(8)))
  const [feeRate, setFeeRate] = useState('0')
  const [disburseTo, setDisburseTo] = useState('')
  const interestCategory = view.categories.find((c) => c.systemKey === 'loan_interest')

  const p = parseMoneyInput(principal)
  const r = rateType === 'zero' ? 0 : parsePercentInput(rate, 60)
  const n = Number(months)
  const terms: LoanTerms | null =
    p && r !== null && Number.isInteger(n) && n >= 1 && n <= 420 && startDate
      ? { rateType, ratePeriods: [{ from: startDate, annualRate: r }], originalPrincipal: p, startDate, paymentDay, termMonths: n }
      : null
  const preview = terms ? buildSchedule(terms) : null

  return (
    <FormDialog
      title="Thêm khoản vay"
      onClose={onClose}
      onSubmit={async () => {
        if (!name.trim()) return 'Nhập tên khoản vay'
        if (!terms || !p) return 'Nhập đủ số tiền vay, lãi suất, số tháng (1–420)'
        if (!interestCategory) return 'Thiếu danh mục hệ thống "Lãi vay"'
        const fee = parsePercentInput(feeRate, 10)
        if (fee === null) return 'Phí trả trước hạn không hợp lệ (0–10%)'
        const balance = mode === 'existing' ? parseMoneyInput(current) : p
        if (!balance || balance > p) return 'Dư nợ hiện tại phải > 0 và không vượt số tiền vay ban đầu'
        if (mode === 'new' && !disburseTo) return 'Chọn tài khoản nhận tiền giải ngân'
        if (mode === 'new' && startDate > today()) return 'Ngày giải ngân không được ở tương lai'
        if (mode === 'new') {
          const to = view.accountById.get(disburseTo)!
          if (startDate < to.openingDate) return `Ngày giải ngân phải từ ${formatDate(to.openingDate)} (ngày bắt đầu theo dõi "${to.name}")`
        }
        await createLoan(
          getRepos(),
          {
            kind,
            name: name.trim(),
            mode,
            currentBalance: balance,
            asOf: today(),
            disbursementAccountId: mode === 'new' ? disburseTo : null,
            details: { ...terms, ratePeriods: [...terms.ratePeriods], lender: lender.trim() || null, prepaymentFeeRate: fee, interestCategoryId: interestCategory.id },
          },
          view.accounts.length,
        )
        await invalidate('accounts', 'transactions')
        toast({ message: `Đã thêm khoản vay "${name.trim()}"` })
        onClose()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Loại" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="loan">Vay ngân hàng / công ty tài chính</option>
          <option value="bnpl">Trả góp / mua trước trả sau</option>
          <option value="personal_debt">Vay người thân</option>
        </SelectField>
        <SelectField label="Tình trạng" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="existing">Đang trả (đã vay từ trước)</option>
          <option value="new">Vừa vay — ghi tiền giải ngân</option>
        </SelectField>
        <TextField label="Tên" placeholder="VD: Vay mua nhà" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Bên cho vay" value={lender} onChange={(e) => setLender(e.target.value)} />
        <MoneyField label="Số tiền vay ban đầu" value={principal} rawValue={principal} onChange={(e) => setPrincipal(e.target.value)} />
        {mode === 'existing' && <MoneyField label="Dư nợ hiện tại" value={current} rawValue={current} onChange={(e) => setCurrent(e.target.value)} />}
      </div>
      <SelectField label="Cách tính lãi" value={rateType} onChange={(e) => setRateType(e.target.value as LoanRateType)}>
        {RATE_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-2">
        {rateType !== 'zero' && <TextField label="Lãi suất (%/năm)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />}
        <TextField label="Tổng số tháng vay" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
        <TextField label="Ngày giải ngân" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <SelectField label="Ngày trả hằng tháng" value={paymentDay} onChange={(e) => setPaymentDay(Number(e.target.value))}>
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              Ngày {d}
            </option>
          ))}
        </SelectField>
        <TextField label="Phí trả trước hạn (%)" inputMode="decimal" value={feeRate} onChange={(e) => setFeeRate(e.target.value)} />
      </div>
      {mode === 'new' && (
        <SelectField label="Tiền giải ngân vào" value={disburseTo} onChange={(e) => setDisburseTo(e.target.value)}>
          <AccountOptions accounts={view.accounts} balances={view.balances} filter={(a) => a.class === 'asset'} />
        </SelectField>
      )}
      {preview && preview.length > 0 && (
        <div role="status" className="rounded-lg bg-canvas px-3 py-2 text-sm">
          <p>
            Kỳ đầu ({formatDate(preview[0]!.dueDate)}): <strong>{formatMoney(preview[0]!.payment)}</strong> (gốc {formatMoney(preview[0]!.principal)} + lãi {formatMoney(preview[0]!.interest)})
          </p>
          <p>
            Tổng lãi cả khoản vay: <strong>{formatMoney(totalInterest(preview))}</strong> · trả hết {formatDate(payoffDate(preview)!)}
          </p>
          {rateType === 'flat' && r !== null && r > 0 && (
            <p className="mt-1 font-medium text-warning">⚠ Lãi phẳng {formatPercent(r)} tương đương khoảng {formatPercent(flatRateApr(r, n), 1)}/năm lãi thực tế.</p>
          )}
        </div>
      )}
    </FormDialog>
  )
}

function CardDialog({ view, onClose }: { view: LedgerView; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [name, setName] = useState('')
  const [issuer, setIssuer] = useState('')
  const [limit, setLimit] = useState('')
  const [balance, setBalance] = useState('0')
  const [rate, setRate] = useState('30')
  const [minRate, setMinRate] = useState('5')
  const [statementDay, setStatementDay] = useState(20)
  const [dueDay, setDueDay] = useState(5)
  return (
    <FormDialog
      title="Thêm thẻ tín dụng"
      onClose={onClose}
      onSubmit={async () => {
        const l = parseMoneyInput(limit)
        const b = parseMoneyInput(balance)
        const r = parsePercentInput(rate, 60)
        const m = parsePercentInput(minRate, 100)
        if (!name.trim()) return 'Nhập tên thẻ'
        if (!l) return 'Nhập hạn mức'
        if (b === null || r === null || m === null) return 'Kiểm tra lại dư nợ / lãi suất / tỉ lệ tối thiểu'
        await createCreditCard(
          getRepos(),
          { name: name.trim(), balance: b, openingDate: today(), details: { issuer: issuer.trim() || null, creditLimit: l, statementDay, dueDay, annualRate: r, minPaymentRate: m } },
          view.accounts.length,
        )
        await invalidate('accounts')
        toast({ message: `Đã thêm thẻ "${name.trim()}"` })
        onClose()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Tên thẻ" placeholder="VD: Visa TPBank" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Ngân hàng phát hành" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
        <MoneyField label="Hạn mức" value={limit} rawValue={limit} onChange={(e) => setLimit(e.target.value)} />
        <MoneyField label="Dư nợ hiện tại" value={balance} rawValue={balance} onChange={(e) => setBalance(e.target.value)} />
        <TextField label="Lãi suất (%/năm)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        <TextField label="Thanh toán tối thiểu (% dư nợ)" inputMode="decimal" value={minRate} onChange={(e) => setMinRate(e.target.value)} />
        <SelectField label="Ngày sao kê" value={statementDay} onChange={(e) => setStatementDay(Number(e.target.value))}>
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              Ngày {d}
            </option>
          ))}
        </SelectField>
        <SelectField label="Hạn thanh toán" value={dueDay} onChange={(e) => setDueDay(Number(e.target.value))}>
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              Ngày {d}
            </option>
          ))}
        </SelectField>
      </div>
    </FormDialog>
  )
}
