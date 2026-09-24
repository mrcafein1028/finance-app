import { z } from 'zod'

/** Giới hạn trên của mọi số tiền (≈ 999 nghìn tỷ đồng), vẫn nằm trong Number.MAX_SAFE_INTEGER. */
export const MAX_MONEY = 999_999_999_999_999

export const idSchema = z.string().min(1, 'Thiếu mã định danh')

/** Tiền: số nguyên đồng, ≥ 0. */
export const moneySchema = z
  .number({ error: 'Số tiền không hợp lệ' })
  .int('Số tiền phải là số nguyên (đồng)')
  .min(0, 'Số tiền không được âm')
  .max(MAX_MONEY, 'Số tiền quá lớn')

/** Tiền > 0 — dùng cho giao dịch, gốc vay, mục tiêu. */
export const positiveMoneySchema = moneySchema.min(1, 'Số tiền phải lớn hơn 0')

/** Tiền có dấu — chỉ dùng cho số liệu dẫn xuất (net worth có thể âm). */
export const signedMoneySchema = z.number().int().min(-MAX_MONEY).max(MAX_MONEY)

function isRealDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** Ngày dạng YYYY-MM-DD, không có giờ (tránh lỗi múi giờ). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD')
  .refine(isRealDate, 'Ngày không tồn tại')

/** Kỳ ngân sách dạng YYYY-MM. */
export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Tháng phải có dạng YYYY-MM')

export const datetimeSchema = z.iso.datetime({ offset: true })

/** Lãi suất / tỉ lệ dạng thập phân: 5,5% → 0.055. */
export const rateSchema = z.number().min(0, 'Tỉ lệ không được âm').max(1, 'Tỉ lệ tối đa 100%')

/** Ngày trong tháng tồn tại ở mọi tháng. */
export const dayOfMonthSchema = z.number().int().min(1).max(28)

/** Số lượng thập phân lưu dạng chuỗi để không mất chính xác (0.00125 BTC, 0.5 chỉ vàng). */
export const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, 'Số lượng không hợp lệ')

export const nullableText = (max: number) => z.string().trim().max(max).nullable()

/** Trường mà mọi bản ghi lưu trữ đều có. */
export const timestampsShape = {
  createdAt: datetimeSchema,
  updatedAt: datetimeSchema,
}
