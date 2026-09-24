import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fromDbError, ValidationError } from '../../src/data/errors'
import { buildCategorySeed } from '../../src/data/seed/categories'
import { accountSchema, budgetLineSchema, budgetMonthSchema, categorySchema, transactionSchema, type Account, type Category } from '../../src/schemas'
import { cashAccount, expenseTx } from '../../src/test/factories'
import { asUser, createTestDb, signUp, type TestDb } from './harness'

let db: TestDb
let uid: string
let cats: Category[]
let bank: Account
const byName = (n: string) => cats.find((c) => c.name === n)!

beforeAll(async () => {
  db = await createTestDb()
  uid = await signUp(db, 'lan@example.com')
  cats = buildCategorySeed('basic')
  await asUser(db, uid, async (q) => {
    for (const c of cats) await q.insert('categories', categorySchema, c)
    bank = await q.insert<Account>('accounts', accountSchema, cashAccount())
    for (const [name, amount] of [['Giải trí', 100_000], ['Giải trí', 200_000], ['Mua sắm', 50_000]] as const) {
      await q.insert('transactions', transactionSchema, expenseTx({ accountId: bank.id, categoryId: byName(name).id, amount }))
    }
    for (const month of ['2026-08', '2026-09']) {
      await q.insert('budget_months', budgetMonthSchema, { month, mode: 'zero_based', expectedIncome: 0, status: 'open', closedAt: null, note: null })
    }
    const line = (month: string, name: string, planned: number) => {
      const target = { kind: 'category', categoryId: byName(name).id }
      return q.insert('budget_lines', budgetLineSchema, { month, target, targetKey: `c:${target.categoryId}`, planned, rollover: false })
    }
    await line('2026-08', 'Giải trí', 1_000_000)
    await line('2026-08', 'Mua sắm', 500_000)
    await line('2026-09', 'Giải trí', 700_000)
  })
}, 60_000)

afterAll(() => db.close())

async function failure(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    return fromDbError(e as { code?: string; message: string })
  }
  throw new Error('Mong đợi lỗi')
}

describe('gộp danh mục (W15, E5)', () => {
  it('chặn: danh mục hệ thống, khác loại, gộp vào nhóm cha', async () => {
    const run = (from: string, to: string) => asUser(db, uid, (q) => q.rows('select public.merge_category($1, $2) as n', [from, to]))
    expect((await failure(run(byName('Lãi vay').id, byName('Chi khác').id))).message).toBe('Không thể xóa danh mục hệ thống')
    expect((await failure(run(byName('Giải trí').id, byName('Lương').id))).message).toBe('Chỉ gộp được vào danh mục cùng loại thu/chi')
    expect(await failure(run(byName('Giải trí').id, byName('Tài chính').id))).toBeInstanceOf(ValidationError)
  })

  it('Giải trí → Mua sắm: tổng chi không đổi, ngân sách cộng dồn / chuyển target, danh mục cũ bị xóa', async () => {
    const totalBefore = await asUser(db, uid, (q) => q.rows(`select sum(amount)::bigint as s from public.transactions`))
    const [r] = await asUser(db, uid, (q) => q.rows('select public.merge_category($1, $2) as n', [byName('Giải trí').id, byName('Mua sắm').id]))
    expect(r!.n).toBe(2)

    const shopping = byName('Mua sắm').id
    const tx = await asUser(db, uid, (q) => q.rows(`select category_id, count(*)::int as n, sum(amount)::bigint as s from public.transactions group by category_id`))
    expect(tx).toEqual([{ category_id: shopping, n: 3, s: 350_000 }])
    expect((await asUser(db, uid, (q) => q.rows(`select sum(amount)::bigint as s from public.transactions`)))[0]).toEqual(totalBefore[0])

    const lines = await asUser(db, uid, (q) => q.rows(`select month, planned, target_key from public.budget_lines order by month`))
    expect(lines).toEqual([
      { month: '2026-08', planned: 1_500_000, target_key: `c:${shopping}` },
      { month: '2026-09', planned: 700_000, target_key: `c:${shopping}` },
    ])
    expect(await asUser(db, uid, (q) => q.rows(`select id from public.categories where id = $1`, [byName('Giải trí').id]))).toEqual([])
  })
})

describe('dữ liệu demo 3 persona', async () => {
  const { buildDemoBackup } = await import('../../src/data/demo')
  const { toReplacePayload } = await import('../../src/data/backup')
  it.each(['lan', 'hung', 'mai'] as const)('%s: dời ngày về tháng trước, qua được schema + mọi ràng buộc Postgres', async (persona) => {
    const backup = buildDemoBackup(persona, '2027-03-15')
    const all = JSON.stringify(backup.data)
    expect(all).not.toMatch(/"date":"2027-0[4-9]/) // không có giao dịch ở tương lai
    const user = await signUp(db, `${persona}@demo.vn`)
    await asUser(db, user, (q) => q.rpc('replace_all_data', toReplacePayload(backup)))
    const [n] = await asUser(db, user, (q) => q.rows('select count(*)::int as n from public.transactions'))
    expect(n!.n).toBeGreaterThan(0)
  })
})
