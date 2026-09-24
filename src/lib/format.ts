import { MAX_MONEY } from '../schemas/common'

const moneyFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 })

/** 1234567 → "1.234.567 ₫" */
export function formatMoney(amount: number, { sign = false }: { sign?: boolean } = {}): string {
  const text = `${moneyFormatter.format(Math.abs(amount))} ₫`
  if (amount < 0) return `−${text}`
  if (sign && amount > 0) return `+${text}`
  return text
}

/** Rút gọn cho trục biểu đồ: 1.200.000 → "1,2 tr", 3.500.000.000 → "3,5 tỷ". */
export function formatMoneyCompact(amount: number): string {
  const abs = Math.abs(amount)
  const minus = amount < 0 ? '−' : ''
  const short = (value: number, unit: string) =>
    `${minus}${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value)} ${unit}`
  if (abs >= 1e9) return short(abs / 1e9, 'tỷ')
  if (abs >= 1e6) return short(abs / 1e6, 'tr')
  if (abs >= 1e3) return short(abs / 1e3, 'k')
  return `${minus}${abs}`
}

/** "2026-08" → "Tháng 08/2026" */
export const monthLabel = (month: string) => `Tháng ${month.slice(5)}/${month.slice(0, 4)}`

/** "2026-09-24" → "24/09/2026" */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}/${m}/${y}`
}

const UNIT_MULTIPLIER: Record<string, number> = {
  '': 1,
  k: 1_000,
  n: 1_000, // "nghìn"
  tr: 1_000_000,
  m: 1_000_000,
  ty: 1_000_000_000,
  tỷ: 1_000_000_000,
}

/**
 * Hiểu cách gõ số tiền của người Việt (docs/06): "150k", "2tr", "2,5tr", "1ty", "1.234.567".
 * Trả về null nếu không hiểu hoặc kết quả không phải số nguyên đồng hợp lệ.
 */
export function parseMoneyInput(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, '').replace(/đ|₫|vnd$/g, '')
  if (text === '') return null

  const match = /^(\d+(?:[.,]\d+)*)([a-zỷ]*)$/.exec(text)
  if (!match) return null
  const [, numberPart = '', unit = ''] = match
  const multiplier = UNIT_MULTIPLIER[unit]
  if (multiplier === undefined) return null

  let value: number
  if (multiplier === 1) {
    // Không có đơn vị: dấu . và , đều là phân cách hàng nghìn ("1.234.567").
    if (!/^\d{1,3}([.,]\d{3})*$|^\d+$/.test(numberPart)) return null
    value = Number(numberPart.replace(/[.,]/g, ''))
  } else {
    // Có đơn vị: cho phép một dấu thập phân ("2,5tr", "1.5ty").
    if (!/^\d+([.,]\d+)?$/.test(numberPart)) return null
    value = Number(numberPart.replace(',', '.')) * multiplier
  }

  const rounded = Math.round(value)
  if (!Number.isFinite(rounded) || Math.abs(rounded - value) > 1e-6 || rounded > MAX_MONEY) return null
  return rounded
}

/** "5,5" / "5.5" / "5,5%" → 0.055. null nếu không hợp lệ hoặc ngoài [0, max%]. */
export function parsePercentInput(raw: string, maxPercent = 100): number | null {
  const text = raw.trim().replace('%', '').replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const value = Number(text)
  if (value > maxPercent) return null
  return Math.round(value * 1e6) / 1e8
}

/** 0.055 → "5,5%" */
export const formatPercent = (rate: number, digits = 2) =>
  new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: digits }).format(rate)

/** Số lượng thập phân gõ kiểu Việt ("0,5" chỉ vàng) → chuỗi "0.5"; null nếu không hợp lệ. */
export function parseQuantityInput(raw: string): string | null {
  const text = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(text) || Number(text) <= 0) return null
  return text.replace(/^0+(?=\d)/, '')
}
