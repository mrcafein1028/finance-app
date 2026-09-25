import { z } from 'zod'
import type { Repositories } from '../data/repositories'
import { ConflictError, DatabaseError, NotFoundError, ValidationError } from '../data/errors'
import { DomainError } from '../domain/errors'
import type { BudgetMonthSummary } from '../domain/budget'
import { buildLedgerView, computeOverview, loadFullData, type FullData, type LedgerView, type Overview } from '../services/overview'
import type { Account, Category, Transaction } from '../schemas'
import { ToolError } from './lookup'

// Dùng chung cho mọi công cụ MCP: đọc dữ liệu một lần mỗi lệnh, ngày "hôm nay" theo giờ Việt Nam,
// định dạng kết quả và đổi lỗi nghiệp vụ thành thông điệp Claude đọc được.

export const TIME_ZONE = 'Asia/Ho_Chi_Minh'

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Tháng dạng YYYY-MM')
export const dateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Ngày dạng YYYY-MM-DD')

export interface McpDeps {
  repos: Repositories
  /** Đồng hồ (test truyền ngày cố định). */
  now?: () => Date
  timeZone?: string
}

/** Ngày YYYY-MM-DD tại múi giờ của người dùng — máy chủ Vercel chạy giờ UTC. */
export function localDate(date: Date, timeZone = TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export interface Snapshot {
  data: FullData
  today: string
  view: LedgerView
  overview: Overview
}

const byDateDesc = (a: Transaction, b: Transaction) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)

export async function loadSnapshot(deps: McpDeps): Promise<Snapshot> {
  const data = await loadFullData(deps.repos)
  data.transactions.sort(byDateDesc)
  data.accounts.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'))
  const today = localDate(deps.now?.() ?? new Date(), deps.timeZone)
  const view = buildLedgerView(data, today)
  const overview = computeOverview({ view, months: data.budgetMonths, lines: data.budgetLines, snapshots: data.snapshots, now: today })
  return { data, today, view, overview }
}

// ---------------------------------------------------------------- kết quả công cụ

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

export const ok = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 1) }] })
export const fail = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true })

/** Bọc thân công cụ: lỗi nghiệp vụ → isError kèm thông điệp; lỗi lạ → thông điệp chung (không lộ chi tiết nội bộ). */
export function guarded<A>(fn: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
  return async (args) => {
    try {
      return await fn(args)
    } catch (e) {
      if (e instanceof ToolError || e instanceof DomainError || e instanceof ConflictError || e instanceof NotFoundError) return fail(e.message)
      if (e instanceof ValidationError) return fail(e.issues.map((i) => `${i.path}: ${i.message}`).join('; ') || e.message)
      if (e instanceof DatabaseError) return fail(`Cơ sở dữ liệu từ chối: ${e.message}`)
      console.error('[mcp] lỗi không mong đợi', e)
      return fail('Máy chủ gặp lỗi không mong đợi khi xử lý yêu cầu. Thử lại sau, hoặc làm thao tác này trong app.')
    }
  }
}

// ---------------------------------------------------------------- mô tả dữ liệu cho Claude

export const RATING_TEXT = { good: 'Tốt', fair: 'Trung bình', attention: 'Cần chú ý' } as const
export const LINE_STATUS_TEXT = { ok: 'Trong hạn mức', warning: 'Sắp hết', full: 'Vừa hết', over: 'Vượt' } as const
export const TYPE_TEXT = { income: 'Thu', expense: 'Chi', refund: 'Hoàn tiền', transfer: 'Chuyển', adjustment: 'Điều chỉnh' } as const

export function describeTx(tx: Transaction, view: Pick<LedgerView, 'accountById' | 'categoryById'>) {
  const category = tx.categoryId ? view.categoryById.get(tx.categoryId) : undefined
  const parent = category?.parentId ? view.categoryById.get(category.parentId) : undefined
  return {
    id: tx.id,
    date: tx.date,
    type: tx.type,
    type_text: TYPE_TEXT[tx.type],
    amount: tx.amount,
    account: view.accountById.get(tx.accountId)?.name ?? null,
    to_account: tx.toAccountId ? (view.accountById.get(tx.toAccountId)?.name ?? null) : null,
    category: category ? (parent ? `${parent.name} > ${category.name}` : category.name) : null,
    direction: tx.direction,
    note: tx.note,
    tags: tx.tags,
    /** Một phần của nghiệp vụ nhiều bước (trả nợ = gốc + lãi, mua cổ phiếu = lệnh + phí) — chỉ sửa/xóa trong app. */
    part_of_group: tx.groupId !== null,
    origin: tx.origin,
  }
}

export function budgetLineName(line: BudgetMonthSummary['lines'][number], accounts: ReadonlyMap<string, Account>, categories: ReadonlyMap<string, Category>): string {
  const t = line.line.target
  return t.kind === 'category' ? (categories.get(t.categoryId)?.name ?? 'Danh mục đã xóa') : (accounts.get(t.accountId)?.name ?? 'Tài khoản đã xóa')
}

export function budgetLineRow(l: BudgetMonthSummary['lines'][number], view: Pick<LedgerView, 'accountById' | 'categoryById'>) {
  const saving = l.line.target.kind === 'account'
  return {
    target_type: saving ? 'fund_or_debt' : 'category',
    name: budgetLineName(l, view.accountById, view.categoryById),
    planned: l.planned,
    carried_from_last_month: l.carryIn,
    budget: l.budget,
    actual: l.actual,
    available: l.available,
    status: l.status,
    status_text: saving ? (l.actual >= l.budget ? 'Đã hoàn thành' : `Đã góp ${Math.round((l.usage ?? 0) * 100)}%`) : LINE_STATUS_TEXT[l.status],
    spending_faster_than_plan: l.aheadOfPace,
    rollover: l.line.rollover,
  }
}
