import type { LoanRateType } from '../../schemas'

export const RATE_TYPES: { value: LoanRateType; label: string }[] = [
  { value: 'equal_principal', label: 'Gốc đều, lãi giảm dần (vay nhà/xe)' },
  { value: 'annuity', label: 'Trả đều mỗi tháng' },
  { value: 'flat', label: 'Lãi phẳng trên gốc ban đầu (vay tiêu dùng)' },
  { value: 'zero', label: 'Không lãi (vay người thân, trả góp 0%)' },
]

export const LOAN_KINDS = [
  { value: 'loan', label: 'Vay ngân hàng / công ty tài chính' },
  { value: 'bnpl', label: 'Trả góp / mua trước trả sau' },
  { value: 'personal_debt', label: 'Vay người thân' },
] as const

/** 0.095 → "9,5" để điền sẵn vào ô phần trăm. */
export const percentText = (rate: number) => String(Math.round(rate * 1e6) / 1e4).replace('.', ',')
