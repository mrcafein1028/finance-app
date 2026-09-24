// Ngày dạng chuỗi 'YYYY-MM-DD', tính bằng UTC để không bao giờ lệch vì múi giờ.
import type { IsoDate, MonthKey } from './types'

const DAY_MS = 86_400_000

function parts(date: IsoDate): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return [y, m, d]
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

export function toMs(date: IsoDate): number {
  const [y, m, d] = parts(date)
  return Date.UTC(y, m - 1, d)
}

export function fromMs(ms: number): IsoDate {
  const dt = new Date(ms)
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export function makeDate(year: number, month: number, day: number): IsoDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export const addDays = (date: IsoDate, days: number): IsoDate => fromMs(toMs(date) + days * DAY_MS)

/** Số ngày từ `from` tới `to` (to − from). */
export const diffDays = (from: IsoDate, to: IsoDate): number => Math.round((toMs(to) - toMs(from)) / DAY_MS)

/** Cộng tháng; ngày không tồn tại thì lấy ngày cuối tháng (31/01 + 1 tháng = 28/02). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = parts(date)
  const total = y * 12 + (m - 1) + months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  return makeDate(year, month, Math.min(d, daysInMonth(year, month)))
}

export const monthOf = (date: IsoDate): MonthKey => date.slice(0, 7)

export function addMonthsToKey(month: MonthKey, months: number): MonthKey {
  return monthOf(addMonths(`${month}-01`, months))
}

/** Ngày `day` của tháng `month`, kẹp về ngày cuối tháng nếu cần. */
export function dayOfMonth(month: MonthKey, day: number): IsoDate {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return makeDate(y, m, Math.min(day, daysInMonth(y, m)))
}

export const minDate = (a: IsoDate, b: IsoDate) => (a < b ? a : b)
export const maxDate = (a: IsoDate, b: IsoDate) => (a > b ? a : b)
