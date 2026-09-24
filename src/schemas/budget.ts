import { z } from 'zod'
import { datetimeSchema, idSchema, monthKeySchema, moneySchema, nullableText, timestampsShape } from './common'

export const BUDGET_MODES = ['standard', 'zero_based'] as const
export type BudgetMode = (typeof BUDGET_MODES)[number]

export const budgetMonthSchema = z
  .object({
    id: idSchema,
    month: monthKeySchema,
    mode: z.enum(BUDGET_MODES),
    expectedIncome: moneySchema,
    status: z.enum(['open', 'closed']),
    closedAt: datetimeSchema.nullable(),
    note: nullableText(500),
    ...timestampsShape,
  })
  .superRefine((m, ctx) => {
    if ((m.status === 'closed') !== (m.closedAt !== null)) {
      ctx.addIssue({ code: 'custom', path: ['closedAt'], message: 'Tháng đã đóng phải có thời điểm đóng' })
    }
  })

export const budgetTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('category'), categoryId: idSchema }),
  z.object({ kind: z.literal('account'), accountId: idSchema }),
])

export type BudgetTarget = z.infer<typeof budgetTargetSchema>

/** Khóa phẳng cho ràng buộc unique (user_id, month, target_key) trong Postgres. */
export function budgetTargetKey(target: BudgetTarget): string {
  return target.kind === 'category' ? `c:${target.categoryId}` : `a:${target.accountId}`
}

export const budgetLineSchema = z
  .object({
    id: idSchema,
    month: monthKeySchema,
    target: budgetTargetSchema,
    targetKey: z.string(),
    planned: moneySchema,
    rollover: z.boolean(),
    ...timestampsShape,
  })
  .superRefine((l, ctx) => {
    if (l.targetKey !== budgetTargetKey(l.target)) {
      ctx.addIssue({ code: 'custom', path: ['targetKey'], message: 'targetKey không khớp target' })
    }
  })

export type BudgetMonth = z.infer<typeof budgetMonthSchema>
export type BudgetLine = z.infer<typeof budgetLineSchema>
