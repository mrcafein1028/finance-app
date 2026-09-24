import { addDays, addMonthsToKey, dayOfMonth, diffDays, monthOf } from './dates'
import type { IsoDate, MonthKey } from './types'

export interface PeriodRange {
  month: MonthKey
  start: IsoDate
  /** Ngày cuối kỳ, tính cả ngày này. */
  end: IsoDate
}

/** Kỳ ngân sách M với ngày bắt đầu kỳ s (1–28): s/M → (s/M+1) − 1 ngày (docs/04 §2). */
export function periodRange(month: MonthKey, startDay = 1): PeriodRange {
  const start = dayOfMonth(month, startDay)
  const end = addDays(dayOfMonth(addMonthsToKey(month, 1), startDay), -1)
  return { month, start, end }
}

/** Kỳ ngân sách chứa ngày `date`. VD s = 5: ngày 03/10 thuộc kỳ "2026-09". */
export function periodOf(date: IsoDate, startDay = 1): MonthKey {
  const month = monthOf(date)
  return Number(date.slice(8, 10)) >= startDay ? month : addMonthsToKey(month, -1)
}

export const isInPeriod = (date: IsoDate, range: PeriodRange) => date >= range.start && date <= range.end

export const daysInPeriod = (range: PeriodRange) => diffDays(range.start, range.end) + 1

/** Số ngày đã qua của kỳ tính đến hết ngày `today` (0 nếu kỳ chưa bắt đầu, tối đa = số ngày của kỳ). */
export function daysElapsed(range: PeriodRange, today: IsoDate): number {
  if (today < range.start) return 0
  if (today > range.end) return daysInPeriod(range)
  return diffDays(range.start, today) + 1
}

export const previousMonth = (month: MonthKey) => addMonthsToKey(month, -1)
export const nextMonth = (month: MonthKey) => addMonthsToKey(month, 1)
