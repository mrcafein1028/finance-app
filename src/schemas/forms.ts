import { z } from 'zod'
import { parseMoneyInput } from '../lib/format'
import { isoDateSchema } from './common'

// Schema của FORM (dữ liệu người dùng gõ, dạng chuỗi) → chuyển thành dữ liệu nghiệp vụ.
// Tách khỏi schema bản ghi để thông báo lỗi sát với từng ô nhập (docs/06).

function parseMoneyField(raw: string, allowZero: boolean, ctx: z.RefinementCtx): number {
  const value = parseMoneyInput(raw)
  if (value === null) {
    ctx.addIssue({ code: 'custom', message: 'Số tiền không hợp lệ (VD: 150000, 150k, 2,5tr)' })
    return z.NEVER
  }
  if (value === 0 && !allowZero) {
    ctx.addIssue({ code: 'custom', message: 'Số tiền phải lớn hơn 0' })
    return z.NEVER
  }
  return value
}

/** Ô số tiền bắt buộc: hiểu "150k", "2,5tr", "1.234.567" (docs/06 MoneyInput). */
export const moneyText = ({ allowZero = false } = {}) =>
  z.string().transform((raw, ctx) => {
    if (raw.trim() === '') {
      ctx.addIssue({ code: 'custom', message: 'Nhập số tiền' })
      return z.NEVER
    }
    return parseMoneyField(raw, allowZero, ctx)
  })

/** Ô số tiền không bắt buộc: để trống → null. */
export const optionalMoneyText = () =>
  z.string().transform((raw, ctx): number | null => (raw.trim() === '' ? null : parseMoneyField(raw, false, ctx)))

export const TRANSACTION_FORM_TYPES = ['expense', 'income', 'transfer', 'refund'] as const
export type TransactionFormType = (typeof TRANSACTION_FORM_TYPES)[number]

export const transactionFormSchema = z
  .object({
    type: z.enum(TRANSACTION_FORM_TYPES),
    amount: moneyText(),
    date: isoDateSchema,
    accountId: z.string().min(1, 'Chọn tài khoản'),
    toAccountId: z.string(),
    categoryId: z.string(),
    note: z.string().trim().max(200, 'Ghi chú tối đa 200 ký tự'),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'transfer') {
      if (!v.toAccountId) ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Chọn tài khoản nhận' })
      else if (v.toAccountId === v.accountId) ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Tài khoản nguồn và đích phải khác nhau' })
    } else if (!v.categoryId) {
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Chọn danh mục' })
    }
  })

export type TransactionFormInput = z.input<typeof transactionFormSchema>
export type TransactionFormValues = z.output<typeof transactionFormSchema>

export const CASH_LIKE_KINDS = ['cash', 'bank', 'ewallet', 'goal_fund'] as const
export type CashLikeKind = (typeof CASH_LIKE_KINDS)[number]

/** Form tài khoản tiền / quỹ mục tiêu (docs/06 F2). `today` để chặn ngày bắt đầu ở tương lai. */
export const accountFormSchema = (today: string) =>
  z
    .object({
      name: z.string().trim().min(1, 'Nhập tên').max(50, 'Tên tối đa 50 ký tự'),
      kind: z.enum(CASH_LIKE_KINDS),
      openingBalance: moneyText({ allowZero: true }),
      openingDate: isoDateSchema.refine((d) => d <= today, 'Ngày bắt đầu không được ở tương lai'),
      isEmergencyFund: z.boolean(),
      goalTarget: optionalMoneyText(),
      goalDate: z.string(),
      note: z.string().trim().max(500),
    })
    .superRefine((v, ctx) => {
      if (v.goalDate && !isoDateSchema.safeParse(v.goalDate).success) {
        ctx.addIssue({ code: 'custom', path: ['goalDate'], message: 'Ngày không hợp lệ' })
      } else if (v.goalDate && v.goalDate <= today) {
        ctx.addIssue({ code: 'custom', path: ['goalDate'], message: 'Hạn mục tiêu phải sau hôm nay' })
      }
      if (v.goalDate && v.goalTarget === null) ctx.addIssue({ code: 'custom', path: ['goalTarget'], message: 'Nhập số tiền mục tiêu' })
    })

export type AccountFormInput = z.input<ReturnType<typeof accountFormSchema>>
export type AccountFormValues = z.output<ReturnType<typeof accountFormSchema>>

/** Đối soát số dư (W4). */
export const reconcileFormSchema = z
  .object({
    actual: moneyText({ allowZero: true }),
    mode: z.enum(['adjustment', 'expense']),
    categoryId: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'expense' && !v.categoryId) ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Chọn danh mục chi' })
  })

export type ReconcileFormInput = z.input<typeof reconcileFormSchema>
export type ReconcileFormValues = z.output<typeof reconcileFormSchema>
