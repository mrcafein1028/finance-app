import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AuthRequiredError, fromDbError, ValidationError } from '../../src/data/errors'
import { toRow } from '../../src/data/mappers'
import { buildCategorySeed } from '../../src/data/seed/categories'
import { accountSchema, categorySchema, type Account } from '../../src/schemas'
import { cashAccount, loanAccount } from '../../src/test/factories'
import { asUser, createTestDb, signUp, type TestDb } from './harness'

let db: TestDb
let userId: string
let bank: Account
let loan: Account
let interestCategory: string

beforeAll(async () => {
  db = await createTestDb()
  userId = await signUp(db, 'hung@example.com')
  await asUser(db, userId, async (q) => {
    const cats = buildCategorySeed('basic')
    for (const c of cats) await q.insert('categories', categorySchema, c)
    interestCategory = cats.find((c) => c.systemKey === 'loan_interest')!.id
    bank = await q.insert<Account>('accounts', accountSchema, cashAccount({ openingBalance: 100_000_000 }))
    loan = await q.insert<Account>('accounts', accountSchema, loanAccount())
  })
}, 60_000)

afterAll(() => db.close())

const groupId = '00000000-0000-4000-8000-000000000001'
const payment = (principal: number, interest: number, date = '2026-09-10') => [
  toRow({ type: 'transfer', date, amount: principal, accountId: bank.id, toAccountId: loan.id }),
  toRow({ type: 'expense', date, amount: interest, accountId: bank.id, categoryId: interestCategory }),
]

async function failure(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    return fromDbError(e as { code?: string; message: string })
  }
  throw new Error('Mong đợi lỗi')
}

const groupRows = () =>
  asUser(db, userId, (q) => q.rows('select type, amount, group_id from public.transactions where group_id = $1 order by type', [groupId]))

describe('nhóm giao dịch (bất biến I8)', () => {
  it('ghi cả nhóm trong một lần, gắn cùng group_id', async () => {
    const saved = await asUser(db, userId, (q) =>
      q.rows('select * from public.save_transaction_group($1, $2::jsonb)', [groupId, JSON.stringify(payment(5_000_000, 9_000_000))]),
    )
    expect(saved).toHaveLength(2)
    expect(await groupRows()).toEqual([
      { type: 'expense', amount: 9_000_000, group_id: groupId },
      { type: 'transfer', amount: 5_000_000, group_id: groupId },
    ])
  })

  it('sửa nhóm = thay toàn bộ; một dòng lỗi → nhóm cũ giữ nguyên', async () => {
    await asUser(db, userId, (q) =>
      q.rows('select * from public.save_transaction_group($1, $2::jsonb)', [groupId, JSON.stringify(payment(5_000_000, 8_900_000))]),
    )
    expect((await groupRows()).map((r) => r.amount)).toEqual([8_900_000, 5_000_000])

    const bad = payment(5_000_000, 9_000_000)
    bad[1]!.date = '2020-01-01' // trước ngày mở tài khoản
    const err = await failure(
      asUser(db, userId, (q) => q.rows('select * from public.save_transaction_group($1, $2::jsonb)', [groupId, JSON.stringify(bad)])),
    )
    expect(err).toBeInstanceOf(ValidationError)
    expect((await groupRows()).map((r) => r.amount)).toEqual([8_900_000, 5_000_000])
  })

  it('nhóm rỗng bị từ chối; xóa nhóm xóa hết mọi phần', async () => {
    const empty = await failure(asUser(db, userId, (q) => q.rows('select * from public.save_transaction_group($1, $2::jsonb)', [groupId, '[]'])))
    expect(empty.message).toBe('Nhóm giao dịch phải có ít nhất một giao dịch')

    const [row] = await asUser(db, userId, (q) => q.rows('select public.delete_transaction_group($1) as n', [groupId]))
    expect(row!.n).toBe(2)
    expect(await groupRows()).toEqual([])
  })

  it('người khác / khách không dùng được', async () => {
    const other = await signUp(db, 'x@example.com')
    await asUser(db, userId, (q) =>
      q.rows('select * from public.save_transaction_group($1, $2::jsonb)', [groupId, JSON.stringify(payment(1_000_000, 1))]),
    )
    const [row] = await asUser(db, other, (q) => q.rows('select public.delete_transaction_group($1) as n', [groupId]))
    expect(row!.n).toBe(0) // RLS: không thấy nhóm của người khác
    expect(await groupRows()).toHaveLength(2)
    expect(await failure(asUser(db, null, (q) => q.rows('select public.delete_transaction_group($1)', [groupId])))).toBeInstanceOf(AuthRequiredError)
  })
})
