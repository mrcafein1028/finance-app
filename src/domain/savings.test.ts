import { describe, expect, it } from 'vitest'
import { hung } from '../test/personas'
import { sum } from './money'
import {
  accruedInterest,
  earlyWithdrawalInterest,
  maturityDateOf,
  monthlyPayouts,
  planMaturity,
  termActiveAt,
  termDays,
  termInterest,
  unpaidAccruedInterest,
} from './savings'

const { term1 } = hung() // 100.000.000 ₫, 5,5%, 6 tháng từ 01/03/2026

describe('tiết kiệm có kỳ hạn — ví dụ docs/04 §5 và P2', () => {
  it('đáo hạn 01/09/2026 sau 184 ngày, lãi 2.772.603 ₫', () => {
    expect(maturityDateOf('2026-03-01', 6)).toBe('2026-09-01')
    expect(termDays(term1)).toBe(184)
    expect(termInterest(term1)).toBe(2_772_603)
  })

  it('lãi dồn tích tới 01/06 = 1.386.301 ₫ và không vượt lãi cả kỳ', () => {
    expect(accruedInterest(term1, '2026-06-01')).toBe(1_386_301)
    expect(accruedInterest(term1, '2026-02-01')).toBe(0)
    expect(accruedInterest(term1, '2027-01-01')).toBe(2_772_603)
  })

  it('rút trước hạn 01/06 với 0,1%/năm → 25.205 ₫', () => {
    expect(earlyWithdrawalInterest(term1, 0.001, '2026-06-01')).toBe(25_205)
  })

  it('đáo hạn 31/01 + 1 tháng = 28/02', () => {
    expect(maturityDateOf('2026-01-31', 1)).toBe('2026-02-28')
  })

  it('trả lãi hàng tháng: 6 khoản, mỗi khoản theo số ngày thực của tháng', () => {
    const payouts = monthlyPayouts(term1)
    expect(payouts.map((p) => p.date)).toEqual(['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'])
    expect(payouts[0]!.amount).toBe(467_123) // 31 ngày tháng 3
    expect(payouts[1]!.amount).toBe(452_055) // 30 ngày tháng 4
    expect(Math.abs(sum(payouts.map((p) => p.amount)) - termInterest(term1))).toBeLessThanOrEqual(payouts.length)
  })

  it('lãi chưa nhận theo hình thức trả lãi', () => {
    expect(unpaidAccruedInterest(term1, 'at_maturity', '2026-06-01')).toBe(1_386_301)
    expect(unpaidAccruedInterest(term1, 'upfront', '2026-06-01')).toBe(0)
    // Hàng tháng: đã nhận tới 01/06, ngày 11/06 mới dồn thêm 10 ngày.
    expect(unpaidAccruedInterest(term1, 'monthly', '2026-06-01')).toBe(0)
    expect(unpaidAccruedInterest(term1, 'monthly', '2026-06-11')).toBe(150_685)
  })

  it('kỳ đang hiệu lực theo ngày', () => {
    const closed = { ...term1, status: 'matured' as const, closedAt: '2026-09-01' }
    const next = { ...term1, id: 'term-2', seq: 2, startDate: '2026-09-01', maturityDate: '2027-03-01' }
    expect(termActiveAt([closed, next], '2026-08-31')?.seq).toBe(1)
    expect(termActiveAt([closed, next], '2026-09-01')?.seq).toBe(2)
    expect(termActiveAt([closed, next], '2026-02-01')).toBeUndefined()
  })
})

describe('kế hoạch khi đáo hạn (W9)', () => {
  it('tái tục gốc: lãi về TK nhận, kỳ mới cùng gốc từ ngày đáo hạn', () => {
    const plan = planMaturity(term1, 'renew_principal', { nextRate: 0.05 })
    expect(plan.interest).toBe(2_772_603)
    expect(plan.payoutAmount).toBe(2_772_603)
    expect(plan.nextTerm).toEqual({ principal: 100_000_000, annualRate: 0.05, termMonths: 6, startDate: '2026-09-01', maturityDate: '2027-03-01' })
  })

  it('tái tục cả gốc lẫn lãi; tất toán trả về gốc + lãi', () => {
    expect(planMaturity(term1, 'renew_with_interest').nextTerm?.principal).toBe(102_772_603)
    expect(planMaturity(term1, 'renew_with_interest').payoutAmount).toBe(0)
    expect(planMaturity(term1, 'withdraw')).toEqual({ interest: 2_772_603, payoutAmount: 102_772_603, nextTerm: null })
    expect(planMaturity(term1, 'withdraw', { actualInterest: 2_770_000 }).payoutAmount).toBe(102_770_000)
  })
})
