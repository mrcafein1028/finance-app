import { afterEach, describe, expect, it } from 'vitest'
import { resetClock, setClock, today } from './clock'
import { formatDate, formatMoney, formatMoneyCompact, formatPercent, parseMoneyInput, parsePercentInput, parseQuantityInput } from './format'

describe('parseMoneyInput — cách gõ số tiền của người Việt', () => {
  it.each([
    ['150000', 150_000],
    ['150.000', 150_000],
    ['1.234.567', 1_234_567],
    ['150k', 150_000],
    ['150 K', 150_000],
    ['2tr', 2_000_000],
    ['2,5tr', 2_500_000],
    ['2.5tr', 2_500_000],
    ['1ty', 1_000_000_000],
    ['1,2 tỷ', 1_200_000_000],
    ['50.000đ', 50_000],
  ])('%s → %d', (input, expected) => {
    expect(parseMoneyInput(input)).toBe(expected)
  })

  it.each(['', 'abc', '2xyz', '1.23', '-5k', '1,5', '0,0001k'])('từ chối "%s"', (input) => {
    expect(parseMoneyInput(input)).toBeNull()
  })
})

describe('định dạng hiển thị', () => {
  it('tiền đầy đủ', () => {
    expect(formatMoney(1_234_567)).toBe('1.234.567 ₫')
    expect(formatMoney(-350_000)).toBe('−350.000 ₫')
    expect(formatMoney(5_750_000, { sign: true })).toBe('+5.750.000 ₫')
  })

  it('tiền rút gọn cho biểu đồ', () => {
    expect(formatMoneyCompact(1_200_000)).toBe('1,2 tr')
    expect(formatMoneyCompact(3_500_000_000)).toBe('3,5 tỷ')
    expect(formatMoneyCompact(-150_000)).toBe('−150 k')
  })

  it('ngày dd/MM/yyyy', () => {
    expect(formatDate('2026-09-24')).toBe('24/09/2026')
  })
})

describe('today()', () => {
  afterEach(resetClock)

  it('dùng ngày địa phương thay vì UTC', () => {
    // 23:30 ngày 24/09 giờ địa phương vẫn phải là ngày 24.
    setClock(() => new Date(2026, 8, 24, 23, 30))
    expect(today()).toBe('2026-09-24')
  })
})

describe('phần trăm & số lượng', () => {
  it('đọc lãi suất kiểu Việt Nam', () => {
    expect(parsePercentInput('5,5')).toBe(0.055)
    expect(parsePercentInput('9%')).toBe(0.09)
    expect(parsePercentInput('0.1')).toBe(0.001)
    expect(parsePercentInput('abc')).toBeNull()
    expect(parsePercentInput('70', 60)).toBeNull()
    expect(formatPercent(0.055)).toBe('5,5%')
  })
  it('đọc số lượng thập phân', () => {
    expect(parseQuantityInput('0,5')).toBe('0.5')
    expect(parseQuantityInput('1000')).toBe('1000')
    expect(parseQuantityInput('0')).toBeNull()
    expect(parseQuantityInput('-1')).toBeNull()
  })
})
