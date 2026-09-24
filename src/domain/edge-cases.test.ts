// Nhánh lỗi và trường hợp biên — đảm bảo dữ liệu bất thường luôn cho kết quả rõ ràng thay vì sai lặng lẽ.
import { describe, expect, it } from 'vitest'
import { expense, makeAccount, transfer } from '../test/personas'
import { transactionEffect, ledgerBalance } from './balance'
import { bucketOf, summarizeBudgetMonth } from './budget'
import { maxDate, minDate } from './dates'
import { goalProgress, monthlyContributionToGoal } from './goals'
import { DomainError } from './errors'
import { sortTrades } from './investment'
import {
  annuityPayment,
  buildSchedule,
  creditCardMonthsToPayoff,
  prepay,
  scheduleFrom,
  type LoanTerms,
} from './loan'
import { allocate, allocateEvenly } from './money'
import { nextMonth, periodRange, previousMonth } from './period'

const annuity: LoanTerms = {
  rateType: 'annuity',
  ratePeriods: [{ from: '2026-01-01', annualRate: 0.12 }],
  originalPrincipal: 12_000_000,
  startDate: '2026-01-01',
  paymentDay: 10,
  termMonths: 12,
}

describe('money & ngày', () => {
  it('từ chối dữ liệu không hợp lệ', () => {
    expect(() => allocate(1.5, [1])).toThrow(DomainError)
    expect(() => allocate(100, [0, 0])).toThrow(DomainError)
    expect(() => allocateEvenly(100, 0)).toThrow(DomainError)
    expect(allocate(100, [])).toEqual([])
  })

  it('tháng trước/sau, min/max ngày', () => {
    expect(previousMonth('2026-01')).toBe('2025-12')
    expect(nextMonth('2026-12')).toBe('2027-01')
    expect(minDate('2026-01-02', '2026-01-01')).toBe('2026-01-01')
    expect(maxDate('2026-01-02', '2026-01-01')).toBe('2026-01-02')
  })
})

describe('số dư', () => {
  it('giao dịch không chạm tới account → không ảnh hưởng', () => {
    expect(transactionEffect(transfer('2026-08-01', 1, 'a', 'b'), 'c', 'asset')).toBe(0)
    expect(transactionEffect(expense('2026-08-01', 1, 'a', 'x'), 'c', 'asset')).toBe(0)
  })

  it('trước ngày mở account số dư là 0', () => {
    const acc = makeAccount('bank', 'a', 'A', 1_000, '2026-08-01')
    expect(ledgerBalance(acc, [], '2026-07-31')).toBe(0)
  })
})

describe('khoản vay — nhánh biên', () => {
  it('annuity 0% và 0 kỳ', () => {
    expect(annuityPayment(10_000_000, 0, 3)).toBe(3_333_334)
    expect(annuityPayment(10_000_000, 0.1, 0)).toBe(10_000_000)
  })

  it('giảm kỳ hạn khi trả đều: giữ khoản trả, bớt kỳ', () => {
    const r = prepay(annuity, 12_000_000, '2026-01-01', 6_000_000, 'reduce_term')
    expect(r.after[0]!.payment).toBe(r.before[0]!.payment)
    expect(r.periodsSaved).toBeGreaterThan(0)
    expect(r.after.at(-1)!.closingBalance).toBe(0)
  })

  it('trả trước toàn bộ → không còn lịch', () => {
    const r = prepay(annuity, 12_000_000, '2026-01-01', 12_000_000, 'reduce_payment')
    expect(r.after).toEqual([])
    expect(r.interestSaved).toBe(r.before.reduce((s, x) => s + x.interest, 0))
  })

  it('khoản trả không đủ trả lãi → báo lỗi thay vì lặp vô hạn', () => {
    expect(() => buildSchedule(annuity, { fixedPayment: 100_000 })).toThrow(DomainError)
    expect(() => buildSchedule({ ...annuity, rateType: 'zero' }, { fixedPrincipal: 1 })).toThrow(DomainError) // quá 1200 kỳ
  })

  it('hết kỳ hoặc hết nợ → lịch rỗng / lỗi rõ ràng', () => {
    expect(buildSchedule(annuity, { balance: 0 })).toEqual([])
    expect(() => buildSchedule(annuity, { firstSeq: 13 })).toThrow(DomainError)
    expect(scheduleFrom(annuity, 5_000_000, '2030-01-01')).toEqual([])
  })

  it('thẻ: 0% lãi, khoản trả 0', () => {
    expect(creditCardMonthsToPayoff(10_000_000, 0, 3_000_000)).toBe(4)
    expect(creditCardMonthsToPayoff(10_000_000, 0.3, 0)).toBeNull()
  })
})

describe('ngân sách — nhánh biên', () => {
  it('danh mục không tồn tại / con không gắn nhóm → tính là "Mong muốn" hoặc theo cha', () => {
    const parent = { id: 'p', bucket: 'needs', parentId: null }
    const child = { id: 'c', bucket: null, parentId: 'p' }
    const orphan = { id: 'o', bucket: null, parentId: null }
    const byId = new Map([parent, child, orphan].map((c) => [c.id, c])) as never
    expect(bucketOf('c', byId)).toBe('needs')
    expect(bucketOf('o', byId)).toBe('wants')
    expect(bucketOf('khong-co', byId)).toBe('wants')
  })

  it('dòng ngân sách 0 đồng mà có chi → vượt; chưa có tháng ngân sách → thu nhập dự kiến 0', () => {
    const s = summarizeBudgetMonth({
      range: periodRange('2026-08'),
      budgetMonth: null,
      lines: [
        {
          id: 'l', month: '2026-08', target: { kind: 'category', categoryId: 'x' }, targetKey: 'c:x', planned: 0, rollover: false,
          createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
        },
      ],
      categories: [],
      accounts: [],
      transactions: [expense('2026-08-02', 50_000, 'a', 'x')],
      today: '2026-08-31',
    })
    expect(s.expectedIncome).toBe(0)
    expect(s.lines[0]).toMatchObject({ status: 'over', usage: null, pace: 0 })
  })
})

describe('đầu tư — thứ tự lệnh', () => {
  it('cùng ngày: theo thời điểm nhập rồi theo id', () => {
    const base = { holdingId: 'h', side: 'buy' as const, quantity: '1', price: 1, fee: 0, tax: 0, cashAccountId: 'a', isOpening: false, groupId: null, updatedAt: '' }
    const trades = [
      { ...base, id: 'b', date: '2026-08-01', createdAt: '2026-08-01T10:00:00Z' },
      { ...base, id: 'a', date: '2026-08-01', createdAt: '2026-08-01T10:00:00Z' },
      { ...base, id: 'c', date: '2026-08-01', createdAt: '2026-08-01T09:00:00Z' },
    ]
    expect(sortTrades(trades).map((t) => t.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('quỹ mục tiêu (W8)', () => {
  it('tiến độ % kẹp 0–100 và số cần góp mỗi tháng', () => {
    expect(goalProgress(13_000_000, 60_000_000)).toBe(22)
    expect(goalProgress(70_000_000, 60_000_000)).toBe(100)
    expect(goalProgress(-1, 60_000_000)).toBe(0)
    expect(goalProgress(1, 0)).toBe(0)
    // Còn 47 tr, hạn 12 tháng nữa → ~3,92 tr/tháng
    expect(monthlyContributionToGoal(13_000_000, 60_000_000, '2027-08-31', '2026-08-31')).toBe(3_916_667)
    expect(monthlyContributionToGoal(13_000_000, 60_000_000, null, '2026-08-31')).toBeNull()
    expect(monthlyContributionToGoal(60_000_000, 60_000_000, '2027-08-31', '2026-08-31')).toBeNull()
  })
})
