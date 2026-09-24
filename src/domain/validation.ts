import { formatDate, formatMoney } from '../lib/format'
import { ledgerBalance, transactionEffect } from './balance'
import { D, round } from './money'
import { periodOf } from './period'
import type { Account, Category, IsoDate, Money, MonthKey, Transaction } from './types'

// Kiểm tra giao dịch trước khi lưu (docs/03 §4, docs/06 F1). Lỗi chặn lưu; cảnh báo cần xác nhận
// (confirm) hoặc chỉ để hiển thị. Postgres vẫn kiểm tra lại I2/I4 — đây là lớp báo lỗi thân thiện.

export interface CheckIssue {
  path: string
  message: string
}

export interface CheckWarning {
  code: 'overdraft' | 'over_limit' | 'future' | 'closed_month' | 'large_amount' | 'duplicate'
  message: string
  /** true: người dùng phải bấm "Vẫn lưu". false: chỉ hiển thị. */
  confirm: boolean
}

export interface TransactionCheckContext {
  accounts: readonly Account[]
  categories: readonly Category[]
  /** Mọi giao dịch hiện có (để tính số dư theo thời gian, phát hiện trùng). */
  transactions: readonly Transaction[]
  today: IsoDate
  periodStartDay?: number
  closedMonths?: ReadonlySet<MonthKey>
  /** Bản ghi đang được sửa (bỏ khỏi dữ liệu khi tính lại). */
  editing?: Transaction | null
  /** Thời điểm hiện tại, để phát hiện bấm lưu hai lần. */
  now?: Date
}

export interface TransactionCheckResult {
  errors: CheckIssue[]
  warnings: CheckWarning[]
}

/**
 * Số dư thấp nhất của account (cuối mỗi ngày) từ ngày `from` trở đi.
 * Dùng để biết một giao dịch có làm tiền mặt âm / trả nợ vượt dư nợ ở BẤT KỲ thời điểm nào không.
 */
export function minBalanceFrom(account: Account, transactions: readonly Transaction[], from: IsoDate): Money {
  const relevant = transactions
    .filter((t) => t.accountId === account.id || t.toAccountId === account.id)
    .sort((a, b) => a.date.localeCompare(b.date))
  let balance = account.openingBalance
  let min = Number.POSITIVE_INFINITY
  let i = 0
  while (i < relevant.length) {
    const date = relevant[i]!.date
    while (i < relevant.length && relevant[i]!.date === date) {
      balance += transactionEffect(relevant[i]!, account.id, account.class)
      i++
    }
    if (date >= from) min = Math.min(min, balance)
  }
  return min === Number.POSITIVE_INFINITY ? balance : Math.min(min, balance)
}

const hasChildren = (categoryId: string, categories: readonly Category[]) => categories.some((c) => c.parentId === categoryId)

export function checkTransaction(tx: Transaction, ctx: TransactionCheckContext): TransactionCheckResult {
  const errors: CheckIssue[] = []
  const warnings: CheckWarning[] = []
  const editing = ctx.editing ?? null
  const others = ctx.transactions.filter((t) => t.id !== tx.id && t.id !== editing?.id)
  const byId = new Map(ctx.accounts.map((a) => [a.id, a]))

  // --- account (I2, I3) ---
  const roles: [string | null, 'accountId' | 'toAccountId'][] = [
    [tx.accountId, 'accountId'],
    [tx.toAccountId, 'toAccountId'],
  ]
  for (const [id, path] of roles) {
    if (!id) continue
    const account = byId.get(id)
    if (!account) {
      errors.push({ path, message: 'Tài khoản không tồn tại' })
      continue
    }
    const unchanged = editing && (editing.accountId === id || editing.toAccountId === id)
    if (account.archivedAt && !unchanged) errors.push({ path, message: `Tài khoản "${account.name}" đã lưu trữ` })
    if (tx.date < account.openingDate) {
      errors.push({ path: 'date', message: `Ngày phải từ ${formatDate(account.openingDate)} (ngày bắt đầu theo dõi "${account.name}")` })
    }
  }
  const source = byId.get(tx.accountId)
  if (tx.type === 'income' && source?.class === 'liability') {
    errors.push({ path: 'accountId', message: 'Không thể ghi thu nhập vào khoản nợ' })
  }

  // --- danh mục (I4) ---
  if (tx.categoryId !== null) {
    const category = ctx.categories.find((c) => c.id === tx.categoryId)
    const expected = tx.type === 'income' ? 'income' : 'expense'
    if (!category) errors.push({ path: 'categoryId', message: 'Danh mục không tồn tại' })
    else if (category.type !== expected) errors.push({ path: 'categoryId', message: `Hãy chọn danh mục ${expected === 'income' ? 'thu' : 'chi'}` })
    else if (hasChildren(category.id, ctx.categories)) errors.push({ path: 'categoryId', message: `Hãy chọn danh mục con thay vì nhóm "${category.name}"` })
    else if (category.archivedAt && editing?.categoryId !== category.id) errors.push({ path: 'categoryId', message: `Danh mục "${category.name}" đã lưu trữ` })
  }

  // --- số dư theo thời gian (I6, I7) ---
  if (errors.length === 0) {
    const from = editing && editing.date < tx.date ? editing.date : tx.date
    for (const id of [tx.accountId, tx.toAccountId]) {
      const account = id ? byId.get(id) : undefined
      if (!account) continue
      const before = minBalanceFrom(account, others.concat(editing ? [editing] : []), from)
      const after = minBalanceFrom(account, [...others, tx], from)
      if (account.kind === 'credit_card') {
        const owed = ledgerBalance(account, [...others, tx], tx.date)
        if (owed > account.details.creditLimit) {
          warnings.push({ code: 'over_limit', message: `Vượt hạn mức thẻ "${account.name}" (${formatMoney(account.details.creditLimit)})`, confirm: true })
        }
      }
      if (after >= 0 || after >= before) continue
      const path = id === tx.accountId ? 'accountId' : 'toAccountId'
      if (account.class === 'liability') {
        const max = tx.amount + after
        errors.push({ path: 'amount', message: `Vượt dư nợ của "${account.name}" — tối đa ${formatMoney(Math.max(0, max))}` })
      } else if (account.kind === 'cash') {
        errors.push({ path, message: `Tiền mặt "${account.name}" sẽ bị âm ${formatMoney(-after)}` })
      } else {
        warnings.push({ code: 'overdraft', message: `Số dư "${account.name}" sẽ âm ${formatMoney(-after)} (thấu chi)`, confirm: true })
      }
    }
  }

  // --- cảnh báo mềm ---
  if (tx.date > ctx.today) warnings.push({ code: 'future', message: 'Giao dịch dự kiến — chưa tính vào số dư hôm nay', confirm: false })

  const month = periodOf(tx.date, ctx.periodStartDay ?? 1)
  if (ctx.closedMonths?.has(month)) {
    warnings.push({ code: 'closed_month', message: `Tháng ${month.slice(5)}/${month.slice(0, 4)} đã đóng — lưu sẽ mở lại số liệu của tháng này`, confirm: true })
  }

  if (tx.categoryId !== null && tx.type === 'expense') {
    const recent = others.filter((t) => t.type === 'expense' && t.categoryId === tx.categoryId).slice(-20)
    if (recent.length >= 3) {
      const avg = round(new D(recent.reduce((s, t) => s + t.amount, 0)).div(recent.length))
      if (tx.amount > avg * 10) {
        warnings.push({ code: 'large_amount', message: `Số tiền gấp hơn 10 lần mức thường chi (${formatMoney(avg)}) — có gõ nhầm số 0?`, confirm: true })
      }
    }
  }

  if (!editing) {
    const now = (ctx.now ?? new Date()).getTime()
    const duplicate = others.some(
      (t) =>
        t.type === tx.type &&
        t.amount === tx.amount &&
        t.date === tx.date &&
        t.accountId === tx.accountId &&
        t.categoryId === tx.categoryId &&
        t.toAccountId === tx.toAccountId &&
        now - new Date(t.createdAt).getTime() < 2 * 60_000,
    )
    if (duplicate) warnings.push({ code: 'duplicate', message: 'Vừa có giao dịch giống hệt được lưu trong 2 phút qua', confirm: true })
  }

  return { errors, warnings }
}

/** Mô tả chuyển khoản theo ý nghĩa (docs/05 W2). */
export function describeTransfer(from: Account | undefined, to: Account | undefined): string {
  if (!from || !to) return 'Chuyển tiền'
  if (to.class === 'liability') return `Trả nợ ${to.name}`
  if (from.class === 'liability') return `Giải ngân ${from.name}`
  if (to.kind === 'goal_fund' || to.kind === 'term_deposit') return `Tiết kiệm vào ${to.name}`
  if (from.kind === 'goal_fund' || from.kind === 'term_deposit') return `Rút từ ${from.name}`
  if (to.kind === 'investment') return `Nạp tiền vào ${to.name}`
  return 'Chuyển tiền'
}
