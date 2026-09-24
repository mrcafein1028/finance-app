import { z } from 'zod'
import { BUDGET_MODES } from './budget'
import { dayOfMonthSchema, datetimeSchema } from './common'

/** Cài đặt của người dùng hiện tại. Khóa chính ở DB là user_id (RLS), không có trong kiểu này. */
export const settingsSchema = z
  .object({
    currency: z.literal('VND'),
    locale: z.literal('vi-VN'),
    periodStartDay: dayOfMonthSchema,
    defaultBudgetMode: z.enum(BUDGET_MODES),
    includeAccruedInterest: z.boolean(),
    /** Cho phép phần vượt ngân sách tháng trước trừ vào tháng sau. */
    allowNegativeRollover: z.boolean(),
    alertThresholds: z.tuple([z.number().gt(0).lt(1), z.number().gt(0)]),
    emergencyTargetMonths: z.number().int().min(1).max(24),
    theme: z.enum(['system', 'light', 'dark']),
    onboardingCompleted: z.boolean(),
    lastBackupAt: datetimeSchema.nullable(),
    schemaVersion: z.number().int().min(1),
  })
  .superRefine((s, ctx) => {
    if (s.alertThresholds[0] >= s.alertThresholds[1]) {
      ctx.addIssue({ code: 'custom', path: ['alertThresholds'], message: 'Ngưỡng cảnh báo phải nhỏ hơn ngưỡng vượt' })
    }
  })

export type Settings = z.infer<typeof settingsSchema>
