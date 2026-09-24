import { z } from 'zod'
import { datetimeSchema, idSchema, isoDateSchema, timestampsShape } from './common'
import { transactionTemplateSchema } from './transaction'

export const recurringRuleSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1, 'Nhập tên').max(60),
    template: transactionTemplateSchema,
    frequency: z.enum(['weekly', 'monthly', 'yearly']),
    /** Lặp mỗi N tuần/tháng/năm. */
    intervalCount: z.number().int().min(1).max(12),
    /** 1–31; 31 nghĩa là "ngày cuối tháng". Chỉ dùng với monthly/yearly. */
    dayOfMonth: z.number().int().min(1).max(31).nullable(),
    startDate: isoDateSchema,
    endDate: isoDateSchema.nullable(),
    nextDate: isoDateSchema,
    mode: z.enum(['auto', 'confirm']),
    pausedAt: datetimeSchema.nullable(),
    ...timestampsShape,
  })
  .superRefine((r, ctx) => {
    if (r.endDate !== null && r.endDate <= r.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Ngày kết thúc phải sau ngày bắt đầu' })
    }
    if (r.frequency === 'weekly' && r.dayOfMonth !== null) {
      ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'Lặp theo tuần không dùng ngày trong tháng' })
    }
    if (r.frequency !== 'weekly' && r.dayOfMonth === null) {
      ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'Chọn ngày trong tháng' })
    }
  })

export type RecurringRule = z.infer<typeof recurringRuleSchema>
