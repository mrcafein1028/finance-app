import Decimal from 'decimal.js'
import { DomainError } from './errors'
import type { Money } from './types'

/** Decimal riêng cho domain: đủ chính xác cho lãi kép 420 kỳ, làm tròn nửa lên (docs/04 §1). */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })
export type Dec = InstanceType<typeof D>
export type Numeric = Dec | number | string

/** Làm tròn về đồng — chỉ gọi MỘT lần ở cuối mỗi phép tính. */
export function round(value: Numeric): Money {
  return new D(value).toDecimalPlaces(0, D.ROUND_HALF_UP).toNumber()
}

export function sum(values: readonly Money[]): Money {
  let total = 0
  for (const v of values) total += v
  return total
}

/**
 * Chia `total` thành các phần theo trọng số, tổng các phần luôn đúng bằng `total`
 * (phương pháp largest remainder). Phần dư chia cho phần có phần lẻ lớn nhất, hòa thì phần đứng trước.
 */
export function allocate(total: Money, weights: readonly Numeric[]): Money[] {
  if (!Number.isInteger(total)) throw new DomainError('not_integer', 'Số tiền phải là số nguyên')
  if (weights.length === 0) return []
  const w = weights.map((x) => new D(x))
  const weightSum = w.reduce((a, b) => a.plus(b), new D(0))
  if (weightSum.lte(0)) throw new DomainError('invalid_weights', 'Tổng trọng số phải lớn hơn 0')

  const sign = total < 0 ? -1 : 1
  const abs = Math.abs(total)
  const exact = w.map((x) => x.times(abs).div(weightSum))
  const floors = exact.map((x) => x.floor().toNumber())
  let remainder = abs - sum(floors)
  const order = exact
    .map((x, i) => ({ i, frac: x.minus(x.floor()) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i)
  for (const { i } of order) {
    if (remainder <= 0) break
    floors[i]! += 1
    remainder -= 1
  }
  return floors.map((x) => x * sign)
}

/** Chia đều thành `parts` phần: 1.000.000 / 3 → [333.334, 333.333, 333.333]. */
export function allocateEvenly(total: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts <= 0) throw new DomainError('invalid_parts', 'Số phần phải là số nguyên dương')
  return allocate(total, Array.from({ length: parts }, () => 1))
}

/** a / b, trả null khi mẫu ≤ 0 (không bao giờ ra NaN/∞ — docs/04 §9). */
export function ratio(numerator: number, denominator: number): number | null {
  if (!(denominator > 0)) return null
  return numerator / denominator
}
