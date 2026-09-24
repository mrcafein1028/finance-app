import { addMonthsToKey, dayOfMonth, monthOf } from './dates'
import { DomainError } from './errors'
import { allocateEvenly, D, round, sum } from './money'
import type { IsoDate, LoanDetails, LoanRateType, Money, MonthKey } from './types'

// Lịch trả nợ DỰ PHÓNG (docs/04 §6): lãi tháng i = r/12. Số thực trả do người dùng nhập theo sao kê.

export interface RatePeriod {
  from: IsoDate
  annualRate: number
}

export interface ScheduleRow {
  seq: number
  dueDate: IsoDate
  annualRate: number
  openingBalance: Money
  principal: Money
  interest: Money
  payment: Money
  closingBalance: Money
}

export interface LoanTerms {
  rateType: LoanRateType
  ratePeriods: readonly RatePeriod[]
  /** Gốc vay ban đầu — cơ sở tính lãi của khoản vay lãi phẳng. */
  originalPrincipal: Money
  startDate: IsoDate
  paymentDay: number
  termMonths: number
}

export interface ScheduleOptions {
  /** Dư nợ tại thời điểm lập lịch (mặc định = gốc ban đầu). */
  balance?: Money
  /** Kỳ đầu tiên của lịch (1 = kỳ đầu của khoản vay). */
  firstSeq?: number
  /** Số kỳ lập lịch (mặc định = số kỳ còn lại tới hết kỳ hạn). */
  periods?: number
  /** Giảm kỳ hạn: giữ nguyên khoản trả mỗi kỳ (annuity) — tính tới khi hết nợ. */
  fixedPayment?: Money
  /** Giảm kỳ hạn: giữ nguyên tiền gốc mỗi kỳ (gốc đều / phẳng / 0%) — tính tới khi hết nợ. */
  fixedPrincipal?: Money
}

export const loanTermsOf = (d: LoanDetails): LoanTerms => ({
  rateType: d.rateType,
  ratePeriods: d.ratePeriods,
  originalPrincipal: d.originalPrincipal,
  startDate: d.startDate,
  paymentDay: d.paymentDay,
  termMonths: d.termMonths,
})

/** Ngày đến hạn kỳ `seq`: ngày trả nợ của tháng thứ `seq` sau tháng giải ngân. */
export function dueDateOf(terms: Pick<LoanTerms, 'startDate' | 'paymentDay'>, seq: number): IsoDate {
  return dayOfMonth(addMonthsToKey(monthOf(terms.startDate), seq), terms.paymentDay)
}

/** Lãi suất áp dụng cho ngày đến hạn: mốc gần nhất có from ≤ ngày đó. */
export function rateAt(ratePeriods: readonly RatePeriod[], date: IsoDate): number {
  let rate = ratePeriods[0]?.annualRate ?? 0
  for (const p of ratePeriods) if (p.from <= date) rate = p.annualRate
  return rate
}

/** Khoản trả đều mỗi kỳ (niên kim): P·i / (1 − (1+i)^−n). */
export function annuityPayment(principal: Money, annualRate: number, periods: number): Money {
  if (periods <= 0) return principal
  if (annualRate === 0) return Math.ceil(principal / periods)
  const i = new D(annualRate).div(12)
  const factor = new D(1).minus(i.plus(1).pow(-periods))
  return round(new D(principal).times(i).div(factor))
}

/** Số kỳ đến hạn sau ngày `date` (kỳ còn phải trả). */
export function remainingPeriods(terms: LoanTerms, date: IsoDate): { firstSeq: number; periods: number } {
  let paid = 0
  while (paid < terms.termMonths && dueDateOf(terms, paid + 1) <= date) paid++
  return { firstSeq: paid + 1, periods: terms.termMonths - paid }
}

export function buildSchedule(terms: LoanTerms, options: ScheduleOptions = {}): ScheduleRow[] {
  const firstSeq = options.firstSeq ?? 1
  const periods = options.periods ?? terms.termMonths - firstSeq + 1
  let balance = options.balance ?? terms.originalPrincipal
  const openEnded = options.fixedPayment !== undefined || options.fixedPrincipal !== undefined
  if (balance <= 0) return []
  if (!openEnded && periods <= 0) throw new DomainError('no_periods', 'Khoản vay không còn kỳ trả nào')

  const evenPrincipal = terms.rateType === 'annuity' || openEnded ? [] : allocateEvenly(balance, periods)
  const rows: ScheduleRow[] = []
  let payment = 0
  let previousRate: number | null = null

  for (let j = 0; balance > 0; j++) {
    if (j >= 1200) throw new DomainError('never_paid_off', 'Khoản trả không đủ để trả hết nợ')
    const seq = firstSeq + j
    const dueDate = dueDateOf(terms, seq)
    const annualRate = terms.rateType === 'zero' ? 0 : rateAt(terms.ratePeriods, dueDate)
    const i = new D(annualRate).div(12)
    const isLastPlanned = !openEnded && j === periods - 1

    const interest =
      terms.rateType === 'zero' ? 0 : terms.rateType === 'flat' ? round(i.times(terms.originalPrincipal)) : round(i.times(balance))

    let principal: Money
    if (terms.rateType === 'annuity') {
      if (options.fixedPayment !== undefined) payment = options.fixedPayment
      else if (previousRate !== annualRate) payment = annuityPayment(balance, annualRate, periods - j) // đổi lãi → tính lại PMT
      principal = payment - interest
      if (principal <= 0) throw new DomainError('negative_amortization', 'Khoản trả không đủ trả lãi — dư nợ không giảm')
    } else if (options.fixedPrincipal !== undefined) {
      principal = options.fixedPrincipal
    } else {
      principal = evenPrincipal[j]!
    }
    // Kỳ cuối (hoặc kỳ trả hết) hấp thụ mọi phần lệch làm tròn.
    if (principal >= balance || isLastPlanned) principal = balance

    rows.push({
      seq,
      dueDate,
      annualRate,
      openingBalance: balance,
      principal,
      interest,
      payment: principal + interest,
      closingBalance: balance - principal,
    })
    balance -= principal
    previousRate = annualRate
  }
  return rows
}

/** Lịch còn lại từ dư nợ hiện tại tại ngày `asOf` (dùng cho khoản vay đang trả). */
export function scheduleFrom(terms: LoanTerms, outstanding: Money, asOf: IsoDate): ScheduleRow[] {
  const { firstSeq, periods } = remainingPeriods(terms, asOf)
  if (outstanding <= 0 || periods <= 0) return []
  return buildSchedule(terms, { balance: outstanding, firstSeq, periods })
}

export const totalInterest = (rows: readonly ScheduleRow[]) => sum(rows.map((r) => r.interest))
export const payoffDate = (rows: readonly ScheduleRow[]): IsoDate | null => rows.at(-1)?.dueDate ?? null

/** Khoản phải trả theo lịch trong tháng dương lịch `month` (dùng cho DTI). */
export const scheduledPaymentInMonth = (rows: readonly ScheduleRow[], month: MonthKey) =>
  sum(rows.filter((r) => monthOf(r.dueDate) === month).map((r) => r.payment))

export type PrepaymentMode = 'reduce_term' | 'reduce_payment'

export interface PrepaymentResult {
  fee: Money
  before: ScheduleRow[]
  after: ScheduleRow[]
  interestSaved: Money
  periodsSaved: number
}

/**
 * Trả trước `amount` vào ngày `asOf` (W12 bước 4). Giảm kỳ hạn: giữ khoản trả (annuity) hoặc tiền gốc
 * mỗi kỳ (các loại khác). Giảm khoản trả: giữ số kỳ, chia lại trên dư nợ mới.
 */
export function prepay(
  terms: LoanTerms,
  outstanding: Money,
  asOf: IsoDate,
  amount: Money,
  mode: PrepaymentMode,
  prepaymentFeeRate = 0,
): PrepaymentResult {
  if (amount <= 0 || amount > outstanding) {
    throw new DomainError('invalid_prepayment', 'Số trả trước phải lớn hơn 0 và không vượt dư nợ')
  }
  const before = scheduleFrom(terms, outstanding, asOf)
  const { firstSeq, periods } = remainingPeriods(terms, asOf)
  const rest = outstanding - amount
  let after: ScheduleRow[] = []
  if (rest > 0) {
    if (mode === 'reduce_payment') after = buildSchedule(terms, { balance: rest, firstSeq, periods })
    else if (terms.rateType === 'annuity') after = buildSchedule(terms, { balance: rest, firstSeq, fixedPayment: before[0]!.payment })
    else after = buildSchedule(terms, { balance: rest, firstSeq, fixedPrincipal: before[0]!.principal })
  }
  return {
    fee: round(new D(amount).times(prepaymentFeeRate)),
    before,
    after,
    interestSaved: totalInterest(before) - totalInterest(after),
    periodsSaved: before.length - after.length,
  }
}

/**
 * Lãi suất thực (APR danh nghĩa/năm) của khoản vay lãi phẳng: IRR của dòng tiền
 * nhận P, trả (P/n + P·r/12) mỗi tháng. VD phẳng 12%/12 tháng ≈ 21,46%.
 */
export function flatRateApr(annualFlatRate: number, months: number): number {
  const payment = 1 / months + annualFlatRate / 12
  const pv = (m: number) => (m === 0 ? payment * months : (payment * (1 - Math.pow(1 + m, -months))) / m)
  let lo = 0
  let hi = 1
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2
    if (pv(mid) > 1) lo = mid
    else hi = mid
  }
  return ((lo + hi) / 2) * 12
}

// ---------- thẻ tín dụng ----------

/** Tối thiểu phải trả = dư nợ sao kê × tỉ lệ tối thiểu. */
export const creditCardMinimumPayment = (statementBalance: Money, minPaymentRate: number) =>
  round(new D(statementBalance).times(minPaymentRate))

/**
 * Số tháng để trả hết dư nợ `balance` với khoản trả cố định `payment`:
 * n = −ln(1 − B·i/A) / ln(1 + i), làm tròn lên. null nếu khoản trả ≤ lãi tháng (không bao giờ hết nợ).
 */
export function creditCardMonthsToPayoff(balance: Money, annualRate: number, payment: Money): number | null {
  if (balance <= 0) return 0
  if (payment <= 0) return null
  if (annualRate === 0) return Math.ceil(balance / payment)
  // So sánh chính xác bằng Decimal: trả đúng bằng tiền lãi tháng cũng là "không bao giờ hết nợ".
  const monthlyInterest = new D(balance).times(annualRate).div(12)
  if (new D(payment).lte(monthlyInterest)) return null
  const i = annualRate / 12
  return Math.ceil(-Math.log(1 - monthlyInterest.toNumber() / payment) / Math.log(1 + i) - 1e-9)
}
