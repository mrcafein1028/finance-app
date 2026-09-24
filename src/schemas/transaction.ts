import { z } from 'zod'
import { idSchema, isoDateSchema, nullableText, positiveMoneySchema, timestampsShape } from './common'

export const TRANSACTION_TYPES = ['income', 'expense', 'refund', 'transfer', 'adjustment'] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

const tagsSchema = z.array(z.string().trim().min(1).max(30)).max(10, 'Tối đa 10 thẻ')

/**
 * Phần "nội dung" của giao dịch — dùng chung cho giao dịch thật và mẫu giao dịch định kỳ.
 * Trường không áp dụng cho một loại được cố định là null để dữ liệu luôn đồng dạng (docs/03 §3.5).
 */
const bodyBase = {
  amount: positiveMoneySchema,
  accountId: idSchema,
  note: nullableText(200),
  tags: tagsSchema,
}

const categorized = <T extends 'income' | 'expense' | 'refund'>(type: T) =>
  z.object({
    ...bodyBase,
    type: z.literal(type),
    categoryId: idSchema,
    toAccountId: z.null(),
    direction: z.null(),
  })

const transferBody = z.object({
  ...bodyBase,
  type: z.literal('transfer'),
  categoryId: z.null(),
  toAccountId: idSchema,
  direction: z.null(),
})

const adjustmentBody = z.object({
  ...bodyBase,
  type: z.literal('adjustment'),
  categoryId: z.null(),
  toAccountId: z.null(),
  direction: z.enum(['up', 'down']),
})

const bodies = [categorized('income'), categorized('expense'), categorized('refund'), transferBody, adjustmentBody] as const

const noSelfTransfer = (t: { type: string; accountId: string; toAccountId: string | null }, ctx: z.RefinementCtx) => {
  if (t.type === 'transfer' && t.accountId === t.toAccountId) {
    ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Tài khoản nguồn và đích phải khác nhau' })
  }
}

export const transactionTemplateSchema = z.discriminatedUnion('type', bodies).superRefine(noSelfTransfer)

const metaShape = {
  id: idSchema,
  date: isoDateSchema,
  groupId: idSchema.nullable(),
  origin: z.enum(['manual', 'recurring', 'system']),
  recurringRuleId: idSchema.nullable(),
  /** Khóa chống trùng cho giao dịch do hệ thống sinh, VD `recurring:<ruleId>:<date>`. */
  idempotencyKey: z.string().min(1).nullable(),
  ...timestampsShape,
}

export const transactionSchema = z
  .discriminatedUnion('type', [
    bodies[0].extend(metaShape),
    bodies[1].extend(metaShape),
    bodies[2].extend(metaShape),
    bodies[3].extend(metaShape),
    bodies[4].extend(metaShape),
  ])
  .superRefine(noSelfTransfer)

export type TransactionTemplate = z.infer<typeof transactionTemplateSchema>
export type Transaction = z.infer<typeof transactionSchema>
export type TransactionOf<T extends TransactionType> = Extract<Transaction, { type: T }>
