import { ValidationError } from '../data/errors'
import type { Repositories } from '../data/repositories'
import type { NewRecord } from '../data/repositories/base'
import { ledgerBalance } from '../domain/balance'
import { buildSchedule, loanTermsOf, prepay, remainingPeriods, scheduleFrom, type PrepaymentMode, type ScheduleRow } from '../domain/loan'
import { checkTransaction } from '../domain/validation'
import { newId } from '../lib/id'
import { nowIso } from '../lib/clock'
import type { Account, AccountOf, Category, CreditCardDetails, LoanDetails, Transaction } from '../schemas'

export type LoanAccount = AccountOf<'loan'> | AccountOf<'bnpl'> | AccountOf<'personal_debt'>
export const isLoan = (a: Account): a is LoanAccount => a.kind === 'loan' || a.kind === 'bnpl' || a.kind === 'personal_debt'

const liabilityBase = (name: string, openingBalance: number, openingDate: string, sortOrder: number, note: string | null = null) => ({
  name,
  class: 'liability' as const,
  currency: 'VND' as const,
  openingBalance,
  openingDate,
  isLiquid: false as const,
  includeInNetWorth: true,
  isEmergencyFund: false as const,
  goal: null,
  archivedAt: null,
  icon: null,
  color: null,
  note,
  sortOrder,
})

export interface LoanValues {
  kind: 'loan' | 'bnpl' | 'personal_debt'
  name: string
  details: LoanDetails
  /** 'new': vừa vay (tạo giao dịch giải ngân); 'existing': đang trả (nhập dư nợ hiện tại). */
  mode: 'new' | 'existing'
  currentBalance: number
  /** Ngày bắt đầu theo dõi với khoản vay đang trả. */
  asOf: string
  disbursementAccountId: string | null
}

/** F8 — thêm khoản vay (W12 bước 1). */
export async function createLoan(repos: Repositories, v: LoanValues, sortOrder: number): Promise<Account> {
  const isNew = v.mode === 'new'
  const account = await repos.accounts.create({
    ...liabilityBase(v.name, isNew ? 0 : v.currentBalance, isNew ? v.details.startDate : v.asOf, sortOrder),
    kind: v.kind,
    details: v.details,
  } as NewRecord<Account>)
  if (isNew && v.disbursementAccountId) {
    await repos.transactions.create({
      type: 'transfer',
      date: v.details.startDate,
      amount: v.details.originalPrincipal,
      accountId: account.id,
      toAccountId: v.disbursementAccountId,
      categoryId: null,
      direction: null,
      note: `Giải ngân ${v.name}`,
      tags: [],
      groupId: null,
      origin: 'system',
      recurringRuleId: null,
      idempotencyKey: `loan-disburse:${account.id}`,
    })
  }
  return account
}

/** F10 — thẻ tín dụng với dư nợ hiện tại. */
export const createCreditCard = (repos: Repositories, v: { name: string; balance: number; openingDate: string; details: CreditCardDetails }, sortOrder: number) =>
  repos.accounts.create({ ...liabilityBase(v.name, v.balance, v.openingDate, sortOrder), kind: 'credit_card', details: v.details } as NewRecord<Account>)

/** Ngày trả gốc gần nhất (để biết kỳ nào đã trả). */
export function lastPaymentDate(loan: Account, transactions: readonly Transaction[]): string | null {
  return transactions.filter((t) => t.type === 'transfer' && t.toAccountId === loan.id).reduce<string | null>((max, t) => (max === null || t.date > max ? t.date : max), null)
}

/** Lịch còn phải trả tính từ dư nợ hiện tại; kỳ đầu có thể đã quá hạn nếu chưa ghi trả. */
export function upcomingSchedule(loan: LoanAccount, transactions: readonly Transaction[], today: string): ScheduleRow[] {
  const outstanding = ledgerBalance(loan, transactions.filter((t) => t.accountId === loan.id || t.toAccountId === loan.id), '9999-12-31')
  const asOf = lastPaymentDate(loan, transactions) ?? (loan.openingDate < today ? loan.openingDate : today)
  return scheduleFrom(loanTermsOf(loan.details), outstanding, asOf)
}

/** Lịch đầy đủ từ đầu khoản vay (theo gốc ban đầu) — cho bảng lịch & biểu đồ gốc/lãi. */
export const fullSchedule = (loan: LoanAccount) => buildSchedule(loanTermsOf(loan.details))

export interface PaymentValues {
  date: string
  sourceAccountId: string
  principal: number
  interest: number
  fee: number
}

interface PaymentContext {
  accounts: readonly Account[]
  categories: readonly Category[]
  transactions: readonly Transaction[]
  today: string
}

/**
 * W12 bước 3 — ghi một kỳ trả nợ = chuyển gốc + chi lãi + chi phí (cùng groupId, ghi trong MỘT
 * transaction bằng hàm SQL). Trả hết dư nợ → tự lưu trữ khoản vay.
 */
export async function recordLoanPayment(repos: Repositories, loan: LoanAccount, v: PaymentValues, ctx: PaymentContext): Promise<{ paidOff: boolean }> {
  if (v.principal + v.interest + v.fee <= 0) throw new ValidationError([{ path: 'principal', message: 'Tổng số tiền trả phải lớn hơn 0' }])
  const prepaymentFee = ctx.categories.find((c) => c.systemKey === 'prepayment_fee')
  const groupId = newId()
  const meta = () => ({ id: newId(), date: v.date, tags: [], groupId, origin: 'manual' as const, recurringRuleId: null, idempotencyKey: null, createdAt: nowIso(), updatedAt: nowIso() })
  const rows: Transaction[] = []
  if (v.principal > 0) rows.push({ ...meta(), type: 'transfer', amount: v.principal, accountId: v.sourceAccountId, toAccountId: loan.id, categoryId: null, direction: null, note: `Trả gốc ${loan.name}` })
  if (v.interest > 0) rows.push({ ...meta(), type: 'expense', amount: v.interest, accountId: v.sourceAccountId, categoryId: loan.details.interestCategoryId, toAccountId: null, direction: null, note: `Lãi ${loan.name}` })
  if (v.fee > 0) {
    if (!prepaymentFee) throw new ValidationError([{ path: 'fee', message: 'Thiếu danh mục hệ thống "Phí trả nợ trước hạn"' }])
    rows.push({ ...meta(), type: 'expense', amount: v.fee, accountId: v.sourceAccountId, categoryId: prepaymentFee.id, toAccountId: null, direction: null, note: `Phí ${loan.name}` })
  }
  // Mỗi phần qua cùng bộ kiểm tra của form giao dịch (ngày mở tài khoản, trả vượt dư nợ, tiền mặt âm…).
  let others: Transaction[] = [...ctx.transactions]
  for (const row of rows) {
    const { errors } = checkTransaction(row, { accounts: ctx.accounts, categories: ctx.categories, transactions: others, today: ctx.today })
    if (errors.length) throw new ValidationError(errors.map((e) => ({ path: e.path === 'amount' ? 'principal' : e.path, message: e.message })))
    others = [...others, row]
  }
  await repos.transactions.saveGroup(groupId, rows)
  const remaining = ledgerBalance(loan, others.filter((t) => t.accountId === loan.id || t.toAccountId === loan.id), '9999-12-31')
  if (remaining === 0) await repos.accounts.update(loan.id, { archivedAt: nowIso() })
  return { paidOff: remaining === 0 }
}

/** So sánh trước khi trả trước (W12 bước 4). */
export function previewPrepayment(loan: LoanAccount, outstanding: number, date: string, amount: number, mode: PrepaymentMode) {
  return prepay(loanTermsOf(loan.details), outstanding, date, amount, mode, loan.details.prepaymentFeeRate)
}

/** Trả trước: ghi như một kỳ trả (gốc + phí), "giảm kỳ hạn" thì rút ngắn số kỳ của khoản vay. */
export async function prepayLoan(repos: Repositories, loan: LoanAccount, v: { date: string; sourceAccountId: string; amount: number; mode: PrepaymentMode; outstanding: number }, ctx: PaymentContext) {
  const preview = previewPrepayment(loan, v.outstanding, v.date, v.amount, v.mode)
  const result = await recordLoanPayment(repos, loan, { date: v.date, sourceAccountId: v.sourceAccountId, principal: v.amount, interest: 0, fee: preview.fee }, ctx)
  if (!result.paidOff && v.mode === 'reduce_term') {
    const { firstSeq } = remainingPeriods(loanTermsOf(loan.details), v.date)
    await repos.accounts.update(loan.id, { details: { ...loan.details, termMonths: firstSeq - 1 + preview.after.length } } as never)
  }
  return { ...result, preview }
}

/** W12 bước 5 — lãi suất mới áp dụng từ ngày `from` (hết ưu đãi / thả nổi). */
export async function changeLoanRate(repos: Repositories, loan: LoanAccount, from: string, annualRate: number) {
  if (from <= loan.details.startDate) throw new ValidationError([{ path: 'from', message: 'Ngày áp dụng phải sau ngày giải ngân' }])
  const ratePeriods = [...loan.details.ratePeriods.filter((p) => p.from !== from), { from, annualRate }].sort((a, b) => a.from.localeCompare(b.from))
  return repos.accounts.update(loan.id, { details: { ...loan.details, ratePeriods } } as never)
}
