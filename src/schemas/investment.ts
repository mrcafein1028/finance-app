import { z } from 'zod'
import { datetimeSchema, decimalStringSchema, idSchema, isoDateSchema, moneySchema, timestampsShape } from './common'

export const HOLDING_ASSET_TYPES = ['stock', 'fund', 'gold', 'crypto', 'bond', 'other'] as const
export type HoldingAssetType = (typeof HOLDING_ASSET_TYPES)[number]

export const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9._-]{1,20}$/, 'Mã chỉ gồm chữ in hoa, số và . _ - (tối đa 20 ký tự)')

export const holdingSchema = z.object({
  id: idSchema,
  accountId: idSchema,
  symbol: symbolSchema,
  name: z.string().trim().min(1).max(80),
  assetType: z.enum(HOLDING_ASSET_TYPES),
  unit: z.string().trim().min(1).max(20),
  quantityDecimals: z.number().int().min(0).max(8),
  ...timestampsShape,
})

export const investmentTradeSchema = z
  .object({
    id: idSchema,
    holdingId: idSchema,
    date: isoDateSchema,
    side: z.enum(['buy', 'sell']),
    quantity: decimalStringSchema.refine((q) => Number(q) > 0, 'Số lượng phải lớn hơn 0'),
    price: moneySchema,
    fee: moneySchema,
    tax: moneySchema,
    cashAccountId: idSchema,
    /** Vị thế đã có trước khi dùng app: ghi nhận giá vốn nhưng không trừ tiền mặt. */
    isOpening: z.boolean(),
    groupId: idSchema.nullable(),
    ...timestampsShape,
  })
  .superRefine((t, ctx) => {
    if (t.isOpening && t.side !== 'buy') {
      ctx.addIssue({ code: 'custom', path: ['isOpening'], message: 'Vị thế đầu kỳ phải là lệnh mua' })
    }
  })

export const priceQuoteSchema = z.object({
  id: idSchema,
  symbol: symbolSchema,
  date: isoDateSchema,
  price: moneySchema,
  createdAt: datetimeSchema,
})

export type Holding = z.infer<typeof holdingSchema>
export type InvestmentTrade = z.infer<typeof investmentTradeSchema>
export type PriceQuote = z.infer<typeof priceQuoteSchema>
