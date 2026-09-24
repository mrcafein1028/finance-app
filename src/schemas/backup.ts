import { z } from 'zod'
import { accountSchema } from './account'
import { budgetLineSchema, budgetMonthSchema } from './budget'
import { categorySchema } from './category'
import { datetimeSchema } from './common'
import { assetValuationSchema, depositTermSchema } from './deposit'
import { holdingSchema, investmentTradeSchema, priceQuoteSchema } from './investment'
import { recurringRuleSchema } from './recurring'
import { settingsSchema } from './settings'
import { netWorthSnapshotSchema } from './snapshot'
import { transactionSchema } from './transaction'

export const APP_ID = 'tai-chinh-ca-nhan'
export const CURRENT_SCHEMA_VERSION = 1

/** Schema của từng bảng — nguồn duy nhất cho DB, validate ghi và file sao lưu. */
export const TABLE_SCHEMAS = {
  settings: settingsSchema,
  accounts: accountSchema,
  categories: categorySchema,
  transactions: transactionSchema,
  holdings: holdingSchema,
  investmentTrades: investmentTradeSchema,
  priceQuotes: priceQuoteSchema,
  depositTerms: depositTermSchema,
  assetValuations: assetValuationSchema,
  budgetMonths: budgetMonthSchema,
  budgetLines: budgetLineSchema,
  recurringRules: recurringRuleSchema,
  netWorthSnapshots: netWorthSnapshotSchema,
} as const

export type TableName = keyof typeof TABLE_SCHEMAS
export const TABLE_NAMES = Object.keys(TABLE_SCHEMAS) as TableName[]

export const backupFileSchema = z.object({
  app: z.literal(APP_ID, { error: 'Không phải file sao lưu của ứng dụng này' }),
  schemaVersion: z
    .number()
    .int()
    .min(1)
    .max(CURRENT_SCHEMA_VERSION, 'File được tạo bởi phiên bản mới hơn của ứng dụng — hãy cập nhật ứng dụng'),
  exportedAt: datetimeSchema,
  data: z.object({
    settings: z.array(TABLE_SCHEMAS.settings).max(1),
    accounts: z.array(TABLE_SCHEMAS.accounts),
    categories: z.array(TABLE_SCHEMAS.categories),
    transactions: z.array(TABLE_SCHEMAS.transactions),
    holdings: z.array(TABLE_SCHEMAS.holdings),
    investmentTrades: z.array(TABLE_SCHEMAS.investmentTrades),
    priceQuotes: z.array(TABLE_SCHEMAS.priceQuotes),
    depositTerms: z.array(TABLE_SCHEMAS.depositTerms),
    assetValuations: z.array(TABLE_SCHEMAS.assetValuations),
    budgetMonths: z.array(TABLE_SCHEMAS.budgetMonths),
    budgetLines: z.array(TABLE_SCHEMAS.budgetLines),
    recurringRules: z.array(TABLE_SCHEMAS.recurringRules),
    netWorthSnapshots: z.array(TABLE_SCHEMAS.netWorthSnapshots),
  }),
})

export type BackupFile = z.infer<typeof backupFileSchema>
