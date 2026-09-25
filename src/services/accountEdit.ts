import { ConflictError, ValidationError } from '../data/errors'
import type { Repositories } from '../data/repositories'
import type { NewRecord } from '../data/repositories/base'
import { addMonthsToKey } from '../domain/dates'
import { buildSchedule, loanTermsOf } from '../domain/loan'
import { maturityDateOf } from '../domain/savings'
import { minBalanceFrom } from '../domain/validation'
import { formatDate, formatMoney } from '../lib/format'
import type { Account, AccountOf, BudgetLine, CreditCardDetails, DepositTerm, Holding, InvestmentTrade, LoanDetails, RecurringRule, TermDepositDetails, Transaction } from '../schemas'
import type { LoanAccount } from './liabilities'

// Sửa thông tin đã nhập của các loại tài khoản ngoài tiền mặt / ngân hàng / ví / quỹ (loại đó dùng
// services/accounts.updateAccount). Nguyên tắc chung:
//   • Số dư ban đầu + ngày bắt đầu là gốc của MỌI số dư sau đó → sửa xong phải kiểm tra lại toàn bộ lịch sử:
//     dư nợ không được âm, tiền mặt không được âm, không có giao dịch trước ngày bắt đầu.
//   • Giao dịch hệ thống sinh lúc tạo (giải ngân khoản vay, chuyển tiền mở sổ) được sửa theo cho khớp.
//   • Ảnh chụp net worth từ tháng bị ảnh hưởng được đánh dấu để tính lại.

const touching = (id: string, transactions: readonly Transaction[]) => transactions.filter((t) => t.accountId === id || t.toAccountId === id)

/** Kiểm tra lịch sử số dư với thông tin mới. Trả về thông điệp lỗi hoặc null. */
export function historyProblem(next: Account, transactions: readonly Transaction[], ignoreTxIds: readonly string[] = []): string | null {
  const own = touching(next.id, transactions).filter((t) => !ignoreTxIds.includes(t.id))
  const first = own.reduce<string | null>((min, t) => (min === null || t.date < min ? t.date : min), null)
  if (first && first < next.openingDate) {
    return `Ngày bắt đầu theo dõi phải trước hoặc bằng giao dịch đầu tiên của tài khoản (${formatDate(first)})`
  }
  if (next.openingBalance < 0) return 'Số dư ban đầu không được âm'
  if (next.kind === 'investment' || next.kind === 'other_asset' || next.kind === 'term_deposit') return null
  const min = minBalanceFrom(next, touching(next.id, transactions), next.openingDate)
  if (min >= 0) return null
  if (next.class === 'liability') {
    return `Với dư nợ ban đầu ${formatMoney(next.openingBalance)}, các khoản đã trả sau đó vượt dư nợ ${formatMoney(-min)} — hãy kiểm tra lại số dư nợ lúc bắt đầu theo dõi`
  }
  if (next.kind === 'cash') return `Với số dư ban đầu ${formatMoney(next.openingBalance)}, tiền mặt sẽ bị âm ${formatMoney(-min)} ở một thời điểm sau đó`
  return null // ngân hàng / ví: cho phép thấu chi (đã cảnh báo lúc ghi giao dịch)
}

async function markStale(repos: Repositories, ...dates: string[]) {
  const earliest = dates.sort()[0]!
  // Lùi 1 tháng: ngày bắt đầu tháng tài chính có thể khác ngày 1.
  await repos.snapshots.markStaleFrom(addMonthsToKey(earliest.slice(0, 7), -1))
}

function assertOk(problem: string | null) {
  if (problem) throw new ValidationError([{ path: 'openingBalance', message: problem }])
}

const withMeta = <T extends Account>(account: T, patch: Partial<T>): T => ({ ...account, ...patch })
const stripMeta = (a: Account) => {
  const { id: _id, createdAt: _c, updatedAt: _u, sortOrder: _s, ...rest } = a
  return rest as Partial<NewRecord<Account>>
}

// ---------------------------------------------------------------- thẻ tín dụng

export interface CardEdit {
  name: string
  openingBalance: number
  openingDate: string
  details: CreditCardDetails
}

export async function updateCreditCard(repos: Repositories, card: AccountOf<'credit_card'>, v: CardEdit, transactions: readonly Transaction[]) {
  const next = withMeta(card, { name: v.name, openingBalance: v.openingBalance, openingDate: v.openingDate, details: v.details })
  assertOk(historyProblem(next, transactions))
  const saved = await repos.accounts.update(card.id, stripMeta(next))
  await markStale(repos, card.openingDate, v.openingDate)
  return saved
}

// ---------------------------------------------------------------- khoản vay / trả góp / vay người thân

/** Giao dịch giải ngân tạo lúc thêm khoản vay kiểu "Vừa vay" (null = khoản vay đang trả từ trước). */
export const disbursementOf = (loan: Account, transactions: readonly Transaction[]) =>
  transactions.find((t) => t.idempotencyKey === `loan-disburse:${loan.id}`) ?? null

export interface LoanEdit {
  kind: LoanAccount['kind']
  name: string
  lender: string | null
  originalPrincipal: number
  /** Chỉ dùng với khoản vay "đang trả": dư nợ lúc bắt đầu theo dõi. */
  openingBalance: number
  openingDate: string
  rateType: LoanDetails['rateType']
  /** Lãi suất từ ngày giải ngân; các mốc đổi lãi sau đó được giữ nguyên. */
  annualRate: number
  termMonths: number
  startDate: string
  paymentDay: number
  prepaymentFeeRate: number
}

export async function updateLoan(repos: Repositories, loan: LoanAccount, v: LoanEdit, transactions: readonly Transaction[]) {
  const later = loan.details.ratePeriods.filter((p) => p.from > v.startDate)
  const annualRate = v.rateType === 'zero' ? 0 : v.annualRate
  const details: LoanDetails = {
    ...loan.details,
    lender: v.lender,
    originalPrincipal: v.originalPrincipal,
    rateType: v.rateType,
    ratePeriods: [{ from: v.startDate, annualRate }, ...(v.rateType === 'zero' ? [] : later)],
    termMonths: v.termMonths,
    startDate: v.startDate,
    paymentDay: v.paymentDay,
    prepaymentFeeRate: v.prepaymentFeeRate,
  }
  try {
    buildSchedule(loanTermsOf(details))
  } catch (e) {
    throw new ValidationError([{ path: 'details', message: (e as Error).message }])
  }

  const disbursement = disbursementOf(loan, transactions)
  // "Vừa vay": dư nợ đến từ giao dịch giải ngân → sửa số tiền / ngày của chính giao dịch đó.
  const openingBalance = disbursement ? 0 : v.openingBalance
  const openingDate = disbursement ? v.startDate : v.openingDate
  if (!disbursement && openingBalance > v.originalPrincipal) {
    throw new ValidationError([{ path: 'openingBalance', message: 'Dư nợ lúc bắt đầu theo dõi không được lớn hơn số tiền vay ban đầu' }])
  }
  if (!disbursement && openingBalance <= 0) throw new ValidationError([{ path: 'openingBalance', message: 'Nhập dư nợ lúc bắt đầu theo dõi' }])
  const next = withMeta(loan, { kind: v.kind, name: v.name, openingBalance, openingDate, details } as Partial<LoanAccount>)
  const simulated = disbursement ? transactions.map((t) => (t.id === disbursement.id ? { ...t, amount: v.originalPrincipal, date: v.startDate } : t)) : transactions
  assertOk(historyProblem(next, simulated))

  const saved = await repos.accounts.update(loan.id, stripMeta(next))
  if (disbursement && (disbursement.amount !== v.originalPrincipal || disbursement.date !== v.startDate)) {
    await repos.transactions.update(disbursement.id, { amount: v.originalPrincipal, date: v.startDate })
  }
  await markStale(repos, loan.openingDate, openingDate)
  return saved
}

// ---------------------------------------------------------------- đầu tư & tài sản khác

export interface SimpleAssetEdit {
  name: string
  openingBalance: number
  openingDate: string
  note?: string | null
  platform?: string | null
}

export async function updateInvestmentAccount(repos: Repositories, acc: AccountOf<'investment'>, v: SimpleAssetEdit, transactions: readonly Transaction[], trades: readonly InvestmentTrade[]) {
  const next = withMeta(acc, { name: v.name, openingBalance: v.openingBalance, openingDate: v.openingDate, details: { ...acc.details, platform: v.platform ?? null } })
  assertOk(historyProblem(next, transactions))
  const firstTrade = trades.filter((t) => t.cashAccountId === acc.id).reduce<string | null>((m, t) => (m === null || t.date < m ? t.date : m), null)
  if (firstTrade && firstTrade < v.openingDate) {
    throw new ValidationError([{ path: 'openingDate', message: `Ngày bắt đầu phải trước hoặc bằng lệnh đầu tiên (${formatDate(firstTrade)})` }])
  }
  const saved = await repos.accounts.update(acc.id, stripMeta(next))
  await markStale(repos, acc.openingDate, v.openingDate)
  return saved
}

export async function updateOtherAsset(repos: Repositories, acc: AccountOf<'other_asset'>, v: SimpleAssetEdit, transactions: readonly Transaction[]) {
  const next = withMeta(acc, { name: v.name, openingBalance: v.openingBalance, openingDate: v.openingDate, note: v.note ?? null })
  assertOk(historyProblem(next, transactions))
  const saved = await repos.accounts.update(acc.id, stripMeta(next))
  await markStale(repos, acc.openingDate, v.openingDate)
  return saved
}

// ---------------------------------------------------------------- sổ tiết kiệm

/**
 * Giao dịch chuyển tiền mở sổ (null = sổ đã có từ trước): do app tạo lúc "Mở sổ mới" (có khóa riêng),
 * hoặc do người dùng tự ghi — khoản chuyển vào sổ đúng ngày gửi, đúng số gốc của kỳ đầu, khi sổ bắt đầu từ 0.
 */
export function depositOpeningOf(acc: Account, transactions: readonly Transaction[], terms: readonly DepositTerm[] = []): Transaction | null {
  const byKey = transactions.find((t) => t.idempotencyKey === `deposit-open:${acc.id}`)
  if (byKey) return byKey
  const first = terms.find((t) => t.accountId === acc.id && t.seq === 1)
  if (!first || acc.openingBalance !== 0) return null
  return transactions.find((t) => t.type === 'transfer' && t.toAccountId === acc.id && t.date === first.startDate && t.amount === first.principal) ?? null
}

/**
 * Kỳ gửi còn sửa được gốc / lãi suất / ngày gửi / kỳ hạn: sổ mới chỉ có kỳ đầu, chưa trả lãi lần nào và
 * chưa có giao dịch nào ngoài lần chuyển tiền mở sổ. Sau đó các con số đã sinh ra giao dịch lãi → không sửa ngược.
 */
export function editableTerm(acc: Account, terms: readonly DepositTerm[], transactions: readonly Transaction[]): DepositTerm | null {
  const own = terms.filter((t) => t.accountId === acc.id)
  const first = own[0]
  if (own.length !== 1 || !first || first.seq !== 1 || first.status !== 'active' || first.interestPaid !== 0) return null
  const opening = depositOpeningOf(acc, transactions, terms)
  return touching(acc.id, transactions).every((t) => t.id === opening?.id) ? first : null
}

export interface DepositEdit {
  name: string
  details: Omit<TermDepositDetails, 'dayCountBasis'>
  /** Chỉ khi editableTerm() khác null. */
  term?: { principal: number; annualRate: number; termMonths: number; startDate: string }
}

export async function updateDeposit(
  repos: Repositories,
  acc: AccountOf<'term_deposit'>,
  v: DepositEdit,
  data: { accounts: readonly Account[]; terms: readonly DepositTerm[]; transactions: readonly Transaction[] },
) {
  const payout = data.accounts.find((a) => a.id === v.details.payoutAccountId)
  if (!payout || payout.class !== 'asset' || payout.archivedAt || payout.id === acc.id) {
    throw new ValidationError([{ path: 'payoutAccountId', message: 'Chọn tài khoản nhận lãi đang dùng (ngân hàng, ví, tiền mặt…)' }])
  }
  const term = editableTerm(acc, data.terms, data.transactions)
  if (v.term && !term) throw new ConflictError('Sổ đã phát sinh lãi hoặc tái tục — không sửa gốc / lãi suất / ngày gửi được nữa. Nếu nhập nhầm, hãy xóa sổ rồi mở lại.')
  if (!term && v.details.interestPayout !== acc.details.interestPayout) {
    throw new ConflictError('Sổ đã phát sinh lãi — không đổi cách nhận lãi được nữa.')
  }

  const opening = depositOpeningOf(acc, data.transactions, data.terms)
  const patch: Partial<AccountOf<'term_deposit'>> = { name: v.name, details: { ...v.details, dayCountBasis: 365 } }
  if (term && v.term) {
    patch.openingDate = v.term.startDate
    patch.openingBalance = opening ? 0 : v.term.principal
  }
  const saved = await repos.accounts.update(acc.id, stripMeta(withMeta(acc, patch)))
  if (term && v.term) {
    await repos.depositTerms.update(term.id, {
      principal: v.term.principal,
      annualRate: v.term.annualRate,
      termMonths: v.term.termMonths,
      startDate: v.term.startDate,
      maturityDate: maturityDateOf(v.term.startDate, v.term.termMonths),
    })
    if (opening && (opening.amount !== v.term.principal || opening.date !== v.term.startDate)) {
      await repos.transactions.update(opening.id, { amount: v.term.principal, date: v.term.startDate })
    }
    await markStale(repos, acc.openingDate, v.term.startDate)
  }
  return saved
}

// ---------------------------------------------------------------- xóa hẳn

export interface DeletionImpact {
  transactions: number
  trades: number
  recurringRules: number
  budgetLines: number
  /** Sổ tiết kiệm khác đang trả lãi vào tài khoản này → phải đổi trước khi xóa. */
  blockedBy: string | null
}

/** Những gì sẽ mất khi xóa hẳn tài khoản — khớp đúng hàm SQL delete_account_cascade. */
export function deletionImpact(
  acc: Account,
  data: { accounts: readonly Account[]; transactions: readonly Transaction[]; trades: readonly InvestmentTrade[]; holdings: readonly Holding[]; recurringRules: readonly RecurringRule[]; budgetLines: readonly BudgetLine[] },
): DeletionImpact {
  const holdingIds = new Set(data.holdings.filter((h) => h.accountId === acc.id).map((h) => h.id))
  const trades = data.trades.filter((t) => t.cashAccountId === acc.id || holdingIds.has(t.holdingId))
  const groups = new Set([...trades.map((t) => t.groupId), ...touching(acc.id, data.transactions).map((t) => t.groupId)].filter((g): g is string => !!g))
  const transactions = data.transactions.filter((t) => t.accountId === acc.id || t.toAccountId === acc.id || (t.groupId !== null && groups.has(t.groupId)))
  const blocker = data.accounts.find((a) => a.id !== acc.id && a.kind === 'term_deposit' && a.details.payoutAccountId === acc.id)
  return {
    transactions: transactions.length,
    trades: trades.length,
    recurringRules: data.recurringRules.filter((r) => r.template.accountId === acc.id || r.template.toAccountId === acc.id).length,
    budgetLines: data.budgetLines.filter((l) => l.target.kind === 'account' && l.target.accountId === acc.id).length,
    blockedBy: blocker ? blocker.name : null,
  }
}

export const deleteAccountCascade = (repos: Repositories, accountId: string) => repos.accounts.deleteCascade(accountId)
