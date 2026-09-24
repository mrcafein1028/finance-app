import type { SupabaseClient } from '@supabase/supabase-js'
import { nowIso } from '../lib/clock'
import { APP_ID, backupFileSchema, CURRENT_SCHEMA_VERSION, TABLE_NAMES, type BackupFile, type TableName } from '../schemas'
import { ValidationError } from './errors'
import { fromRow, sqlTable, toRow, type Row } from './mappers'
import { fetchAll, run } from './repositories/base'

/** Sắp theo id để hai lần xuất cùng dữ liệu cho ra file giống hệt nhau. */
const byId = (a: Row, b: Row) => String(a.id ?? '').localeCompare(String(b.id ?? ''))

/** Đọc thô mọi dòng của người dùng hiện tại (RLS tự lọc) rồi kiểm tra bằng schema. */
export async function exportAll(client: SupabaseClient): Promise<BackupFile> {
  const entries = await Promise.all(
    TABLE_NAMES.map(async (name) => {
      const table = sqlTable(name)
      const order = name === 'settings' ? 'user_id' : 'id'
      const rows = await fetchAll((f, t) => client.from(table).select('*').order(order).range(f, t))
      return [name, rows.map(fromRow).sort(byId)] as const
    }),
  )
  return buildBackup(Object.fromEntries(entries) as Record<TableName, Row[]>)
}

/** Dựng file sao lưu từ các dòng đã đổi sang camelCase; ném ValidationError nếu dữ liệu sai. */
export function buildBackup(data: Record<TableName, Row[]>): BackupFile {
  return parseBackup({ app: APP_ID, schemaVersion: CURRENT_SCHEMA_VERSION, exportedAt: nowIso(), data })
}

/** Kiểm tra file sao lưu mà không đụng vào DB. */
export function parseBackup(raw: unknown): BackupFile {
  const result = backupFileSchema.safeParse(raw)
  if (!result.success) throw ValidationError.fromZod(result.error)
  return result.data
}

/** Payload cho hàm SQL replace_all_data: { bảng_snake: [dòng_snake] }. */
export function toReplacePayload(backup: BackupFile): Record<string, Row[]> {
  return Object.fromEntries(
    TABLE_NAMES.map((name) => [sqlTable(name), (backup.data[name] as object[]).map((r) => toRow(r))]),
  )
}

/**
 * Thay thế toàn bộ dữ liệu bằng file sao lưu. Validate ở client trước, rồi hàm SQL
 * replace_all_data ghi trong MỘT transaction: lỗi bất kỳ → dữ liệu hiện tại nguyên vẹn (W17).
 */
export async function importReplace(client: SupabaseClient, raw: unknown): Promise<BackupFile> {
  const backup = parseBackup(raw)
  await run(client.rpc('replace_all_data', { payload: toReplacePayload(backup) }))
  return backup
}
