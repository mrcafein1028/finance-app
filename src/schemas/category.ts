import { z } from 'zod'
import { datetimeSchema, idSchema, timestampsShape } from './common'

export const CATEGORY_TYPES = ['income', 'expense'] as const
export const BUDGET_BUCKETS = ['needs', 'wants', 'savings'] as const

/**
 * Danh mục hệ thống mà các nghiệp vụ tự động cần tìm theo khóa cố định (không theo tên,
 * vì người dùng được đổi tên). Không xóa và không đổi type được (docs/03 §3.4).
 */
export const SYSTEM_CATEGORY_KEYS = [
  'loan_interest',
  'prepayment_fee',
  'bank_fee',
  'investment_fee_tax',
  'savings_interest',
  'investment_income',
] as const

export type CategoryType = (typeof CATEGORY_TYPES)[number]
export type BudgetBucket = (typeof BUDGET_BUCKETS)[number]
export type SystemCategoryKey = (typeof SYSTEM_CATEGORY_KEYS)[number]

export const categorySchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1, 'Nhập tên danh mục').max(40, 'Tên tối đa 40 ký tự'),
    type: z.enum(CATEGORY_TYPES),
    parentId: idSchema.nullable(),
    bucket: z.enum(BUDGET_BUCKETS).nullable(),
    isSystem: z.boolean(),
    systemKey: z.enum(SYSTEM_CATEGORY_KEYS).nullable(),
    archivedAt: datetimeSchema.nullable(),
    icon: z.string().max(40).nullable(),
    color: z.string().max(20).nullable(),
    sortOrder: z.number().int(),
    ...timestampsShape,
  })
  .superRefine((c, ctx) => {
    if (c.type === 'income' && c.bucket !== null) {
      ctx.addIssue({ code: 'custom', path: ['bucket'], message: 'Danh mục thu không có nhóm 50/30/20' })
    }
    if (c.parentId === c.id) {
      ctx.addIssue({ code: 'custom', path: ['parentId'], message: 'Danh mục không thể là cha của chính nó' })
    }
    if (c.isSystem !== (c.systemKey !== null)) {
      ctx.addIssue({ code: 'custom', path: ['systemKey'], message: 'Danh mục hệ thống phải có systemKey và ngược lại' })
    }
  })

export type Category = z.infer<typeof categorySchema>
