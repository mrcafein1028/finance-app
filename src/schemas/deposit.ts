import { z } from 'zod'
import { datetimeSchema, idSchema, isoDateSchema, moneySchema, nullableText, positiveMoneySchema, timestampsShape } from './common'

/** Một kỳ của sổ tiết kiệm; mỗi lần tái tục tạo seq mới (docs/03 §3.7). */
export const depositTermSchema = z
  .object({
    id: idSchema,
    accountId: idSchema,
    seq: z.number().int().min(1),
    principal: positiveMoneySchema,
    annualRate: z.number().min(0).max(0.2, 'Lãi suất tiết kiệm tối đa 20%/năm'),
    termMonths: z.number().int().min(1).max(120),
    startDate: isoDateSchema,
    maturityDate: isoDateSchema,
    status: z.enum(['active', 'matured', 'withdrawn_early']),
    interestPaid: moneySchema,
    closedAt: isoDateSchema.nullable(),
    ...timestampsShape,
  })
  .superRefine((t, ctx) => {
    if (t.maturityDate <= t.startDate) {
      ctx.addIssue({ code: 'custom', path: ['maturityDate'], message: 'Ngày đáo hạn phải sau ngày mở' })
    }
    if ((t.status === 'active') !== (t.closedAt === null)) {
      ctx.addIssue({ code: 'custom', path: ['closedAt'], message: 'Chỉ kỳ đã đóng mới có ngày đóng' })
    }
  })

/** Định giá tài sản khác (nhà, xe) theo ngày (docs/03 §3.8). */
export const assetValuationSchema = z.object({
  id: idSchema,
  accountId: idSchema,
  date: isoDateSchema,
  value: moneySchema,
  note: nullableText(200),
  createdAt: datetimeSchema,
})

export type DepositTerm = z.infer<typeof depositTermSchema>
export type AssetValuation = z.infer<typeof assetValuationSchema>
