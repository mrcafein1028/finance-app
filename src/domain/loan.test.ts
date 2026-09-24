import { describe, expect, it } from 'vitest'
import { hung } from '../test/personas'
import { DomainError } from './errors'
import {
  annuityPayment,
  buildSchedule,
  creditCardMinimumPayment,
  creditCardMonthsToPayoff,
  dueDateOf,
  flatRateApr,
  loanTermsOf,
  payoffDate,
  prepay,
  scheduleFrom,
  scheduledPaymentInMonth,
  totalInterest,
  type LoanTerms,
} from './loan'
import { sum } from './money'

const terms = (over: Partial<LoanTerms> = {}): LoanTerms => ({
  rateType: 'annuity',
  ratePeriods: [{ from: '2026-01-01', annualRate: 0.1 }],
  originalPrincipal: 500_000_000,
  startDate: '2026-01-01',
  paymentDay: 10,
  termMonths: 240,
  ...over,
})

describe('trả đều (annuity) — docs/04 §6', () => {
  it('500 tr, 10%/năm, 240 tháng → PMT ≈ 4.825.108 ₫', () => {
    expect(annuityPayment(500_000_000, 0.1, 240)).toBe(4_825_108)
    const rows = buildSchedule(terms())
    expect(rows).toHaveLength(240)
    expect(rows[0]!.payment).toBe(4_825_108)
    expect(rows[0]!.interest).toBe(4_166_667)
    expect(sum(rows.map((r) => r.principal))).toBe(500_000_000)
    expect(rows.at(-1)!.closingBalance).toBe(0)
  })

  it('đổi lãi suất giữa chừng → tính lại PMT trên dư nợ và số kỳ còn lại', () => {
    const rows = buildSchedule(terms({ ratePeriods: [{ from: '2026-01-01', annualRate: 0.08 }, { from: '2027-01-10', annualRate: 0.12 }] }))
    const changeAt = rows.findIndex((r) => r.annualRate === 0.12)
    expect(rows[changeAt]!.dueDate).toBe('2027-01-10')
    expect(rows[changeAt]!.payment).toBe(annuityPayment(rows[changeAt]!.openingBalance, 0.12, 240 - changeAt))
    expect(rows.at(-1)!.closingBalance).toBe(0)
  })
})

describe('gốc đều — P2 Hùng (docs/08 §3)', () => {
  const { loanDetails } = hung()
  const t = loanTermsOf(loanDetails)

  it('kỳ 1: gốc 5 tr + lãi 9 tr = 14 tr; kỳ 240: 5.037.500; Σ gốc = 1,2 tỷ', () => {
    const rows = buildSchedule(t)
    expect(rows[0]).toMatchObject({ seq: 1, dueDate: '2026-09-10', principal: 5_000_000, interest: 9_000_000, payment: 14_000_000 })
    expect(rows[239]).toMatchObject({ seq: 240, interest: 37_500, payment: 5_037_500, closingBalance: 0 })
    expect(sum(rows.map((r) => r.principal))).toBe(1_200_000_000)
    expect(payoffDate(rows)).toBe('2046-08-10')
    expect(scheduledPaymentInMonth(rows, '2026-09')).toBe(14_000_000)
  })

  it('hết ưu đãi: 11% từ kỳ 13 → lãi kỳ 13 = dư nợ đầu kỳ × 11%/12 = 10.450.000', () => {
    const rows = buildSchedule({ ...t, ratePeriods: [...t.ratePeriods, { from: dueDateOf(t, 13), annualRate: 0.11 }] })
    expect(rows[11]!.interest).toBe(round9(1_145_000_000))
    expect(rows[12]).toMatchObject({ seq: 13, openingBalance: 1_140_000_000, interest: 10_450_000, annualRate: 0.11 })
  })

  it('lịch còn lại của khoản vay đang trả, tính từ dư nợ hiện tại', () => {
    const rows = scheduleFrom(t, 1_195_000_000, '2026-09-10')
    expect(rows[0]).toMatchObject({ seq: 2, dueDate: '2026-10-10', principal: 5_000_000, interest: 8_962_500 })
    expect(rows).toHaveLength(239)
  })

  it('trả trước 100 tr, giảm kỳ hạn: phí 1 tr, bớt 20 kỳ, tiết kiệm lãi > 0', () => {
    const r = prepay(t, 1_195_000_000, '2026-09-10', 100_000_000, 'reduce_term', 0.01)
    expect(r.fee).toBe(1_000_000)
    expect(r.periodsSaved).toBe(20)
    expect(r.after[0]!.principal).toBe(5_000_000)
    expect(r.interestSaved).toBeGreaterThan(0)
    expect(sum(r.after.map((x) => x.principal))).toBe(1_095_000_000)
  })

  it('trả trước, giảm khoản trả: giữ số kỳ, gốc mỗi kỳ nhỏ hơn', () => {
    const r = prepay(t, 1_195_000_000, '2026-09-10', 100_000_000, 'reduce_payment')
    expect(r.periodsSaved).toBe(0)
    expect(r.after[0]!.principal).toBeLessThan(5_000_000)
    expect(r.interestSaved).toBeGreaterThan(0)
  })

  it('trả trước quá dư nợ → lỗi', () => {
    expect(() => prepay(t, 1_000, '2026-09-10', 2_000, 'reduce_term')).toThrow(DomainError)
  })
})

const round9 = (balance: number) => Math.round((balance * 0.09) / 12)

describe('lãi phẳng & 0%', () => {
  it('phẳng 12%/năm, 12 tháng ≈ 21,5%/năm thực tế', () => {
    expect(flatRateApr(0.12, 12)).toBeCloseTo(0.2146, 3)
  })

  it('lãi phẳng tính trên gốc ban đầu, mỗi kỳ bằng nhau', () => {
    const rows = buildSchedule(terms({ rateType: 'flat', originalPrincipal: 12_000_000, termMonths: 12, ratePeriods: [{ from: '2026-01-01', annualRate: 0.12 }] }))
    expect(new Set(rows.map((r) => r.payment))).toEqual(new Set([1_120_000]))
    expect(totalInterest(rows)).toBe(1_440_000)
  })

  it('trả góp 0%: chỉ có gốc, chia không lệch', () => {
    const rows = buildSchedule(terms({ rateType: 'zero', originalPrincipal: 10_000_000, termMonths: 3, ratePeriods: [{ from: '2026-01-01', annualRate: 0 }] }))
    expect(rows.map((r) => r.payment)).toEqual([3_333_334, 3_333_333, 3_333_333])
  })
})

describe('thẻ tín dụng — P3 Mai (docs/08 §4)', () => {
  it('20 tr, 30%/năm, trả 1 tr/tháng → 29 tháng (n ≈ 28,07)', () => {
    expect(creditCardMonthsToPayoff(20_000_000, 0.3, 1_000_000)).toBe(29)
  })

  it('trả 400k < lãi 500k/tháng → không bao giờ trả hết', () => {
    expect(creditCardMonthsToPayoff(20_000_000, 0.3, 400_000)).toBeNull()
    expect(creditCardMonthsToPayoff(20_000_000, 0.3, 500_000)).toBeNull()
  })

  it('tối thiểu 5% dư nợ sao kê', () => {
    expect(creditCardMinimumPayment(20_000_000, 0.05)).toBe(1_000_000)
    expect(creditCardMonthsToPayoff(0, 0.3, 1)).toBe(0)
  })
})
