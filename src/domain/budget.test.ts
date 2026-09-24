import { describe, expect, it } from 'vitest'
import { lan, line } from '../test/personas'
import { bucketBreakdown, carryForward, copyLines, split503020, suggestExpectedIncome, summarizeBudgetMonth, type BudgetLineSummary } from './budget'
import { periodRange } from './period'

const p1 = lan()
const aug = periodRange('2026-08', 1)

const august = (today = '2026-08-31') =>
  summarizeBudgetMonth({
    range: aug,
    budgetMonth: p1.augustBudget,
    lines: p1.augustLines,
    categories: p1.categories,
    accounts: p1.accounts,
    transactions: p1.transactions,
    today,
  })

const lineOf = (lines: BudgetLineSummary[], name: string) => {
  const id = p1.categoryId(name)
  return lines.find((l) => l.line.target.kind === 'category' && l.line.target.categoryId === id)!
}

describe('ngân sách tháng 8 của Lan (docs/08 §2)', () => {
  it('tổng kế hoạch 15,5 tr, chưa phân bổ 2,5 tr', () => {
    const s = august()
    expect(s.totalPlanned).toBe(15_500_000)
    expect(s.unassigned).toBe(2_500_000)
  })

  it('thu 18 tr, chi 12,25 tr (đã trừ hoàn tiền), dòng tiền ròng 5,75 tr', () => {
    const s = august()
    expect(s.actualIncome).toBe(18_000_000)
    expect(s.actualExpense).toBe(12_250_000)
    expect(s.netCashFlow).toBe(5_750_000)
    expect(s.netCashFlow / s.actualIncome).toBeCloseTo(0.3194, 4)
  })

  it('trạng thái từng dòng', () => {
    const { lines } = august()
    expect(lineOf(lines, 'Ăn uống')).toMatchObject({ actual: 3_850_000, available: -350_000, status: 'over' })
    expect(lineOf(lines, 'Ăn uống').usage).toBeCloseTo(1.1, 6)
    expect(lineOf(lines, 'Giải trí')).toMatchObject({ actual: 1_100_000, available: -100_000, status: 'over' })
    expect(lineOf(lines, 'Mua sắm')).toMatchObject({ actual: 1_000_000, status: 'ok' })
    expect(lineOf(lines, 'Mua sắm').usage).toBeCloseTo(0.6667, 4)
    expect(lineOf(lines, 'Hóa đơn & tiện ích')).toMatchObject({ actual: 700_000, status: 'full', available: 0 })
    expect(lineOf(lines, 'Đi lại')).toMatchObject({ actual: 600_000, status: 'ok' })
    const fund = lines.find((l) => l.line.target.kind === 'account')!
    expect(fund).toMatchObject({ actual: 3_000_000, status: 'full' })
  })

  it('mọi chi tiêu đều thuộc dòng ngân sách → chưa lập ngân sách = 0', () => {
    expect(august().unbudgetedSpend).toBe(0)
  })

  it('tốc độ chi (pace): mức "đáng lẽ chỉ nên tiêu đến" tỉ lệ với số ngày đã qua', () => {
    const rent = lineOf(august('2026-08-10').lines, 'Nhà ở')
    expect(rent.pace).toBe(Math.round((5_000_000 * 10) / 31))
    expect(rent).toMatchObject({ status: 'full', aheadOfPace: true }) // tiền nhà trả một lần đầu tháng
    const food = lineOf(august('2026-08-31').lines, 'Ăn uống')
    expect(food.aheadOfPace).toBe(false) // đã "vượt" thì báo vượt, không báo tốc độ
    const shopping = lineOf(august('2026-08-15').lines, 'Mua sắm')
    expect(shopping.aheadOfPace).toBe(true) // 1,2 tr > 1,5 tr × 15/31
  })

  it('50/30/20 thực tế: 56,4% / 11,7% / 31,9%', () => {
    const b = bucketBreakdown(p1.transactions, p1.categories, aug)
    expect(b).toMatchObject({ income: 18_000_000, needs: 10_150_000, wants: 2_100_000, savings: 5_750_000 })
    expect(b.shares!.needs).toBeCloseTo(0.5639, 4)
    expect(b.shares!.wants).toBeCloseTo(0.1167, 4)
    expect(b.shares!.savings).toBeCloseTo(0.3194, 4)
  })
})

describe('tháng 9: sao chép & chuyển dư (rollover)', () => {
  const sep = periodRange('2026-09', 1)
  const septemberLines = copyLines(p1.augustLines).map((d) => line('2026-09', d.target, d.planned, d.rollover))
  const summarize = (allowNegativeRollover: boolean) =>
    summarizeBudgetMonth({
      range: sep,
      budgetMonth: { expectedIncome: 18_000_000 },
      lines: septemberLines,
      categories: p1.categories,
      accounts: p1.accounts,
      transactions: p1.transactions,
      previousAvailable: carryForward(august()),
      allowNegativeRollover,
      today: '2026-09-01',
    })

  it('Ăn uống khả dụng = 3.500.000 − 350.000 = 3.150.000', () => {
    const food = lineOf(summarize(true).lines, 'Ăn uống')
    expect(food).toMatchObject({ carryIn: -350_000, budget: 3_150_000, available: 3_150_000 })
  })

  it('tắt "chuyển âm" → không trừ; dòng không bật rollover không nhận phần dư', () => {
    expect(lineOf(summarize(false).lines, 'Ăn uống').budget).toBe(3_500_000)
    expect(lineOf(summarize(true).lines, 'Giải trí').carryIn).toBe(0)
  })
})

describe('gợi ý', () => {
  it('thu nhập dự kiến: tháng trước hoặc TB 3 tháng (P3: 10 tr, 60 tr → 35 tr)', () => {
    expect(suggestExpectedIncome([10_000_000, 60_000_000], 'average3')).toBe(35_000_000)
    expect(suggestExpectedIncome([10_000_000, 60_000_000], 'previous')).toBe(60_000_000)
    expect(suggestExpectedIncome([], 'average3')).toBe(0)
  })

  it('50/30/20 cho thu nhập 18 tr', () => {
    expect(split503020(18_000_000)).toEqual({ needs: 9_000_000, wants: 5_400_000, savings: 3_600_000 })
  })
})
