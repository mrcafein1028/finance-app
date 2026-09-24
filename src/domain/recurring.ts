import { addDays, addMonthsToKey, dayOfMonth, monthOf } from './dates'
import type { IsoDate, RecurringRule } from './types'

// Lịch lặp của giao dịch định kỳ (docs/05 W14, W18). dayOfMonth = 31 nghĩa là "ngày cuối tháng";
// ngày không tồn tại được kẹp về cuối tháng (31 → 28/02, 29/02 năm nhuận — E2).

type Schedule = Pick<RecurringRule, 'frequency' | 'intervalCount' | 'dayOfMonth' | 'startDate' | 'endDate'>

/** Lần lặp thứ k (k = 0, 1, 2…) tính từ ngày bắt đầu. */
export function occurrenceAt(rule: Schedule, k: number): IsoDate {
  switch (rule.frequency) {
    case 'weekly':
      return addDays(rule.startDate, 7 * rule.intervalCount * k)
    case 'monthly':
      return dayOfMonth(addMonthsToKey(monthOf(rule.startDate), k * rule.intervalCount), rule.dayOfMonth ?? Number(rule.startDate.slice(8)))
    case 'yearly':
      return dayOfMonth(addMonthsToKey(monthOf(rule.startDate), 12 * k * rule.intervalCount), rule.dayOfMonth ?? Number(rule.startDate.slice(8)))
  }
}

/** Các ngày lặp trong [from, to] (cả hai đầu), không trước ngày bắt đầu, không sau ngày kết thúc. */
export function occurrencesBetween(rule: Schedule, from: IsoDate, to: IsoDate, limit = 400): IsoDate[] {
  const end = rule.endDate && rule.endDate < to ? rule.endDate : to
  const out: IsoDate[] = []
  for (let k = 0; out.length < limit; k++) {
    const d = occurrenceAt(rule, k)
    if (d > end) break
    if (d >= from && d >= rule.startDate) out.push(d)
  }
  return out
}

/** Lần lặp đầu tiên sau `date`; null nếu quy tắc đã kết thúc. */
export function nextOccurrenceAfter(rule: Schedule, date: IsoDate): IsoDate | null {
  for (let k = 0; k < 10_000; k++) {
    const d = occurrenceAt(rule, k)
    if (rule.endDate && d > rule.endDate) return null
    if (d > date && d >= rule.startDate) return d
  }
  return null
}

/** Lần lặp đầu tiên kể từ ngày bắt đầu — giá trị nextDate khi tạo quy tắc. */
export function firstOccurrence(rule: Schedule): IsoDate | null {
  return nextOccurrenceAfter(rule, addDays(rule.startDate, -1))
}

/** Các lần đã đến hạn tới hết ngày `today` mà chưa xử lý (từ nextDate). Quy tắc tạm dừng → không có. */
export function dueOccurrences(rule: RecurringRule, today: IsoDate): IsoDate[] {
  if (rule.pausedAt) return []
  return occurrencesBetween(rule, rule.nextDate, today)
}

/** Khóa chống trùng của một lần lặp — Postgres chặn tạo hai lần (unique idempotency_key). */
export const recurringKey = (ruleId: string, date: IsoDate) => `recurring:${ruleId}:${date}`

/** Mô tả tần suất cho người đọc: "Hằng tháng, ngày 5", "Mỗi 2 tuần"… */
export function describeSchedule(rule: Schedule): string {
  const every = rule.intervalCount > 1 ? `Mỗi ${rule.intervalCount} ` : 'Hằng '
  switch (rule.frequency) {
    case 'weekly':
      return rule.intervalCount > 1 ? `${every}tuần` : 'Hằng tuần'
    case 'monthly': {
      const day = rule.dayOfMonth === 31 ? 'ngày cuối tháng' : `ngày ${rule.dayOfMonth}`
      return `${rule.intervalCount > 1 ? `${every}tháng` : 'Hằng tháng'}, ${day}`
    }
    case 'yearly':
      return `${rule.intervalCount > 1 ? `${every}năm` : 'Hằng năm'}, ngày ${rule.dayOfMonth}/${rule.startDate.slice(5, 7)}`
  }
}
