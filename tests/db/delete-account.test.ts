import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toReplacePayload } from '../../src/data/backup'
import { buildDemoBackup, type DemoPersona } from '../../src/data/demo'
import { fromDbError } from '../../src/data/errors'
import { deletionImpact } from '../../src/services/accountEdit'
import { buildBackup } from '../../src/data/backup'
import { fromRow } from '../../src/data/mappers'
import { TABLE_NAMES, type BackupFile } from '../../src/schemas'
import { asUser, createTestDb, signUp, type TestDb } from './harness'

let db: TestDb
const users = {} as Record<DemoPersona, string>

beforeAll(async () => {
  db = await createTestDb()
  for (const p of ['hung', 'mai'] as const) {
    users[p] = await signUp(db, `${p}@example.com`)
    const payload = toReplacePayload(buildDemoBackup(p, '2026-09-25'))
    await asUser(db, users[p], (q) => q.rows('select public.replace_all_data($1::jsonb) as ok', [JSON.stringify(payload)]))
  }
}, 60_000)

afterAll(() => db.close())

const sql = (user: string, text: string, params: unknown[] = []) => asUser(db, user, (q) => q.rows(text, params))
const accountId = async (user: string, name: string) => (await sql(user, 'select id from public.accounts where name = $1', [name]))[0]!.id as string
const drop = (user: string, id: string) => sql(user, 'select public.delete_account_cascade($1) as r', [id]).then((r) => r[0]!.r as Record<string, number>)

/** Đọc lại toàn bộ dữ liệu như client, để so với bản xem trước deletionImpact(). */
async function snapshot(user: string): Promise<BackupFile['data']> {
  const out: Record<string, unknown[]> = {}
  const tables: Record<string, string> = { accounts: 'accounts', transactions: 'transactions', investmentTrades: 'investment_trades', holdings: 'holdings', recurringRules: 'recurring_rules', budgetLines: 'budget_lines' }
  for (const t of TABLE_NAMES) out[t] = tables[t] ? (await sql(user, `select * from public.${tables[t]}`)).map(fromRow) : []
  out.settings = []
  return (buildBackup as unknown as (d: unknown) => BackupFile)(out).data
}

async function failure(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    return fromDbError(e as { code?: string; message: string })
  }
  throw new Error('Mong đợi lỗi')
}

describe('xóa hẳn tài khoản kèm dữ liệu (delete_account_cascade)', () => {
  it('Hùng: không xóa được Vietcombank vì sổ tiết kiệm đang nhận lãi vào đó — không mất gì', async () => {
    const vcb = await accountId(users.hung, 'Vietcombank')
    const before = await sql(users.hung, 'select count(*)::int as n from public.transactions')
    expect((await failure(drop(users.hung, vcb))).message).toBe('Sổ tiết kiệm "Sổ ABC 6 tháng" đang nhận lãi vào tài khoản này — hãy đổi tài khoản nhận lãi của sổ đó trước')
    expect(await sql(users.hung, 'select count(*)::int as n from public.transactions')).toEqual(before)
  })

  it('Hùng: xóa khoản vay → xóa CẢ NHÓM trả nợ (gốc + lãi), số dư ngân hàng khôi phục; bản xem trước khớp', async () => {
    const loan = await accountId(users.hung, 'Vay mua nhà')
    const data = await snapshot(users.hung)
    const acc = data.accounts.find((a) => a.id === loan)!
    const preview = deletionImpact(acc, { accounts: data.accounts, transactions: data.transactions, trades: data.investmentTrades, holdings: data.holdings, recurringRules: data.recurringRules, budgetLines: data.budgetLines })
    expect(preview).toMatchObject({ transactions: 2, trades: 0, blockedBy: null })

    const result = await drop(users.hung, loan)
    expect(result).toEqual({ transactions: 2, trades: 0, recurring_rules: 0 })
    expect(await sql(users.hung, `select note from public.transactions where category_id = (select id from public.categories where system_key = 'loan_interest')`)).toEqual([])
    expect(await sql(users.hung, 'select id from public.accounts where id = $1', [loan])).toEqual([])
    expect(await sql(users.hung, 'select name from public.accounts order by name')).toEqual([{ name: 'Căn hộ' }, { name: 'Sổ ABC 6 tháng' }, { name: 'Vietcombank' }])
  })

  it('Mai: xóa tài khoản chứng khoán → lệnh, mã, giao dịch phí, lần nạp tiền đều mất; tài khoản khác nguyên vẹn', async () => {
    const ck = await accountId(users.mai, 'Chứng khoán')
    const other = await sql(users.mai, 'select count(*)::int as n from public.transactions where account_id <> $1 and coalesce(to_account_id, account_id) <> $1 and group_id is null', [ck])
    const result = await drop(users.mai, ck)
    expect(result.trades).toBe(3)
    expect(await sql(users.mai, 'select count(*)::int as n from public.investment_trades')).toEqual([{ n: 0 }])
    expect(await sql(users.mai, 'select count(*)::int as n from public.holdings')).toEqual([{ n: 0 }])
    expect(await sql(users.mai, `select count(*)::int as n from public.transactions where category_id = (select id from public.categories where system_key = 'investment_fee_tax')`)).toEqual([{ n: 0 }])
    expect(await sql(users.mai, 'select count(*)::int as n from public.transactions')).toEqual(other)
  })

  it('người khác không xóa được tài khoản của mình (RLS)', async () => {
    const vcbMai = await accountId(users.mai, 'Vietcombank')
    expect((await failure(drop(users.hung, vcbMai))).message).toBe('Không tìm thấy tài khoản')
    expect(await sql(users.mai, 'select id from public.accounts where id = $1', [vcbMai])).toHaveLength(1)
  })
})
