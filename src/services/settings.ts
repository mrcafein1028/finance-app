import type { SupabaseClient } from '@supabase/supabase-js'
import { exportAll, importReplace, parseBackup } from '../data/backup'
import { ValidationError } from '../data/errors'
import { DEFAULT_SETTINGS, type Repositories } from '../data/repositories'
import { nowIso } from '../lib/clock'
import { TABLE_NAMES, type Account, type BackupFile, type BudgetBucket, type Category, type CategoryType, type Settings, type TableName, type Transaction } from '../schemas'

// Cài đặt, danh mục (W15), sao lưu / khôi phục (W17) và xóa toàn bộ dữ liệu (docs/05).

// ------------------------------------------------------------------ danh mục

export interface CategoryInput {
  name: string
  type: CategoryType
  parentId: string | null
  bucket: BudgetBucket | null
}

export interface CategoryUsage {
  transactions: number
  budgetLines: number
  recurringRules: number
  children: number
}

export async function categoryUsage(repos: Repositories, id: string): Promise<CategoryUsage> {
  const [txs, lines, rules, cats] = await Promise.all([repos.transactions.list(), repos.budgetLines.list(), repos.recurringRules.list(), repos.categories.list()])
  return {
    transactions: txs.filter((t) => t.categoryId === id).length,
    budgetLines: lines.filter((l) => l.target.kind === 'category' && l.target.categoryId === id).length,
    recurringRules: rules.filter((r) => r.template.categoryId === id).length,
    children: cats.filter((c) => c.parentId === id).length,
  }
}

function checkParent(all: Category[], input: CategoryInput, selfId: string | null, txs: Transaction[]) {
  if (!input.parentId) return
  const parent = all.find((c) => c.id === input.parentId)
  if (!parent) throw new ValidationError([{ path: 'parentId', message: 'Không tìm thấy nhóm cha' }])
  if (parent.parentId) throw new ValidationError([{ path: 'parentId', message: 'Danh mục chỉ có tối đa 2 cấp' }])
  if (parent.type !== input.type) throw new ValidationError([{ path: 'parentId', message: 'Nhóm cha phải cùng loại thu/chi' }])
  if (selfId && all.some((c) => c.parentId === selfId)) throw new ValidationError([{ path: 'parentId', message: 'Danh mục đang là nhóm (có danh mục con) nên không thể nằm trong nhóm khác' }])
  // Giao dịch chỉ gắn vào danh mục lá: nhóm cha đang có giao dịch thì không nhận thêm danh mục con.
  if (!all.some((c) => c.parentId === parent.id) && txs.some((t) => t.categoryId === parent.id)) {
    throw new ValidationError([{ path: 'parentId', message: `"${parent.name}" đã có giao dịch — gộp các giao dịch đó sang danh mục khác trước khi biến nó thành nhóm` }])
  }
}

export async function createCategory(repos: Repositories, input: CategoryInput): Promise<Category> {
  const [all, txs] = await Promise.all([repos.categories.list(), repos.transactions.list()])
  checkParent(all, input, null, txs)
  const sortOrder = Math.max(0, ...all.map((c) => c.sortOrder)) + 1
  return repos.categories.create({
    name: input.name.trim(),
    type: input.type,
    parentId: input.parentId,
    bucket: input.type === 'income' ? null : input.bucket,
    isSystem: false,
    systemKey: null,
    archivedAt: null,
    icon: null,
    color: null,
    sortOrder,
  })
}

/** Danh mục hệ thống chỉ được đổi tên (nghiệp vụ tự động tìm nó theo systemKey). */
export async function updateCategory(repos: Repositories, category: Category, input: Omit<CategoryInput, 'type'>): Promise<Category> {
  if (category.isSystem) return repos.categories.update(category.id, { name: input.name.trim() })
  const [all, txs] = await Promise.all([repos.categories.list(), repos.transactions.list()])
  checkParent(all, { ...input, type: category.type }, category.id, txs)
  return repos.categories.update(category.id, {
    name: input.name.trim(),
    parentId: input.parentId,
    bucket: category.type === 'income' ? null : input.bucket,
  })
}

export const archiveCategory = (repos: Repositories, id: string, archived: boolean) =>
  repos.categories.update(id, { archivedAt: archived ? nowIso() : null })

/** Chỉ xóa được danh mục chưa dùng ở đâu; đã dùng → phải gộp (hoặc lưu trữ). Dòng ngân sách 0đ đi kèm được xóa theo. */
export async function deleteCategory(repos: Repositories, category: Category): Promise<void> {
  if (category.isSystem) throw new ValidationError([{ path: 'id', message: 'Không thể xóa danh mục hệ thống' }])
  const usage = await categoryUsage(repos, category.id)
  if (usage.children > 0) throw new ValidationError([{ path: 'id', message: 'Nhóm còn danh mục con — hãy xóa hoặc chuyển các danh mục con trước' }])
  if (usage.transactions > 0 || usage.recurringRules > 0) {
    throw new ValidationError([{ path: 'id', message: 'Danh mục đang được dùng — hãy gộp vào danh mục khác để giữ lịch sử' }])
  }
  const lines = (await repos.budgetLines.list()).filter((l) => l.target.kind === 'category' && l.target.categoryId === category.id)
  for (const l of lines) await repos.budgetLines.remove(l.id)
  await repos.categories.remove(category.id)
}

/** Danh mục có thể nhận khi gộp `from`: cùng loại, là lá (không phải nhóm), khác chính nó. */
export function mergeTargets(all: Category[], from: Category): Category[] {
  return all.filter((c) => c.id !== from.id && c.type === from.type && !c.archivedAt && !all.some((x) => x.parentId === c.id))
}

// ------------------------------------------------------------------ sao lưu / khôi phục

export const backupFileName = (at = nowIso()) => `tai-chinh-sao-luu-${at.slice(0, 19).replace(/[:T]/g, '-')}.json`

export function summarizeBackup(backup: BackupFile): { table: TableName; count: number }[] {
  return TABLE_NAMES.filter((t) => t !== 'settings').map((t) => ({ table: t, count: backup.data[t].length }))
}

export const TABLE_LABELS: Record<TableName, string> = {
  settings: 'Cài đặt',
  accounts: 'Tài khoản',
  categories: 'Danh mục',
  transactions: 'Giao dịch',
  holdings: 'Mã đầu tư',
  investmentTrades: 'Lệnh mua bán',
  priceQuotes: 'Giá cập nhật',
  depositTerms: 'Kỳ gửi tiết kiệm',
  assetValuations: 'Định giá tài sản',
  budgetMonths: 'Tháng ngân sách',
  budgetLines: 'Dòng ngân sách',
  recurringRules: 'Giao dịch định kỳ',
  netWorthSnapshots: 'Ảnh chụp net worth',
}

/** Đọc file người dùng chọn → BackupFile đã kiểm tra (chưa ghi gì vào DB). */
export function readBackupText(text: string): BackupFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ValidationError([{ path: 'file', message: 'File không phải JSON hợp lệ' }])
  }
  return parseBackup(raw)
}

/** Lưu một bản sao lưu vào Supabase Storage: <uid>/backups/<thời điểm>.json. Trả về đường dẫn. */
export async function backupToStorage(client: SupabaseClient, userId: string, backup: BackupFile): Promise<string> {
  const path = `${userId}/backups/${backup.exportedAt.replace(/[:.]/g, '-')}.json`
  const { error } = await client.storage.from('user-files').upload(path, JSON.stringify(backup), { contentType: 'application/json' })
  if (error) throw new Error(`Không lưu được bản sao lưu lên máy chủ: ${error.message}`)
  return path
}

export type SafetyBackup = { kind: 'storage'; path: string } | { kind: 'download'; backup: BackupFile }

/**
 * Trước thao tác thay thế/xóa toàn bộ: chụp dữ liệu hiện tại. Ưu tiên lưu lên Storage;
 * lỗi (chưa chạy migration storage, hết dung lượng…) → trả file để giao diện tải về máy.
 */
export async function safetyBackup(client: SupabaseClient, userId: string): Promise<SafetyBackup> {
  const backup = await exportAll(client)
  try {
    return { kind: 'storage', path: await backupToStorage(client, userId, backup) }
  } catch {
    return { kind: 'download', backup }
  }
}

export async function markBackedUp(repos: Repositories): Promise<Settings> {
  return repos.settings.update({ lastBackupAt: nowIso() })
}

/** Khôi phục: thay TOÀN BỘ dữ liệu bằng file (một transaction — lỗi thì dữ liệu cũ nguyên vẹn). */
export const restoreBackup = (client: SupabaseClient, backup: BackupFile) => importReplace(client, backup)

/** Xóa sạch dữ liệu, giữ tài khoản đăng nhập và vài tùy chọn hiển thị; mở lại hướng dẫn bắt đầu. */
export async function deleteAllData(client: SupabaseClient, current: Settings): Promise<void> {
  const settings: Settings = { ...DEFAULT_SETTINGS, theme: current.theme, lastBackupAt: current.lastBackupAt, onboardingCompleted: false }
  const data = Object.fromEntries(TABLE_NAMES.map((t) => [t, []])) as unknown as BackupFile['data']
  await importReplace(client, { app: 'tai-chinh-ca-nhan', schemaVersion: current.schemaVersion, exportedAt: nowIso(), data: { ...data, settings: [settings] } })
}

// ------------------------------------------------------------------ CSV

const csvCell = (v: string | number) => {
  const s = String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const TYPE_LABELS: Record<Transaction['type'], string> = { income: 'Thu', expense: 'Chi', refund: 'Hoàn tiền', transfer: 'Chuyển', adjustment: 'Điều chỉnh' }

/** Giao dịch dạng CSV (có BOM để Excel đọc đúng tiếng Việt). Số tiền: dương = vào tài khoản, âm = ra. */
export function transactionsCsv(txs: Transaction[], accountById: ReadonlyMap<string, Account>, categoryById: ReadonlyMap<string, Category>): string {
  const header = ['Ngày', 'Loại', 'Tài khoản', 'Tài khoản nhận', 'Danh mục', 'Số tiền', 'Ghi chú', 'Thẻ']
  const rows = [...txs]
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .map((t) => {
      const signed = t.type === 'expense' || t.type === 'transfer' || (t.type === 'adjustment' && t.direction === 'down') ? -t.amount : t.amount
      return [
        t.date,
        TYPE_LABELS[t.type],
        accountById.get(t.accountId)?.name ?? '',
        t.toAccountId ? (accountById.get(t.toAccountId)?.name ?? '') : '',
        t.categoryId ? (categoryById.get(t.categoryId)?.name ?? '') : '',
        signed,
        t.note ?? '',
        t.tags.join(' '),
      ]
    })
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
