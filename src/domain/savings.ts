import { addMonths, diffDays, maxDate } from './dates'
import { D, round } from './money'
import type { DepositTerm, IsoDate, Money, TermDepositDetails } from './types'

const DAY_BASIS = 365

type TermCore = Pick<DepositTerm, 'principal' | 'annualRate' | 'startDate' | 'maturityDate'>

/** Lãi đơn theo ngày thực / 365 (cách các ngân hàng Việt Nam tính). */
export function simpleInterest(principal: Money, annualRate: number, days: number): Money {
  if (days <= 0) return 0
  return round(new D(principal).times(annualRate).times(days).div(DAY_BASIS))
}

/** Ngày đáo hạn: 31/01 + 1 tháng = 28/02 (docs/04 §5). */
export const maturityDateOf = (startDate: IsoDate, termMonths: number) => addMonths(startDate, termMonths)

export const termDays = (term: Pick<DepositTerm, 'startDate' | 'maturityDate'>) => diffDays(term.startDate, term.maturityDate)

/** Tổng lãi của cả kỳ nếu giữ đến đáo hạn. */
export const termInterest = (term: TermCore) => simpleInterest(term.principal, term.annualRate, termDays(term))

/** Lãi đã dồn tích tới cuối ngày `date` (không vượt quá lãi cả kỳ). */
export function accruedInterest(term: TermCore, date: IsoDate): Money {
  const elapsed = Math.min(Math.max(diffDays(term.startDate, date), 0), termDays(term))
  return simpleInterest(term.principal, term.annualRate, elapsed)
}

/** Rút trước hạn: chỉ hưởng lãi không kỳ hạn trên số ngày đã gửi. */
export function earlyWithdrawalInterest(term: Pick<DepositTerm, 'principal' | 'startDate'>, earlyRate: number, date: IsoDate): Money {
  return simpleInterest(term.principal, earlyRate, Math.max(diffDays(term.startDate, date), 0))
}

export interface InterestPayment {
  date: IsoDate
  amount: Money
}

/** Lịch trả lãi hàng tháng: mỗi tháng một khoản theo đúng số ngày của tháng đó. */
export function monthlyPayouts(term: TermCore): InterestPayment[] {
  const payments: InterestPayment[] = []
  let from = term.startDate
  for (let k = 1; from < term.maturityDate; k++) {
    const to = addMonths(term.startDate, k) < term.maturityDate ? addMonths(term.startDate, k) : term.maturityDate
    payments.push({ date: to, amount: simpleInterest(term.principal, term.annualRate, diffDays(from, to)) })
    from = to
  }
  return payments
}

/**
 * Lãi đã phát sinh nhưng CHƯA được trả tới ngày `date` — phần cộng thêm vào giá trị sổ khi tính net worth.
 * Cuối kỳ: toàn bộ lãi dồn tích. Hàng tháng: phần từ lần trả gần nhất. Trả trước: 0 (đã nhận).
 */
export function unpaidAccruedInterest(term: TermCore, payout: TermDepositDetails['interestPayout'], date: IsoDate): Money {
  if (date < term.startDate) return 0
  switch (payout) {
    case 'at_maturity':
      return accruedInterest(term, date)
    case 'upfront':
      return 0
    case 'monthly': {
      const paid = monthlyPayouts(term).filter((p) => p.date <= date)
      const lastPaid = paid.length ? paid[paid.length - 1]!.date : term.startDate
      const until = date < term.maturityDate ? date : term.maturityDate
      return simpleInterest(term.principal, term.annualRate, diffDays(lastPaid, maxDate(lastPaid, until)))
    }
  }
}

/** Kỳ gửi còn hiệu lực tại ngày `date`: đã bắt đầu và chưa đóng trước ngày đó. */
export function termActiveAt(terms: readonly DepositTerm[], date: IsoDate): DepositTerm | undefined {
  return terms.find((t) => t.startDate <= date && (t.closedAt === null || t.closedAt > date))
}

export interface MaturityPlan {
  interest: Money
  /** Tiền chuyển về TK nhận (payoutAccountId). */
  payoutAmount: Money
  /** Kỳ mới nếu tái tục; null nếu tất toán. */
  nextTerm: Pick<DepositTerm, 'principal' | 'annualRate' | 'termMonths' | 'startDate' | 'maturityDate'> | null
}

/**
 * Kế hoạch xử lý khi sổ đáo hạn (docs/04 §5, W9). `actualInterest` là số người dùng xác nhận theo
 * ngân hàng (mặc định = lãi tính toán); `nextRate` là lãi suất kỳ mới.
 */
export function planMaturity(
  term: DepositTerm,
  action: TermDepositDetails['maturityAction'],
  options: { actualInterest?: Money; nextRate?: number; nextTermMonths?: number } = {},
): MaturityPlan {
  const interest = options.actualInterest ?? termInterest(term)
  if (action === 'withdraw') return { interest, payoutAmount: term.principal + interest, nextTerm: null }

  const principal = action === 'renew_with_interest' ? term.principal + interest : term.principal
  const termMonths = options.nextTermMonths ?? term.termMonths
  return {
    interest,
    payoutAmount: action === 'renew_with_interest' ? 0 : interest,
    nextTerm: {
      principal,
      annualRate: options.nextRate ?? term.annualRate,
      termMonths,
      startDate: term.maturityDate,
      maturityDate: maturityDateOf(term.maturityDate, termMonths),
    },
  }
}
