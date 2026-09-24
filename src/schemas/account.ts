import { z } from 'zod'
import {
  dayOfMonthSchema,
  datetimeSchema,
  idSchema,
  isoDateSchema,
  moneySchema,
  nullableText,
  positiveMoneySchema,
  rateSchema,
  timestampsShape,
} from './common'

export const ASSET_KINDS = ['cash', 'bank', 'ewallet', 'goal_fund', 'term_deposit', 'investment', 'other_asset'] as const
export const LIABILITY_KINDS = ['loan', 'credit_card', 'bnpl', 'personal_debt'] as const
export const ACCOUNT_KINDS = [...ASSET_KINDS, ...LIABILITY_KINDS] as const

export type AssetKind = (typeof ASSET_KINDS)[number]
export type LiabilityKind = (typeof LIABILITY_KINDS)[number]
export type AccountKind = (typeof ACCOUNT_KINDS)[number]
export type AccountClass = 'asset' | 'liability'

export const accountKindSchema = z.enum(ACCOUNT_KINDS)

/** Thuộc tính mặc định theo loại (docs/03 §3.2). */
export const KIND_META: Record<AccountKind, { class: AccountClass; label: string; isLiquid: boolean }> = {
  cash: { class: 'asset', label: 'Tiền mặt', isLiquid: true },
  bank: { class: 'asset', label: 'Tài khoản ngân hàng', isLiquid: true },
  ewallet: { class: 'asset', label: 'Ví điện tử', isLiquid: true },
  goal_fund: { class: 'asset', label: 'Quỹ mục tiêu', isLiquid: true },
  term_deposit: { class: 'asset', label: 'Tiết kiệm có kỳ hạn', isLiquid: false },
  investment: { class: 'asset', label: 'Tài khoản đầu tư', isLiquid: false },
  other_asset: { class: 'asset', label: 'Tài sản khác', isLiquid: false },
  loan: { class: 'liability', label: 'Khoản vay', isLiquid: false },
  credit_card: { class: 'liability', label: 'Thẻ tín dụng', isLiquid: false },
  bnpl: { class: 'liability', label: 'Trả góp', isLiquid: false },
  personal_debt: { class: 'liability', label: 'Vay người thân', isLiquid: false },
}

// ---------- details theo kind (docs/03 §3.3) ----------

export const termDepositDetailsSchema = z.object({
  bankName: z.string().trim().min(1, 'Nhập tên ngân hàng').max(60),
  interestPayout: z.enum(['at_maturity', 'monthly', 'upfront']),
  maturityAction: z.enum(['renew_principal', 'renew_with_interest', 'withdraw']),
  payoutAccountId: idSchema,
  earlyWithdrawalRate: rateSchema,
  dayCountBasis: z.literal(365),
})

export const investmentDetailsSchema = z.object({
  platform: nullableText(60),
  costMethod: z.literal('average'),
})

export const LOAN_RATE_TYPES = ['equal_principal', 'annuity', 'flat', 'zero'] as const

export const ratePeriodSchema = z.object({
  from: isoDateSchema,
  annualRate: z.number().min(0).max(0.6, 'Lãi suất tối đa 60%/năm'),
})

export const loanDetailsSchema = z
  .object({
    lender: nullableText(60),
    originalPrincipal: positiveMoneySchema,
    rateType: z.enum(LOAN_RATE_TYPES),
    ratePeriods: z.array(ratePeriodSchema).min(1, 'Cần ít nhất một mức lãi suất'),
    termMonths: z.number().int().min(1).max(420),
    startDate: isoDateSchema,
    paymentDay: dayOfMonthSchema,
    prepaymentFeeRate: z.number().min(0).max(0.1),
    interestCategoryId: idSchema,
  })
  .superRefine((d, ctx) => {
    if (d.ratePeriods[0]?.from !== d.startDate) {
      ctx.addIssue({ code: 'custom', path: ['ratePeriods', 0, 'from'], message: 'Mức lãi đầu tiên phải bắt đầu từ ngày giải ngân' })
    }
    for (let i = 1; i < d.ratePeriods.length; i++) {
      if (d.ratePeriods[i]!.from <= d.ratePeriods[i - 1]!.from) {
        ctx.addIssue({ code: 'custom', path: ['ratePeriods', i, 'from'], message: 'Các mốc lãi suất phải tăng dần theo ngày' })
      }
    }
    if (d.rateType === 'zero' && d.ratePeriods.some((p) => p.annualRate !== 0)) {
      ctx.addIssue({ code: 'custom', path: ['ratePeriods'], message: 'Khoản vay không lãi phải có lãi suất 0%' })
    }
  })

export const creditCardDetailsSchema = z.object({
  issuer: nullableText(60),
  creditLimit: positiveMoneySchema,
  statementDay: dayOfMonthSchema,
  dueDay: dayOfMonthSchema,
  annualRate: z.number().min(0).max(0.6),
  minPaymentRate: z.number().min(0).max(1),
})

// ---------- account ----------

export const accountGoalSchema = z.object({
  targetAmount: positiveMoneySchema,
  targetDate: isoDateSchema.nullable(),
})

const accountBase = z.object({
  id: idSchema,
  name: z.string().trim().min(1, 'Nhập tên').max(50, 'Tên tối đa 50 ký tự'),
  currency: z.literal('VND'),
  openingBalance: moneySchema,
  openingDate: isoDateSchema,
  isLiquid: z.boolean(),
  includeInNetWorth: z.boolean(),
  isEmergencyFund: z.boolean(),
  goal: accountGoalSchema.nullable(),
  archivedAt: datetimeSchema.nullable(),
  icon: z.string().max(40).nullable(),
  color: z.string().max(20).nullable(),
  note: nullableText(500),
  sortOrder: z.number().int(),
  ...timestampsShape,
})

const assetAccount = <K extends AssetKind, D extends z.ZodType>(kind: K, details: D) =>
  accountBase.extend({ kind: z.literal(kind), class: z.literal('asset'), details })

// Khoản nợ không có mục tiêu tích lũy và không thể là quỹ khẩn cấp.
const liabilityAccount = <K extends LiabilityKind, D extends z.ZodType>(kind: K, details: D) =>
  accountBase.extend({
    kind: z.literal(kind),
    class: z.literal('liability'),
    details,
    isLiquid: z.literal(false),
    isEmergencyFund: z.literal(false),
    goal: z.null(),
  })

export const accountSchema = z.discriminatedUnion('kind', [
  assetAccount('cash', z.null()),
  assetAccount('bank', z.null()),
  assetAccount('ewallet', z.null()),
  assetAccount('goal_fund', z.null()),
  assetAccount('term_deposit', termDepositDetailsSchema),
  assetAccount('investment', investmentDetailsSchema),
  assetAccount('other_asset', z.null()),
  liabilityAccount('loan', loanDetailsSchema),
  liabilityAccount('credit_card', creditCardDetailsSchema),
  liabilityAccount('bnpl', loanDetailsSchema),
  liabilityAccount('personal_debt', loanDetailsSchema),
])

export type Account = z.infer<typeof accountSchema>
export type AccountOf<K extends AccountKind> = Extract<Account, { kind: K }>
export type TermDepositDetails = z.infer<typeof termDepositDetailsSchema>
export type InvestmentDetails = z.infer<typeof investmentDetailsSchema>
export type LoanDetails = z.infer<typeof loanDetailsSchema>
export type CreditCardDetails = z.infer<typeof creditCardDetailsSchema>
export type LoanRateType = (typeof LOAN_RATE_TYPES)[number]
