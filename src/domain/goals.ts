import { diffDays } from './dates'
import { D, round } from './money'
import type { IsoDate, Money } from './types'

/** % tiến độ mục tiêu, làm tròn, kẹp trong 0–100. */
export function goalProgress(balance: Money, target: Money): number {
  if (target <= 0) return 0
  return Math.min(100, Math.max(0, round(new D(balance).times(100).div(target))))
}

/**
 * Số tiền cần góp mỗi tháng để đạt mục tiêu đúng hạn (W8): (mục tiêu − hiện có) / số tháng còn lại
 * (tối thiểu 1 tháng). null nếu không có hạn hoặc đã đạt.
 */
export function monthlyContributionToGoal(balance: Money, target: Money, targetDate: IsoDate | null, today: IsoDate): Money | null {
  if (!targetDate || balance >= target) return null
  const months = Math.max(1, Math.ceil(diffDays(today, targetDate) / 30.4375))
  return round(new D(target - balance).div(months))
}
