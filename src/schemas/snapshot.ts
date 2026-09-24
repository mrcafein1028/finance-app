import { z } from 'zod'
import { accountKindSchema } from './account'
import { datetimeSchema, idSchema, isoDateSchema, monthKeySchema, moneySchema, signedMoneySchema } from './common'

/** Cache net worth cuối kỳ — luôn tính lại được từ dữ liệu gốc (docs/03 §3.11). */
export const netWorthSnapshotSchema = z.object({
  id: idSchema,
  month: monthKeySchema,
  asOf: isoDateSchema,
  totalAssets: moneySchema,
  totalLiabilities: moneySchema,
  netWorth: signedMoneySchema,
  liquidAssets: moneySchema,
  // Có dấu: tài khoản ngân hàng thấu chi có giá trị âm (các tổng ở trên vẫn ≥ 0, xem domain/networth.ts).
  byKind: z.partialRecord(accountKindSchema, signedMoneySchema),
  byAccount: z.record(z.string(), signedMoneySchema),
  computedAt: datetimeSchema,
  stale: z.boolean(),
})

export type NetWorthSnapshot = z.infer<typeof netWorthSnapshotSchema>
