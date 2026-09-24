import { ConflictError, ValidationError } from '../data/errors'
import type { Repositories } from '../data/repositories'
import type { NewRecord } from '../data/repositories/base'
import { earlyWithdrawalInterest, maturityDateOf, monthlyPayouts, planMaturity, simpleInterest, termDays } from '../domain/savings'
import { nowIso } from '../lib/clock'
import type { Account, AccountOf, DepositTerm, TermDepositDetails, Transaction } from '../schemas'

// Vòng đời sổ tiết kiệm (docs/05 W9). Mỗi giao dịch hệ thống có khóa chống trùng riêng, nên nếu một
// bước lỗi giữa chừng, bấm lại sẽ hoàn tất phần còn thiếu mà không ghi đôi.

type DepositAccount = AccountOf<'term_deposit'>

async function savingsInterestCategory(repos: Repositories): Promise<string> {
  const c = await repos.categories.bySystemKey('savings_interest')
  if (!c) throw new ValidationError([{ path: '', message: 'Thiếu danh mục hệ thống "Lãi tiết kiệm"' }])
  return c.id
}

/** Tạo giao dịch hệ thống; đã tồn tại (cùng idempotencyKey) → bỏ qua. */
async function postOnce(repos: Repositories, tx: NewRecord<Transaction>): Promise<boolean> {
  try {
    await repos.transactions.create(tx)
    return true
  } catch (e) {
    if (e instanceof ConflictError) return false
    throw e
  }
}

const systemTx = (key: string, date: string) => ({ date, tags: [], groupId: null, origin: 'system' as const, recurringRuleId: null, idempotencyKey: key })

export interface OpenDepositValues {
  name: string
  bankName: string
  principal: number
  annualRate: number
  termMonths: number
  startDate: string
  interestPayout: TermDepositDetails['interestPayout']
  maturityAction: TermDepositDetails['maturityAction']
  payoutAccountId: string
  earlyWithdrawalRate: number
  /** Sổ mới: tiền đi từ tài khoản này. null = sổ đã có từ trước (không tạo giao dịch chuyển). */
  sourceAccountId: string | null
}

/** Mở sổ (F3): account term_deposit + kỳ #1 + chuyển tiền từ tài khoản nguồn nếu là sổ mới. */
export async function openDeposit(repos: Repositories, v: OpenDepositValues, sortOrder: number): Promise<Account> {
  const account = await repos.accounts.create({
    name: v.name,
    kind: 'term_deposit',
    class: 'asset',
    currency: 'VND',
    openingBalance: v.sourceAccountId ? 0 : v.principal,
    openingDate: v.startDate,
    isLiquid: false,
    includeInNetWorth: true,
    isEmergencyFund: false,
    goal: null,
    archivedAt: null,
    icon: null,
    color: null,
    note: null,
    sortOrder,
    details: {
      bankName: v.bankName,
      interestPayout: v.interestPayout,
      maturityAction: v.maturityAction,
      payoutAccountId: v.payoutAccountId,
      earlyWithdrawalRate: v.earlyWithdrawalRate,
      dayCountBasis: 365,
    },
  } as NewRecord<Account>)
  await repos.depositTerms.create({
    accountId: account.id,
    seq: 1,
    principal: v.principal,
    annualRate: v.annualRate,
    termMonths: v.termMonths,
    startDate: v.startDate,
    maturityDate: maturityDateOf(v.startDate, v.termMonths),
    status: 'active',
    interestPaid: 0,
    closedAt: null,
  })
  if (v.sourceAccountId) {
    await repos.transactions.create({
      ...systemTx(`deposit-open:${account.id}`, v.startDate),
      type: 'transfer',
      amount: v.principal,
      accountId: v.sourceAccountId,
      toAccountId: account.id,
      categoryId: null,
      direction: null,
      note: `Mở sổ ${v.name}`,
    })
  }
  return account
}

/**
 * W18 bước 3 — ghi lãi trả hàng tháng / trả trước của các kỳ đang hiệu lực, tới hôm nay.
 * Trả về số giao dịch lãi đã tạo mới.
 */
export async function runDepositPayouts(repos: Repositories, accounts: readonly Account[], terms: readonly DepositTerm[], today: string): Promise<number> {
  const deposits = new Map(accounts.filter((a): a is DepositAccount => a.kind === 'term_deposit' && !a.archivedAt).map((a) => [a.id, a]))
  let created = 0
  let categoryId: string | null = null
  for (const term of terms) {
    const account = deposits.get(term.accountId)
    if (!account || term.status !== 'active') continue
    const payout = account.details.interestPayout
    const payments =
      payout === 'monthly'
        ? monthlyPayouts(term).filter((p) => p.date <= today)
        : payout === 'upfront' && term.startDate <= today
          ? [{ date: term.startDate, amount: simpleInterest(term.principal, term.annualRate, termDays(term)) }]
          : []
    // Khoản lãi trước ngày bắt đầu theo dõi tài khoản nhận đã nằm sẵn trong số dư đầu của nó.
    const payoutAccount = accounts.find((a) => a.id === account.details.payoutAccountId)
    for (const p of payments) {
      if (!payoutAccount || payoutAccount.archivedAt || p.date < payoutAccount.openingDate) continue
      categoryId ??= await savingsInterestCategory(repos)
      const ok = await postOnce(repos, {
        ...systemTx(`deposit-interest:${term.id}:${p.date}`, p.date),
        type: 'income',
        amount: p.amount,
        accountId: account.details.payoutAccountId,
        categoryId,
        toAccountId: null,
        direction: null,
        note: `Lãi ${account.name}`,
      })
      if (ok) created++
    }
  }
  return created
}

export interface MaturityOptions {
  /** Lãi thực nhận theo ngân hàng (mặc định = lãi tính toán; sổ trả lãi hàng tháng/trả trước = 0). */
  actualInterest?: number
  action: TermDepositDetails['maturityAction']
  nextRate?: number
  nextTermMonths?: number
}

/** W9 bước 3 — xử lý đáo hạn: ghi lãi, đóng kỳ cũ, tái tục hoặc tất toán về tài khoản nhận. */
export async function matureDeposit(repos: Repositories, account: DepositAccount, term: DepositTerm, options: MaturityOptions): Promise<void> {
  const d = account.details
  const alreadyPaid = d.interestPayout !== 'at_maturity'
  const plan = planMaturity(term, options.action, {
    actualInterest: options.actualInterest ?? (alreadyPaid ? 0 : undefined),
    nextRate: options.nextRate,
    nextTermMonths: options.nextTermMonths,
  })
  if (plan.interest > 0) {
    await postOnce(repos, {
      ...systemTx(`deposit-interest:${term.id}:maturity`, term.maturityDate),
      type: 'income',
      amount: plan.interest,
      accountId: options.action === 'renew_with_interest' ? account.id : d.payoutAccountId,
      categoryId: await savingsInterestCategory(repos),
      toAccountId: null,
      direction: null,
      note: `Lãi đáo hạn ${account.name}`,
    })
  }
  await repos.depositTerms.update(term.id, { status: 'matured', closedAt: term.maturityDate, interestPaid: plan.interest })

  if (plan.nextTerm) {
    await repos.depositTerms.create({ accountId: account.id, seq: term.seq + 1, ...plan.nextTerm, status: 'active', interestPaid: 0, closedAt: null })
    if (options.action !== d.maturityAction) await repos.accounts.update(account.id, { details: { ...d, maturityAction: options.action } } as never)
    return
  }
  await postOnce(repos, {
    ...systemTx(`deposit-close:${term.id}`, term.maturityDate),
    type: 'transfer',
    amount: term.principal,
    accountId: account.id,
    toAccountId: d.payoutAccountId,
    categoryId: null,
    direction: null,
    note: `Tất toán ${account.name}`,
  })
  await repos.accounts.update(account.id, { archivedAt: nowIso() })
}

/** W9 bước 4 — rút trước hạn: chỉ hưởng lãi không kỳ hạn, gốc về tài khoản nhận, lưu trữ sổ. */
export async function withdrawEarly(repos: Repositories, account: DepositAccount, term: DepositTerm, date: string, actualInterest?: number): Promise<void> {
  if (date < term.startDate || date >= term.maturityDate) {
    throw new ValidationError([{ path: 'date', message: 'Ngày rút phải trong kỳ gửi (trước ngày đáo hạn)' }])
  }
  const d = account.details
  const interest = actualInterest ?? earlyWithdrawalInterest(term, d.earlyWithdrawalRate, date)
  if (interest > 0) {
    await postOnce(repos, {
      ...systemTx(`deposit-interest:${term.id}:early`, date),
      type: 'income',
      amount: interest,
      accountId: d.payoutAccountId,
      categoryId: await savingsInterestCategory(repos),
      toAccountId: null,
      direction: null,
      note: `Lãi rút trước hạn ${account.name}`,
    })
  }
  await repos.depositTerms.update(term.id, { status: 'withdrawn_early', closedAt: date, interestPaid: interest })
  await postOnce(repos, {
    ...systemTx(`deposit-close:${term.id}`, date),
    type: 'transfer',
    amount: term.principal,
    accountId: account.id,
    toAccountId: d.payoutAccountId,
    categoryId: null,
    direction: null,
    note: `Rút trước hạn ${account.name}`,
  })
  await repos.accounts.update(account.id, { archivedAt: nowIso() })
}
