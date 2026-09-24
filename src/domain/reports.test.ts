import { describe, expect, it } from 'vitest'
import { hung, lan } from '../test/personas'
import { loanTermsOf } from './loan'
import { createLedger } from './networth'
import { periodRange } from './period'
import { cashflowSeries, dailySpending, monthsBetween, movingAverage, netWorthSeries, recentMonths, spendingByTopCategory } from './reports'
import { projectNetWorth, type ProjectionInput } from './whatif'

const p1 = lan()

describe('dữ liệu báo cáo — P1 Lan', () => {
  it('kỳ gần nhất & khoảng kỳ', () => {
    expect(recentMonths('2026-09-15', 3, 1)).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(monthsBetween('2026-08-01', '2026-10-02', 1)).toEqual(['2026-08', '2026-09', '2026-10'])
  })

  it('R1: net worth cuối tháng 8 = 43.250.000, nợ vẽ âm', () => {
    const ledger = createLedger({ accounts: p1.accounts, transactions: p1.transactions })
    const [aug] = netWorthSeries(ledger, ['2026-08'], 1, '2026-09-10')
    expect(aug).toEqual({ month: '2026-08', date: '2026-08-31', assets: 43_250_000, liabilities: -0, netWorth: 43_250_000 })
  })

  it('R5/R7: thu 18 tr, thiết yếu 10,15 tr, mong muốn 2,1 tr, tỉ lệ tiết kiệm 31,9%', () => {
    const [aug] = cashflowSeries(p1.transactions, p1.categories, ['2026-08'], 1)
    expect(aug).toMatchObject({ income: 18_000_000, needs: 10_150_000, wants: 2_100_000, expense: 12_250_000, net: 5_750_000 })
    expect(aug!.savingsRate).toBeCloseTo(0.3194, 4)
    expect(cashflowSeries(p1.transactions, p1.categories, ['2026-07'], 1)[0]!.savingsRate).toBeNull()
  })

  it('chi theo danh mục cấp 1, lớn → nhỏ; hoàn tiền được trừ', () => {
    const top = spendingByTopCategory(p1.transactions, p1.categories, periodRange('2026-08'))
    expect(top[0]).toEqual({ categoryId: p1.categoryId('Nhà ở'), amount: 5_000_000 })
    expect(top.find((t) => t.categoryId === p1.categoryId('Mua sắm'))?.amount).toBe(1_000_000)
  })

  it('R14: chi mỗi ngày, đủ 31 ngày', () => {
    const days = dailySpending(p1.transactions, periodRange('2026-08'))
    expect(days).toHaveLength(31)
    expect(days.find((d) => d.date === '2026-08-15')?.amount).toBe(2_000_000) // 800k + 1,2 tr
    expect(days.reduce((s, d) => s + d.amount, 0)).toBe(12_450_000 - 200_000 + 200_000) // ngày 18 chỉ có hoàn tiền → 0, không âm
  })

  it('trung bình trượt', () => {
    expect(movingAverage([3, 6, 9, 12])).toEqual([3, 4.5, 6, 9])
  })
})

describe('mô phỏng what-if', () => {
  const base: ProjectionInput = {
    start: '2026-09-01',
    months: 12,
    cash: 10_000_000,
    investments: 0,
    deposits: 0,
    otherAssets: 0,
    otherDebt: 0,
    loans: [],
    monthlySurplus: 5_000_000,
    investShare: 0,
    investmentReturn: 0,
    depositRate: 0,
    otherAssetGrowth: 0,
    extraDebtPayment: 0,
  }

  it('không lãi suất, không nợ → net worth tăng đều đúng bằng phần dư', () => {
    const r = projectNetWorth(base)
    expect(r.points).toHaveLength(13)
    expect(r.points.at(-1)!.netWorth).toBe(10_000_000 + 12 * 5_000_000)
    expect(r.debtFreeDate).toBe('2026-09-01')
  })

  it('đầu tư 100% phần dư với lợi suất 12%/năm → cao hơn để tiền mặt', () => {
    const r = projectNetWorth({ ...base, investShare: 1, investmentReturn: 0.12 })
    expect(r.points.at(-1)!.netWorth).toBeGreaterThan(70_000_000)
  })

  it('khoản vay: trả gốc chỉ chuyển tiền mặt sang giảm nợ; net worth chỉ giảm bằng tiền lãi', () => {
    const p2 = hung()
    const loan = { id: 'home', name: 'Vay nhà', terms: loanTermsOf(p2.loanDetails), outstanding: 1_200_000_000, scheduledPrincipal: 5_000_000, scheduledPayment: 14_000_000 }
    const r = projectNetWorth({ ...base, months: 1, monthlySurplus: 0, loans: [loan] })
    expect(r.totalInterest).toBe(9_000_000)
    expect(r.points[1]!.debt).toBe(1_195_000_000)
    expect(r.points[1]!.netWorth - r.points[0]!.netWorth).toBe(-9_000_000)
  })

  it('trả thêm mỗi tháng + trả trước một lần → hết nợ sớm hơn, ít lãi hơn', () => {
    const p2 = hung()
    const loan = { id: 'home', name: 'Vay nhà', terms: loanTermsOf(p2.loanDetails), outstanding: 1_200_000_000, scheduledPrincipal: 5_000_000, scheduledPayment: 14_000_000 }
    const input = { ...base, months: 300, monthlySurplus: 20_000_000, loans: [loan] }
    const baseline = projectNetWorth(input)
    const faster = projectNetWorth({ ...input, extraDebtPayment: 5_000_000, lumpSum: { loanId: 'home', amount: 100_000_000 } })
    expect(baseline.debtFreeDate).toBe('2046-09-01')
    expect(faster.debtFreeDate! < baseline.debtFreeDate!).toBe(true)
    expect(faster.totalInterest).toBeLessThan(baseline.totalInterest)
    // Không đầu tư, không lãi tiền gửi: tổng NW cuối cùng chênh đúng bằng tiền lãi tiết kiệm được.
    expect(faster.points.at(-1)!.netWorth - baseline.points.at(-1)!.netWorth).toBe(baseline.totalInterest - faster.totalInterest)
  })
})
