import { describe, expect, it } from 'vitest'
import { formatMoneyCompact } from '../lib/format'
import { hung, lan, mai } from '../test/personas'
import { bucketBreakdown, summarizeBudgetMonth } from './budget'
import { createPriceBook, valueHolding } from './investment'
import { generateInsights, healthIndicators, topInsights, type HealthInputs, type InsightContext } from './insights'
import { loanTermsOf } from './loan'
import { createLedger, netWorthAt } from './networth'
import { periodRange } from './period'

const p1 = lan()
const aug = periodRange('2026-08', 1)
const budget = summarizeBudgetMonth({
  range: aug,
  budgetMonth: p1.augustBudget,
  lines: p1.augustLines,
  categories: p1.categories,
  accounts: p1.accounts,
  transactions: p1.transactions,
  today: '2026-08-31',
})
const nw = netWorthAt(createLedger({ accounts: p1.accounts, transactions: p1.transactions }), '2026-08-31')
const categoryNames = new Map(p1.categories.map((c) => [c.id, c.name]))

const lanHealthInputs: HealthInputs = {
  period: { income: budget.actualIncome, netCashFlow: budget.netCashFlow },
  recentMonths: [{ income: 18_000_000, needs: 10_150_000 }],
  emergencyFund: 13_000_000,
  liquidAssets: nw.liquidAssets,
  totalAssets: nw.totalAssets,
  totalLiabilities: nw.totalLiabilities,
  monthlyDebtPayments: 0,
  creditCards: [],
  buckets: bucketBreakdown(p1.transactions, p1.categories, aug),
  netWorthStart: 37_500_000,
  netWorthEnd: nw.netWorth,
}

const baseContext = (over: Partial<InsightContext> = {}): InsightContext => ({
  today: '2026-08-31',
  budget,
  categoryNames,
  health: healthIndicators(lanHealthInputs),
  emergencyFund: 13_000_000,
  ...over,
})

describe('chỉ số sức khỏe tài chính — Lan tháng 8', () => {
  const h = healthIndicators(lanHealthInputs)

  it('tỉ lệ tiết kiệm 31,9% → Tốt', () => {
    expect(h.savingsRate.value).toBeCloseTo(0.3194, 4)
    expect(h.savingsRate.rating).toBe('good')
  })

  it('quỹ khẩn cấp 1,28 tháng → Cần chú ý', () => {
    expect(h.emergencyMonths.value).toBeCloseTo(1.2808, 4)
    expect(h.emergencyMonths.rating).toBe('attention')
  })

  it('không nợ; lệch 50/30/20 ≈ 18,3 điểm %; net worth tăng 15,3%', () => {
    expect(h.debtToAsset).toEqual({ value: 0, rating: 'good' })
    expect(h.creditUtilization).toEqual({ value: null, rating: null })
    expect(h.budgetRuleDeviation.value).toBeCloseTo(18.33, 1)
    expect(h.budgetRuleDeviation.rating).toBe('attention')
    expect(h.netWorthGrowth.value).toBeCloseTo(0.1533, 4)
  })

  it('chưa có dữ liệu → null, không bao giờ NaN (E9, E10)', () => {
    const empty = healthIndicators({
      ...lanHealthInputs,
      period: { income: 0, netCashFlow: 0 },
      recentMonths: [],
      totalAssets: 0,
      buckets: null,
      netWorthStart: 0,
    })
    for (const key of ['savingsRate', 'emergencyMonths', 'debtToIncome', 'debtToAsset', 'budgetRuleDeviation', 'netWorthGrowth'] as const) {
      expect(empty[key], key).toEqual({ value: null, rating: null })
    }
  })

  it('DTI của Hùng: 14 tr / 45 tr ≈ 31% → Trung bình', () => {
    const dti = healthIndicators({ ...lanHealthInputs, recentMonths: [{ income: 45_000_000, needs: 20_000_000 }], monthlyDebtPayments: 14_000_000 })
    expect(dti.debtToIncome.value).toBeCloseTo(0.3111, 4)
    expect(dti.debtToIncome.rating).toBe('fair')
  })
})

describe('insight', () => {
  it('Lan tháng 8: vượt ngân sách Ăn uống & Giải trí, quỹ khẩn cấp thấp — cảnh báo đứng đầu', () => {
    const messages = topInsights(baseContext()).map((i) => i.message)
    expect(messages).toEqual([
      'Ăn uống đã vượt 10% (350.000 ₫) ngân sách tháng.',
      'Giải trí đã vượt 10% (100.000 ₫) ngân sách tháng.',
      `Quỹ khẩn cấp đủ cho 1,3 tháng chi tiêu thiết yếu. Cần thêm ${formatMoneyCompact(17_450_000)} để đạt 3 tháng.`,
    ])
  })

  it('ẩn một insight thì không hiện lại', () => {
    const all = generateInsights(baseContext())
    const hidden = new Set([all[0]!.id])
    expect(generateInsights(baseContext(), hidden).map((i) => i.id)).not.toContain(all[0]!.id)
  })

  it('tháng trước tiết kiệm ≥ 20% → lời khen; net worth cao nhất', () => {
    const codes = generateInsights(
      baseContext({ lastMonth: { label: 'tháng 8', income: 18_000_000, netCashFlow: 5_750_000 }, netWorthNow: 43_250_000, netWorthHistory: [37_500_000] }),
    ).map((i) => i.code)
    expect(codes).toContain('I-SAVE')
    expect(codes).toContain('I-NWHIGH')
    expect(codes.indexOf('I-SAVE')).toBeGreaterThan(codes.indexOf('I-EMERG')) // tích cực xếp sau cảnh báo
  })

  it('tốc độ chi: ngày 15/08 Mua sắm đã chi 1,2 tr / 1,5 tr → dự báo vượt trước cuối tháng', () => {
    const mid = summarizeBudgetMonth({
      range: aug,
      budgetMonth: p1.augustBudget,
      lines: p1.augustLines,
      categories: p1.categories,
      accounts: p1.accounts,
      transactions: p1.transactions.filter((t) => t.date <= '2026-08-15'),
      today: '2026-08-15',
    })
    const pace = generateInsights(baseContext({ budget: mid, today: '2026-08-15' })).find((i) => i.code === 'I-PACE')
    expect(pace?.message).toBe('Với tốc độ hiện tại, Mua sắm sẽ vượt ngân sách vào khoảng ngày 19/08/2026.')
  })

  it('xu hướng: chi Ăn uống tăng mạnh so với trung bình 3 tháng', () => {
    const history = new Map([[p1.categoryId('Ăn uống'), [2_500_000, 2_800_000, 2_600_000]]])
    const trend = generateInsights(baseContext({ categoryHistory: history })).find((i) => i.code === 'I-TREND')
    expect(trend?.message).toBe('Chi Ăn uống tăng 46% so với trung bình 3 tháng.')
  })

  it('chi tiêu chưa lập ngân sách > 10% tổng chi', () => {
    const partial = summarizeBudgetMonth({
      range: aug,
      budgetMonth: p1.augustBudget,
      lines: p1.augustLines.filter((l) => l.target.kind !== 'category' || l.target.categoryId !== p1.categoryId('Nhà ở')),
      categories: p1.categories,
      accounts: p1.accounts,
      transactions: p1.transactions,
      today: '2026-08-31',
    })
    const i = generateInsights(baseContext({ budget: partial })).find((x) => x.code === 'I-UNBUDGET')
    expect(i?.message).toBe(`${formatMoneyCompact(5_000_000)} chi tiêu chưa thuộc dòng ngân sách nào.`)
  })

  it('Hùng: sổ đáo hạn trong 7 ngày, gợi ý trả trước khoản vay 9% khi có tiền nhàn rỗi', () => {
    const p2 = hung()
    const insights = generateInsights(
      baseContext({
        budget: null,
        today: '2026-08-28',
        deposits: [{ accountId: 'td', bankName: 'ABC', principal: 100_000_000, maturityDate: '2026-09-01', expectedInterest: 2_772_603 }],
        loans: [{ accountId: 'home', name: 'Vay mua nhà', terms: loanTermsOf(p2.loanDetails), outstanding: 1_200_000_000, annualRate: 0.09, prepaymentFeeRate: 0.01 }],
        bestSavingsRate: 0.055,
        liquidAssets: 300_000_000,
        emergencyTargetMonths: 6,
        health: healthIndicators({ ...lanHealthInputs, recentMonths: [{ income: 45_000_000, needs: 20_000_000 }] }),
      }),
    )
    const mature = insights.find((i) => i.code === 'I-MATURE')
    expect(mature?.message).toBe('Sổ 100 tr tại ABC đáo hạn ngày 01/09/2026 — lãi dự kiến 2,8 tr.')
    const prepay = insights.find((i) => i.code === 'I-PREPAY')
    expect(prepay?.message).toMatch(/^Trả trước 180 tr khoản vay Vay mua nhà \(9%\) sẽ tiết kiệm ~[\d,]+ (tr|tỷ) lãi/)
    expect(prepay?.message).toContain('không phải tư vấn tài chính')
  })

  it('khoản vay lãi phẳng 12% → cảnh báo lãi thực ~21,5%', () => {
    const i = generateInsights(baseContext({ flatLoans: [{ accountId: 'l', name: 'Mua xe máy', annualRate: 0.12, termMonths: 12 }] })).find(
      (x) => x.code === 'I-FLAT',
    )
    expect(i?.message).toBe('Khoản vay Mua xe máy lãi phẳng 12% tương đương ~21,5%/năm thực tế.')
  })

  it('Mai: thẻ dùng 40% hạn mức chưa cảnh báo; chỉ trả tối thiểu 2 kỳ → cảnh báo thời gian trả', () => {
    const card = { accountId: 'card', name: 'TPBank', balance: 20_000_000, limit: 50_000_000, annualRate: 0.3, minPaymentRate: 0.05 }
    expect(generateInsights(baseContext({ creditCards: [card] })).some((i) => i.code === 'I-CARD')).toBe(false)
    const warn = generateInsights(baseContext({ creditCards: [{ ...card, minimumOnlyStreak: 2 }] })).find((i) => i.code === 'I-CARD')
    expect(warn?.message).toBe('Chỉ trả tối thiểu, dư nợ thẻ TPBank sẽ mất ~2,4 năm để trả hết.')
  })

  it('Mai: giá cổ phiếu cập nhật 31/08, tới 15/10 đã cũ', () => {
    const p3 = mai()
    const v = valueHolding(p3.holdings[0]!, p3.buys, createPriceBook(p3.prices), '2026-10-15')
    const fresh = generateInsights(baseContext({ holdings: [v], today: '2026-09-15' })).find((i) => i.code === 'I-STALE')
    const stale = generateInsights(baseContext({ holdings: [v], today: '2026-10-15' })).find((i) => i.code === 'I-STALE')
    expect(fresh).toBeUndefined()
    expect(stale?.message).toBe('Giá 1 mã đầu tư đã cũ — net worth có thể chưa chính xác.')
  })
})
