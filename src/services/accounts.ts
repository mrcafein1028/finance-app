import type { Repositories } from '../data/repositories'
import type { NewRecord } from '../data/repositories/base'
import { ConflictError } from '../data/errors'
import { formatMoney } from '../lib/format'
import { addMonthsToKey } from '../domain/dates'
import { nowIso } from '../lib/clock'
import { KIND_META, type Account, type Transaction } from '../schemas'
import type { AccountFormValues } from '../schemas/forms'
import { historyProblem } from './accountEdit'

/** Giá trị form F2 → dữ liệu account (tài khoản tiền / quỹ mục tiêu). */
export function accountFromForm(values: AccountFormValues, sortOrder: number): NewRecord<Account> {
  const meta = KIND_META[values.kind]
  return {
    name: values.name,
    kind: values.kind,
    class: 'asset',
    currency: 'VND',
    openingBalance: values.openingBalance,
    openingDate: values.openingDate,
    isLiquid: meta.isLiquid,
    includeInNetWorth: true,
    isEmergencyFund: values.isEmergencyFund,
    goal: values.goalTarget ? { targetAmount: values.goalTarget, targetDate: values.goalDate || null } : null,
    archivedAt: null,
    icon: null,
    color: null,
    note: values.note || null,
    sortOrder,
    details: null,
  } as NewRecord<Account>
}

export function createAccount(repos: Repositories, values: AccountFormValues, sortOrder: number) {
  return repos.accounts.create(accountFromForm(values, sortOrder))
}

/**
 * Sửa account. Đổi số dư đầu / ngày bắt đầu làm thay đổi toàn bộ lịch sử số dư, nên không cho
 * lùi ngày bắt đầu qua sau giao dịch đầu tiên (I2).
 */
export async function updateAccount(repos: Repositories, account: Account, values: AccountFormValues, transactions: readonly Transaction[]) {
  const first = transactions
    .filter((t) => t.accountId === account.id || t.toAccountId === account.id)
    .reduce<string | null>((min, t) => (min === null || t.date < min ? t.date : min), null)
  if (first && values.openingDate > first) {
    throw new ConflictError(`Ngày bắt đầu phải trước hoặc bằng giao dịch đầu tiên của tài khoản (${first.split('-').reverse().join('/')})`)
  }
  const { sortOrder: _s, ...patch } = accountFromForm(values, account.sortOrder)
  const problem = historyProblem({ ...account, ...patch } as Account, transactions)
  if (problem) throw new ConflictError(problem)
  const saved = await repos.accounts.update(account.id, patch as Partial<NewRecord<Account>>)
  if (values.openingBalance !== account.openingBalance || values.openingDate !== account.openingDate) {
    // Số dư ban đầu là gốc của mọi số dư về sau → ảnh chụp net worth từ tháng đó phải tính lại.
    const earliest = [account.openingDate, values.openingDate].sort()[0]!
    await repos.snapshots.markStaleFrom(addMonthsToKey(earliest.slice(0, 7), -1))
  }
  return saved
}

/** Lưu trữ (W16): ẩn khỏi danh sách, vẫn nằm trong lịch sử net worth. */
export const archiveAccount = (repos: Repositories, account: Account) => repos.accounts.update(account.id, { archivedAt: nowIso() })
export const unarchiveAccount = (repos: Repositories, account: Account) => repos.accounts.update(account.id, { archivedAt: null })

export function hasTransactions(account: Account, transactions: readonly Transaction[]) {
  return transactions.some((t) => t.accountId === account.id || t.toAccountId === account.id)
}

/** Xóa hẳn chỉ khi chưa có giao dịch (I9) — Postgres cũng chặn bằng khóa ngoại. */
export async function deleteAccount(repos: Repositories, account: Account, transactions: readonly Transaction[]) {
  if (hasTransactions(account, transactions)) {
    throw new ConflictError('Tài khoản đã có giao dịch — hãy lưu trữ thay vì xóa')
  }
  await repos.accounts.remove(account.id)
}

export interface ReconcilePlan {
  difference: number
  description: string
}

/** Chênh lệch giữa số dư thực tế và số dư trong app (W4). */
export function planReconcile(current: number, actual: number): ReconcilePlan {
  const difference = actual - current
  if (difference === 0) return { difference, description: 'Số dư đã khớp — không cần điều chỉnh' }
  return {
    difference,
    description: difference > 0 ? `App đang thiếu ${formatMoney(difference)} so với thực tế` : `App đang thừa ${formatMoney(-difference)} so với thực tế`,
  }
}

/**
 * Ghi chênh lệch đối soát: `adjustment` (không tính thu/chi) hoặc `expense` vào danh mục đã chọn
 * (khi biết chắc là đã tiêu mà quên ghi — chỉ áp dụng khi thực tế ÍT hơn app).
 */
export async function reconcileAccount(
  repos: Repositories,
  account: Account,
  current: number,
  actual: number,
  mode: 'adjustment' | 'expense',
  categoryId: string,
  date: string,
): Promise<Transaction | null> {
  const { difference } = planReconcile(current, actual)
  if (difference === 0) return null
  const base = { date, amount: Math.abs(difference), accountId: account.id, toAccountId: null, tags: [], groupId: null, origin: 'manual' as const, recurringRuleId: null, idempotencyKey: null }
  if (mode === 'expense' && difference < 0) {
    return repos.transactions.create({ ...base, type: 'expense', categoryId, direction: null, note: 'Đối soát số dư' })
  }
  return repos.transactions.create({ ...base, type: 'adjustment', categoryId: null, direction: difference > 0 ? 'up' : 'down', note: 'Đối soát số dư' })
}
