import { format } from 'date-fns'

/**
 * Nguồn thời gian duy nhất của app. Playwright giả lập đồng hồ qua `page.clock`,
 * unit test có thể thay bằng `setClock`.
 */
let currentNow: () => Date = () => new Date()

export function setClock(now: () => Date): void {
  currentNow = now
}

export function resetClock(): void {
  currentNow = () => new Date()
}

export function now(): Date {
  return currentNow()
}

/** Thời điểm hiện tại dạng ISO có múi giờ (dùng cho createdAt/updatedAt). */
export function nowIso(): string {
  return currentNow().toISOString()
}

/** Ngày hôm nay theo giờ địa phương. Không dùng toISOString() vì sẽ lệch ngày sau 17h ở UTC+7. */
export function today(): string {
  return format(currentNow(), 'yyyy-MM-dd')
}
