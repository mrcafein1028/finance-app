// Chạy migration Supabase trên PGlite (Postgres 17 trong WASM) để test ràng buộc, trigger và RLS
// mà không cần Docker hay tài khoản Supabase. Phần "auth" của Supabase được giả lập tối thiểu.
import type { PGlite } from '@electric-sql/pglite'
import type { z } from 'zod'
import { fromRow, toRow, type Row } from '../../src/data/mappers'
import { toWriteRow, validate } from '../../src/data/repositories/base'
import { createMigratedDb, insertAuthUser } from '../support/pg'

export type TestDb = PGlite

export const createTestDb = createMigratedDb

/** Mô phỏng đăng ký: thêm vào auth.users (trigger sẽ tạo settings). */
export const signUp = (db: TestDb, email: string) => insertAuthUser(db, email)

/**
 * Chạy `fn` như một request PostgREST của người dùng `userId`: vai trò authenticated + JWT sub.
 * Mọi thứ trong một transaction; lỗi → rollback, giống một request thất bại.
 */
export async function asUser<T>(db: TestDb, userId: string | null, fn: (q: Query) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`)
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ''])
    return fn(makeQuery(tx))
  })
}

type Tx = Parameters<Parameters<PGlite['transaction']>[0]>[0]

export interface Query {
  /** SELECT trả về dòng dạng JSON y như PostgREST (to_jsonb): ngày là chuỗi, bigint là number. */
  rows(sql: string, params?: unknown[]): Promise<Row[]>
  exec(sql: string, params?: unknown[]): Promise<void>
  /** Mô phỏng repo.create: validate bằng Zod → bỏ timestamps → INSERT → parse kết quả bằng Zod. */
  insert<T>(table: string, schema: z.ZodType<T>, record: object): Promise<T>
  rpc(fn: string, args: unknown): Promise<void>
}

function makeQuery(tx: Tx): Query {
  const rows = async (sql: string, params: unknown[] = []) =>
    (await tx.query<{ r: Row }>(`select to_jsonb(t) as r from (${sql}) t`, params)).rows.map((x) => x.r)

  return {
    rows,
    async exec(sql, params = []) {
      await tx.query(sql, params)
    },
    async insert(table, schema, record) {
      const now = new Date().toISOString()
      const valid = validate(schema, { id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...record })
      const row = toWriteRow(valid as object)
      const cols = Object.keys(row)
      const result = await tx.query<{ r: Row }>(
        `insert into public.${table} (${cols.map((c) => `"${c}"`).join(', ')})
         select ${cols.map((c) => `"${c}"`).join(', ')} from jsonb_populate_record(null::public.${table}, $1::jsonb)
         returning to_jsonb(${table}.*) as r`,
        [JSON.stringify(row)],
      )
      return validate(schema, fromRow(result.rows[0]!.r))
    },
    async rpc(fn, args) {
      await tx.query(`select public.${fn}($1::jsonb)`, [JSON.stringify(args)])
    },
  }
}

export { toRow }
