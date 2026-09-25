import { useState } from 'react'
import { FormDialog } from '../../components/ui/FormDialog'
import { FormAlert, MoneyField, SelectField, TextField } from '../../components/ui/form'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, type LedgerView } from '../../data/queries'
import { today } from '../../lib/clock'
import { formatMoney, parseMoneyInput, parsePercentInput } from '../../lib/format'
import type { AccountOf, LoanRateType } from '../../schemas'
import { disbursementOf, updateCreditCard, updateLoan } from '../../services/accountEdit'
import type { LoanAccount } from '../../services/liabilities'
import { LOAN_KINDS, percentText, RATE_TYPES } from './labels'

const days = Array.from({ length: 28 }, (_, i) => i + 1)

function DaySelect({ label, value, onChange }: { label: string; value: number; onChange: (d: number) => void }) {
  return (
    <SelectField label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {days.map((d) => (
        <option key={d} value={d}>
          Ngày {d}
        </option>
      ))}
    </SelectField>
  )
}

export function EditLoanDialog({ loan, view, onClose }: { loan: LoanAccount; view: LedgerView; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const d = loan.details
  const disbursement = disbursementOf(loan, view.transactions)
  const [kind, setKind] = useState<LoanAccount['kind']>(loan.kind)
  const [name, setName] = useState(loan.name)
  const [lender, setLender] = useState(d.lender ?? '')
  const [principal, setPrincipal] = useState(String(d.originalPrincipal))
  const [opening, setOpening] = useState(String(loan.openingBalance))
  const [openingDate, setOpeningDate] = useState(loan.openingDate)
  const [rateType, setRateType] = useState<LoanRateType>(d.rateType)
  const [rate, setRate] = useState(percentText(d.ratePeriods[0]!.annualRate))
  const [months, setMonths] = useState(String(d.termMonths))
  const [startDate, setStartDate] = useState(d.startDate)
  const [paymentDay, setPaymentDay] = useState(d.paymentDay)
  const [fee, setFee] = useState(percentText(d.prepaymentFeeRate))
  const laterRates = d.ratePeriods.length - 1

  return (
    <FormDialog
      title="Sửa khoản vay"
      onClose={onClose}
      onSubmit={async () => {
        const p = parseMoneyInput(principal)
        const o = parseMoneyInput(opening)
        const r = rateType === 'zero' ? 0 : parsePercentInput(rate, 60)
        const f = parsePercentInput(fee, 10)
        const n = Number(months)
        if (!name.trim()) return 'Nhập tên khoản vay'
        if (!p) return 'Nhập số tiền vay ban đầu'
        if (r === null) return 'Lãi suất không hợp lệ (0–60%)'
        if (f === null) return 'Phí trả trước hạn không hợp lệ (0–10%)'
        if (!Number.isInteger(n) || n < 1 || n > 420) return 'Số tháng vay từ 1 đến 420'
        if (!disbursement && (o === null || o <= 0)) return 'Nhập dư nợ lúc bắt đầu theo dõi'
        if (!disbursement && openingDate > today()) return 'Ngày bắt đầu theo dõi không được ở tương lai'
        await updateLoan(
          getRepos(),
          loan,
          { kind, name: name.trim(), lender: lender.trim() || null, originalPrincipal: p, openingBalance: o ?? 0, openingDate, rateType, annualRate: r, termMonths: n, startDate, paymentDay, prepaymentFeeRate: f },
          view.transactions,
        )
        await invalidate('accounts', 'transactions', 'snapshots')
        toast({ message: `Đã lưu "${name.trim()}"` })
        onClose()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Loại" value={kind} onChange={(e) => setKind(e.target.value as LoanAccount['kind'])}>
          {LOAN_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </SelectField>
        <TextField label="Tên" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Bên cho vay" value={lender} onChange={(e) => setLender(e.target.value)} />
        <MoneyField label="Số tiền vay ban đầu" value={principal} rawValue={principal} onChange={(e) => setPrincipal(e.target.value)} />
        {!disbursement && (
          <>
            <MoneyField label="Dư nợ lúc bắt đầu theo dõi" value={opening} rawValue={opening} onChange={(e) => setOpening(e.target.value)} hint="Số còn nợ vào ngày bên cạnh — các lần trả sau đó được trừ dần" />
            <TextField label="Ngày bắt đầu theo dõi" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
          </>
        )}
      </div>
      {disbursement && (
        <FormAlert tone="warning">
          Khoản vay này được ghi lúc vừa giải ngân ({formatMoney(disbursement.amount)} vào “{view.accountById.get(disbursement.toAccountId ?? '')?.name}”). Sửa số tiền vay hoặc ngày giải ngân sẽ sửa luôn giao dịch giải ngân đó.
        </FormAlert>
      )}
      <SelectField label="Cách tính lãi" value={rateType} onChange={(e) => setRateType(e.target.value as LoanRateType)}>
        {RATE_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-2">
        {rateType !== 'zero' && (
          <TextField
            label="Lãi suất lúc giải ngân (%/năm)"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            hint={laterRates > 0 ? `Giữ nguyên ${laterRates} lần đổi lãi suất sau đó (sửa bằng “Đổi lãi suất”)` : undefined}
          />
        )}
        <TextField label="Tổng số tháng vay" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
        <TextField label="Ngày giải ngân" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <DaySelect label="Ngày trả hằng tháng" value={paymentDay} onChange={setPaymentDay} />
        <TextField label="Phí trả trước hạn (%)" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
      </div>
    </FormDialog>
  )
}

export function EditCardDialog({ card, view, onClose }: { card: AccountOf<'credit_card'>; view: LedgerView; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const d = card.details
  const [name, setName] = useState(card.name)
  const [issuer, setIssuer] = useState(d.issuer ?? '')
  const [limit, setLimit] = useState(String(d.creditLimit))
  const [opening, setOpening] = useState(String(card.openingBalance))
  const [openingDate, setOpeningDate] = useState(card.openingDate)
  const [rate, setRate] = useState(percentText(d.annualRate))
  const [minRate, setMinRate] = useState(percentText(d.minPaymentRate))
  const [statementDay, setStatementDay] = useState(d.statementDay)
  const [dueDay, setDueDay] = useState(d.dueDay)

  return (
    <FormDialog
      title="Sửa thẻ tín dụng"
      onClose={onClose}
      onSubmit={async () => {
        const l = parseMoneyInput(limit)
        const o = parseMoneyInput(opening)
        const r = parsePercentInput(rate, 60)
        const m = parsePercentInput(minRate, 100)
        if (!name.trim()) return 'Nhập tên thẻ'
        if (!l) return 'Nhập hạn mức'
        if (o === null) return 'Nhập dư nợ lúc bắt đầu theo dõi (0 nếu không nợ)'
        if (r === null || m === null) return 'Kiểm tra lại lãi suất / tỉ lệ tối thiểu'
        if (openingDate > today()) return 'Ngày bắt đầu theo dõi không được ở tương lai'
        await updateCreditCard(
          getRepos(),
          card,
          { name: name.trim(), openingBalance: o, openingDate, details: { issuer: issuer.trim() || null, creditLimit: l, statementDay, dueDay, annualRate: r, minPaymentRate: m } },
          view.transactions,
        )
        await invalidate('accounts', 'snapshots')
        toast({ message: `Đã lưu "${name.trim()}"` })
        onClose()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Tên thẻ" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Ngân hàng phát hành" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
        <MoneyField label="Hạn mức" value={limit} rawValue={limit} onChange={(e) => setLimit(e.target.value)} />
        <MoneyField label="Dư nợ lúc bắt đầu theo dõi" value={opening} rawValue={opening} onChange={(e) => setOpening(e.target.value)} hint="Không phải dư nợ hôm nay — dư nợ hôm nay = số này + chi tiêu − thanh toán sau đó" />
        <TextField label="Ngày bắt đầu theo dõi" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
        <TextField label="Lãi suất (%/năm)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        <TextField label="Thanh toán tối thiểu (% dư nợ)" inputMode="decimal" value={minRate} onChange={(e) => setMinRate(e.target.value)} />
        <DaySelect label="Ngày sao kê" value={statementDay} onChange={setStatementDay} />
        <DaySelect label="Hạn thanh toán" value={dueDay} onChange={setDueDay} />
      </div>
    </FormDialog>
  )
}
