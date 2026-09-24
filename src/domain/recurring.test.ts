import { describe, expect, it } from 'vitest'
import { lan, line } from '../test/personas'
import { averageSpending, summarizeBudgetChain, suggestLines503020 } from './budget'
import { periodRange } from './period'
import { describeSchedule, dueOccurrences, firstOccurrence, nextOccurrenceAfter, occurrencesBetween, recurringKey } from './recurring'
import type { RecurringRule } from './types'

const rule = (over: Partial<RecurringRule> = {}): RecurringRule => ({
  id: 'r1',
  name: 'Lương',
  template: { type: 'income', amount: 18_000_000, accountId: 'vcb', categoryId: 'c', toAccountId: null, direction: null, note: null, tags: [] },
  frequency: 'monthly',
  intervalCount: 1,
  dayOfMonth: 5,
  startDate: '2026-08-05',
  endDate: null,
  nextDate: '2026-08-05',
  mode: 'auto',
  pausedAt: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  ...over,
})

describe('lịch lặp (W14)', () => {
  it('hằng tháng ngày 5', () => {
    expect(occurrencesBetween(rule(), '2026-08-01', '2026-11-30')).toEqual(['2026-08-05', '2026-09-05', '2026-10-05', '2026-11-05'])
    expect(nextOccurrenceAfter(rule(), '2026-08-05')).toBe('2026-09-05')
  })

  it('E2: ngày 31 → ngày cuối tháng, qua tháng 2 (kể cả năm nhuận)', () => {
    const r = rule({ dayOfMonth: 31, startDate: '2026-12-31', nextDate: '2026-12-31' })
    expect(occurrencesBetween(r, '2026-12-01', '2027-04-30')).toEqual(['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
    const leap = rule({ dayOfMonth: 31, startDate: '2028-01-31', nextDate: '2028-01-31' })
    expect(occurrencesBetween(leap, '2028-02-01', '2028-02-29')).toEqual(['2028-02-29'])
  })

  it('bắt đầu giữa tháng sau ngày lặp → lần đầu ở tháng sau', () => {
    expect(firstOccurrence(rule({ startDate: '2026-08-20', dayOfMonth: 5 }))).toBe('2026-09-05')
    expect(firstOccurrence(rule({ startDate: '2026-08-05' }))).toBe('2026-08-05')
  })

  it('hằng tuần / mỗi 2 tuần / hằng năm, có ngày kết thúc', () => {
    const weekly = rule({ frequency: 'weekly', dayOfMonth: null, intervalCount: 2, startDate: '2026-08-03' })
    expect(occurrencesBetween(weekly, '2026-08-01', '2026-09-01')).toEqual(['2026-08-03', '2026-08-17', '2026-08-31'])
    const yearly = rule({ frequency: 'yearly', dayOfMonth: 15, startDate: '2026-03-15', endDate: '2028-01-01' })
    expect(occurrencesBetween(yearly, '2026-01-01', '2030-12-31')).toEqual(['2026-03-15', '2027-03-15'])
    expect(nextOccurrenceAfter(yearly, '2027-03-15')).toBeNull()
  })

  it('E3: 3 tháng không mở app → đủ 3 lần lỡ; tạm dừng → không có', () => {
    const r = rule({ nextDate: '2026-09-05' })
    expect(dueOccurrences(r, '2026-11-20')).toEqual(['2026-09-05', '2026-10-05', '2026-11-05'])
    expect(dueOccurrences({ ...r, pausedAt: '2026-09-01T00:00:00Z' }, '2026-11-20')).toEqual([])
    expect(recurringKey('r1', '2026-09-05')).toBe('recurring:r1:2026-09-05')
  })

  it('mô tả cho người đọc', () => {
    expect(describeSchedule(rule())).toBe('Hằng tháng, ngày 5')
    expect(describeSchedule(rule({ dayOfMonth: 31 }))).toBe('Hằng tháng, ngày cuối tháng')
    expect(describeSchedule(rule({ frequency: 'weekly', dayOfMonth: null, intervalCount: 2 }))).toBe('Mỗi 2 tuần')
  })
})

describe('chuỗi ngân sách nhiều tháng', () => {
  const p1 = lan()
  const sepLines = p1.augustLines.map((l) => line('2026-09', l.target, l.planned, l.rollover))
  const chain = summarizeBudgetChain({
    months: [p1.augustBudget, { ...p1.augustBudget, month: '2026-09' }],
    lines: [...p1.augustLines, ...sepLines],
    categories: p1.categories,
    accounts: p1.accounts,
    transactions: p1.transactions,
    rangeOf: (m) => periodRange(m, 1),
    today: '2026-09-01',
  })

  it('tháng 9 nhận phần vượt −350.000 của Ăn uống tháng 8', () => {
    const food = chain.get('2026-09')!.lines.find((l) => l.line.target.kind === 'category' && l.line.target.categoryId === p1.categoryId('Ăn uống'))!
    expect(food.budget).toBe(3_150_000)
  })

  it('tháng bị bỏ trống ở giữa làm đứt chuỗi chuyển dư', () => {
    const gap = summarizeBudgetChain({
      months: [p1.augustBudget, { ...p1.augustBudget, month: '2026-10' }],
      lines: [...p1.augustLines, ...p1.augustLines.map((l) => line('2026-10', l.target, l.planned, l.rollover))],
      categories: p1.categories,
      accounts: p1.accounts,
      transactions: p1.transactions,
      rangeOf: (m) => periodRange(m, 1),
      today: '2026-10-01',
    })
    expect(gap.get('2026-10')!.lines.every((l) => l.carryIn === 0)).toBe(true)
  })
})

describe('gợi ý ngân sách', () => {
  const p1 = lan()
  it('50/30/20: tổng đúng bằng thu nhập, 20% vào quỹ khẩn cấp, bỏ qua nhóm hệ thống', () => {
    const drafts = suggestLines503020(18_000_000, p1.categories, 'fund')
    expect(drafts.reduce((s, d) => s + d.planned, 0)).toBe(18_000_000)
    expect(drafts.find((d) => d.target.kind === 'account')?.planned).toBe(3_600_000)
    const names = drafts.flatMap((d) => (d.target.kind === 'category' ? [p1.categories.find((c) => c.id === (d.target as { categoryId: string }).categoryId)!.name] : []))
    expect(names).not.toContain('Tài chính')
    expect(names).toContain('Ăn uống')
  })

  it('có lịch sử chi → chia theo tỉ lệ thực tế', () => {
    const history = (id: string) => (id === p1.categoryId('Nhà ở') ? 5_000_000 : id === p1.categoryId('Ăn uống') ? 3_850_000 : 0)
    const drafts = suggestLines503020(18_000_000, p1.categories, null, history)
    const rent = drafts.find((d) => d.target.kind === 'category' && d.target.categoryId === p1.categoryId('Nhà ở'))!
    const health = drafts.find((d) => d.target.kind === 'category' && d.target.categoryId === p1.categoryId('Sức khỏe'))!
    expect(rent.planned).toBeGreaterThan(health.planned * 1000)
  })

  it('trung bình chi 3 tháng của một danh mục', () => {
    const avg = averageSpending(p1.categoryId('Ăn uống'), p1.categories, p1.transactions, [periodRange('2026-08'), periodRange('2026-07')])
    expect(avg).toBe(1_925_000) // (3.850.000 + 0) / 2
  })
})
