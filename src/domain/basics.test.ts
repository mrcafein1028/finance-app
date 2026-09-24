import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { addDays, addMonths, diffDays } from './dates'
import { allocate, allocateEvenly, ratio, round } from './money'
import { daysElapsed, daysInPeriod, periodOf, periodRange } from './period'

describe('money', () => {
  it('làm tròn nửa lên về đồng', () => {
    expect(round('2772602.7397')).toBe(2_772_603)
    expect(round('25205.479')).toBe(25_205)
    expect(round('0.5')).toBe(1)
    expect(round('-0.5')).toBe(-1)
  })

  it('chia không lệch: 1.000.000 / 3 = [333.334, 333.333, 333.333] (docs/04 §1)', () => {
    expect(allocateEvenly(1_000_000, 3)).toEqual([333_334, 333_333, 333_333])
    expect(allocateEvenly(1_200_000_000, 240).every((x) => x === 5_000_000)).toBe(true)
  })

  it('chia theo trọng số, tổng luôn đúng', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(allocate(18_000_000, [50, 30, 20])).toEqual([9_000_000, 5_400_000, 3_600_000])
    expect(allocate(-10, [1, 2])).toEqual([-3, -7])
  })

  it('ratio không bao giờ trả NaN/∞', () => {
    expect(ratio(5, 0)).toBeNull()
    expect(ratio(5, -1)).toBeNull()
    expect(ratio(1, 4)).toBe(0.25)
  })
})

describe('ngày tháng', () => {
  it('cộng tháng kẹp về cuối tháng', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-03-01', 6)).toBe('2026-09-01')
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15')
  })

  it('đếm ngày thực', () => {
    expect(diffDays('2026-03-01', '2026-09-01')).toBe(184)
    expect(diffDays('2026-03-01', '2026-06-01')).toBe(92)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('kỳ ngân sách (docs/04 §2)', () => {
  it('ngày bắt đầu kỳ 1 = tháng dương lịch', () => {
    expect(periodRange('2026-08', 1)).toEqual({ month: '2026-08', start: '2026-08-01', end: '2026-08-31' })
    expect(periodRange('2026-02', 1).end).toBe('2026-02-28')
  })

  it('ngày bắt đầu kỳ 5: kỳ "2026-09" = 05/09 → 04/10', () => {
    expect(periodRange('2026-09', 5)).toEqual({ month: '2026-09', start: '2026-09-05', end: '2026-10-04' })
    expect(periodOf('2026-10-03', 5)).toBe('2026-09')
    expect(periodOf('2026-10-05', 5)).toBe('2026-10')
    expect(periodOf('2027-01-02', 5)).toBe('2026-12')
  })

  it('số ngày đã qua', () => {
    const aug = periodRange('2026-08', 1)
    expect(daysInPeriod(aug)).toBe(31)
    expect(daysElapsed(aug, '2026-07-20')).toBe(0)
    expect(daysElapsed(aug, '2026-08-10')).toBe(10)
    expect(daysElapsed(aug, '2026-09-20')).toBe(31)
  })
})

describe('E1: đổi ngày bắt đầu tháng không làm mất / nhân đôi giao dịch', () => {
  it('với mọi startDay 1–28, mỗi ngày thuộc đúng một kỳ và các kỳ nối liền nhau', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 28 }), fc.integer({ min: 0, max: 3650 }), (startDay, offset) => {
        const date = addDays('2024-01-01', offset)
        const month = periodOf(date, startDay)
        const range = periodRange(month, startDay)
        expect(date >= range.start && date <= range.end).toBe(true)
        const next = periodRange(periodOf(addDays(range.end, 1), startDay), startDay)
        expect(next.start).toBe(addDays(range.end, 1))
      }),
    )
  })
})
