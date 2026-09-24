import type { SupabaseClient } from '@supabase/supabase-js'
import type { z } from 'zod'
import { nowIso } from '../../lib/clock'
import { newId } from '../../lib/id'
import { fromDbError, NotFoundError, ValidationError } from '../errors'
import { fromRow, toRow, type Row } from '../mappers'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type TimestampMode = 'both' | 'created'
type MetaKeys<M extends TimestampMode> = M extends 'both' ? 'id' | 'createdAt' | 'updatedAt' : 'id' | 'createdAt'

/** Dữ liệu để tạo mới: không cần id/createdAt/updatedAt (có thể truyền id nếu cần biết trước, VD groupId). */
export type NewRecord<T, M extends TimestampMode = 'both'> = DistributiveOmit<T, MetaKeys<M>> & { id?: string }
export type RecordPatch<T, M extends TimestampMode = 'both'> = Partial<DistributiveOmit<T, MetaKeys<M>>>

export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw ValidationError.fromZod(result.error)
  return result.data
}

interface QueryResult {
  data: unknown
  error: { code?: string; message: string } | null
}

/** Chờ một truy vấn supabase-js và đổi lỗi DB thành lỗi nghiệp vụ. */
export async function run<T = unknown>(query: PromiseLike<QueryResult>): Promise<T> {
  const { data, error } = await query
  if (error) throw fromDbError(error)
  return data as T
}

/** PostgREST trả tối đa 1000 dòng/lần → lấy theo trang cho tới hết. Truy vấn phải có order ổn định. */
export async function fetchAll(page: (from: number, to: number) => PromiseLike<QueryResult>, pageSize = 1000): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += pageSize) {
    const batch = await run<Row[]>(page(from, from + pageSize - 1))
    rows.push(...batch)
    if (batch.length < pageSize) return rows
  }
}

/** Bỏ timestamps (DB tự điền) trước khi gửi lên. */
export function toWriteRow(record: object): Row {
  const { createdAt: _c, updatedAt: _u, ...rest } = record as Row
  return toRow(rest)
}

/**
 * CRUD chung. Ghi: validate toàn bộ bản ghi bằng Zod TRƯỚC khi gửi (lỗi hiện ngay ở form, không tốn
 * request). Đọc: parse lại bằng Zod → dữ liệu vào app luôn đúng kiểu, cột lạ (user_id) bị loại bỏ.
 */
export function createEntityRepo<T extends { id: string; createdAt: string }, M extends TimestampMode = 'both'>(
  client: SupabaseClient,
  table: string,
  schema: z.ZodType<T>,
  timestamps: M,
) {
  const parse = (row: Row) => validate(schema, fromRow(row))
  const parseMany = (rows: Row[]) => rows.map(parse)
  const stamp = (createdAt: string, now: string) =>
    timestamps === 'both' ? { createdAt, updatedAt: now } : { createdAt }

  async function get(id: string): Promise<T | undefined> {
    const row = await run<Row | null>(client.from(table).select('*').eq('id', id).maybeSingle())
    return row ? parse(row) : undefined
  }

  async function getOrThrow(id: string): Promise<T> {
    const found = await get(id)
    if (!found) throw new NotFoundError(`${table}#${id}`)
    return found
  }

  return {
    parse,
    parseMany,

    get,
    getOrThrow,

    async list(): Promise<T[]> {
      return parseMany(await fetchAll((from, to) => client.from(table).select('*').order('id').range(from, to)))
    },

    async create(input: NewRecord<T, M>): Promise<T> {
      const now = nowIso()
      const record = validate(schema, { ...input, id: input.id ?? newId(), ...stamp(now, now) })
      return parse(await run<Row>(client.from(table).insert(toWriteRow(record)).select('*').single()))
    },

    async update(id: string, patch: RecordPatch<T, M>): Promise<T> {
      const existing = await getOrThrow(id)
      const record = validate(schema, { ...existing, ...patch, id, ...stamp(existing.createdAt, nowIso()) })
      const { id: _id, ...changes } = toWriteRow(record)
      return parse(await run<Row>(client.from(table).update(changes).eq('id', id).select('*').single()))
    },

    async remove(id: string): Promise<void> {
      await run(client.from(table).delete().eq('id', id))
    },
  }
}
