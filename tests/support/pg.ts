// Postgres nhúng (PGlite) chạy đúng các file migration của Supabase — dùng chung cho
// test cơ sở dữ liệu (tests/db) và backend giả của E2E (tests/e2e/fake-backend.ts).
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))

// Giống Supabase: vai trò anon/authenticated, bảng auth.users, hàm auth.uid() đọc claim "sub" của JWT.
const SUPABASE_AUTH_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`

/** Mọi migration theo thứ tự tên file, trừ phần Storage (PGlite không có schema storage). */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.includes('storage'))
    .sort()
}

export async function createMigratedDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(SUPABASE_AUTH_STUB)
  for (const file of migrationFiles()) await db.exec(readFileSync(MIGRATIONS_DIR + file, 'utf8'))
  return db
}

/** Mô phỏng đăng ký: thêm vào auth.users (trigger sẽ tạo settings). */
export async function insertAuthUser(db: PGlite, email: string, id: string = crypto.randomUUID()): Promise<string> {
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email])
  return id
}
