import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildBackup, toReplacePayload } from '../../src/data/backup'
import { AuthRequiredError, ConflictError, ForbiddenError, fromDbError, ValidationError } from '../../src/data/errors'
import { fromRow, sqlTable, type Row } from '../../src/data/mappers'
import { buildCategorySeed } from '../../src/data/seed/categories'
import {
  accountSchema,
  assetValuationSchema,
  budgetLineSchema,
  budgetMonthSchema,
  categorySchema,
  depositTermSchema,
  holdingSchema,
  investmentTradeSchema,
  netWorthSnapshotSchema,
  priceQuoteSchema,
  recurringRuleSchema,
  settingsSchema,
  TABLE_NAMES,
  transactionSchema,
  type Account,
  type Category,
  type TableName,
} from '../../src/schemas'
import { cashAccount, expenseTx, holding, loanAccount, recurringRule, trade, transferTx } from '../../src/test/factories'
import { asUser, createTestDb, signUp, type Query, type TestDb } from './harness'

let db: TestDb
let lan: string
let hung: string

beforeAll(async () => {
  db = await createTestDb()
  lan = await signUp(db, 'lan@example.com')
  hung = await signUp(db, 'hung@example.com')
}, 60_000)

afterAll(async () => {
  await db.close()
})

/** Chạy SQL và trả về lỗi đã được đổi sang lỗi nghiệp vụ (như repo nhận được từ PostgREST). */
async function failure(p: Promise<unknown>): Promise<Error> {
  try {
    await p
  } catch (e) {
    return fromDbError(e as { code?: string; message: string })
  }
  throw new Error('Mong đợi lỗi nhưng câu lệnh thành công')
}

async function seedUser(q: Query) {
  const categories = buildCategorySeed('basic')
  for (const c of categories) await q.insert('categories', categorySchema, c)
  const byName = (name: string) => categories.find((c) => c.name === name)!
  const bank = await q.insert<Account>('accounts', accountSchema, cashAccount())
  const cash = await q.insert<Account>('accounts', accountSchema, cashAccount({ name: 'Tiền mặt', kind: 'cash', openingBalance: 2_000_000 }))
  return { categories, byName, bank, cash }
}

describe('đăng ký & settings', () => {
  it('trigger tạo settings mặc định zero-based cho người dùng mới', async () => {
    const [row] = await asUser(db, lan, (q) => q.rows('select * from public.settings'))
    const settings = settingsSchema.parse(fromRow(row!))
    expect(settings.defaultBudgetMode).toBe('zero_based')
    expect(settings.alertThresholds).toEqual([0.8, 1])
  })

  it('người dùng sửa được settings của mình nhưng không tự tạo/xóa được', async () => {
    await asUser(db, lan, (q) => q.exec('update public.settings set period_start_day = 5'))
    const [row] = await asUser(db, lan, (q) => q.rows('select period_start_day from public.settings'))
    expect(row!.period_start_day).toBe(5)
    await expect(asUser(db, lan, (q) => q.exec('delete from public.settings'))).rejects.toThrow(/permission denied/)
  })
})

describe('Row Level Security — tách dữ liệu giữa người dùng', () => {
  let lanBankId: string

  beforeAll(async () => {
    const acc = await asUser(db, lan, (q) => q.insert<Account>('accounts', accountSchema, cashAccount({ name: 'VCB của Lan' })))
    lanBankId = acc.id
  })

  it('người khác không nhìn thấy, không sửa/xóa được', async () => {
    expect(await asUser(db, hung, (q) => q.rows('select * from public.accounts where id = $1', [lanBankId]))).toEqual([])
    await asUser(db, hung, (q) => q.exec(`update public.accounts set name = 'hack' where id = $1`, [lanBankId]))
    await asUser(db, hung, (q) => q.exec('delete from public.accounts where id = $1', [lanBankId]))
    const [row] = await asUser(db, lan, (q) => q.rows('select name from public.accounts where id = $1', [lanBankId]))
    expect(row!.name).toBe('VCB của Lan')
  })

  it('không thể ghi dữ liệu mang user_id của người khác', async () => {
    const err = await failure(
      asUser(db, hung, (q) =>
        q.exec(
          `insert into public.accounts (user_id, name, kind, class, opening_balance, opening_date, is_liquid)
           values ($1, 'x', 'cash', 'asset', 0, '2026-08-01', true)`,
          [lan],
        ),
      ),
    )
    expect(err).toBeInstanceOf(ForbiddenError)
  })

  it('không thể tham chiếu tài khoản của người khác trong giao dịch', async () => {
    const err = await failure(
      asUser(db, hung, async (q) => {
        const cat = await q.insert<Category>('categories', categorySchema, buildCategorySeed('basic')[0]!)
        await q.insert('transactions', transactionSchema, { ...expenseTx({ accountId: lanBankId }), type: 'income', categoryId: cat.id })
      }),
    )
    expect(err).toBeInstanceOf(ValidationError)
  })

  it('khách chưa đăng nhập (anon) không đọc được gì', async () => {
    const err = await failure(asUser(db, null, (q) => q.rows('select * from public.accounts')))
    expect(err).toBeInstanceOf(AuthRequiredError)
  })
})

describe('ràng buộc trong DB (lớp chặn cuối cùng)', () => {
  // Câu SQL thô, bỏ qua Zod, để chứng minh DB tự chặn được dữ liệu sai.
  const rawAccount = (q: Query, name: string, extra = '') =>
    q.exec(
      `insert into public.accounts (name, kind, class, opening_balance, opening_date, is_liquid ${extra ? ', archived_at' : ''})
       values ($1, 'ewallet', 'asset', 0, '2026-08-01', true ${extra ? ", now()" : ''})`,
      [name],
    )

  it('tên tài khoản không trùng (không phân biệt hoa thường), trừ tài khoản đã lưu trữ', async () => {
    await asUser(db, lan, (q) => rawAccount(q, 'MoMo'))
    const err = await failure(asUser(db, lan, (q) => rawAccount(q, ' momo ')))
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.message).toBe('Đã có tài khoản cùng tên')
    await asUser(db, lan, (q) => rawAccount(q, 'MoMo', 'archived'))
    await asUser(db, hung, (q) => rawAccount(q, 'MoMo')) // người khác được dùng cùng tên
  })

  it('class phải khớp kind; khoản nợ không phải quỹ khẩn cấp', async () => {
    const mismatch = await failure(
      asUser(db, lan, (q) =>
        q.exec(`insert into public.accounts (name, kind, class, opening_balance, opening_date, is_liquid)
                values ('Nợ?', 'cash', 'liability', 0, '2026-08-01', false)`),
      ),
    )
    expect(mismatch).toBeInstanceOf(ValidationError)
    expect(mismatch.message).toContain('accounts_class_matches_kind')
  })

  it('giao dịch: đúng hình dạng theo loại, trước ngày bắt đầu bị chặn, danh mục phải là lá và đúng loại', async () => {
    await asUser(db, lan, async (q) => {
      const { byName, bank, cash } = await seedUser(q)
      const food = byName('Ăn uống')
      const finance = byName('Tài chính') // nhóm cha, không phải lá
      const salary = byName('Lương')
      const tx = (over: object) => ({ ...expenseTx({ accountId: bank.id, categoryId: food.id }), ...over })

      await q.insert('transactions', transactionSchema, tx({}))
      await q.insert('transactions', transactionSchema, transferTx({ accountId: bank.id, toAccountId: cash.id }))

      const cases: [object, string][] = [
        [tx({ date: '2026-07-31' }), 'trước ngày bắt đầu theo dõi'],
        [tx({ categoryId: finance.id }), 'Hãy chọn danh mục con'],
        [tx({ categoryId: salary.id }), 'không đúng loại thu/chi'],
      ]
      for (const [record, message] of cases) {
        await q.exec('savepoint s')
        const err = await failure(q.insert('transactions', transactionSchema, record))
        await q.exec('rollback to savepoint s')
        expect(err).toBeInstanceOf(ValidationError)
        expect(err.message).toContain(message)
      }

      await q.exec('savepoint s')
      const selfTransfer = await failure(
        q.exec(
          `insert into public.transactions (type, date, amount, account_id, to_account_id)
           values ('transfer', '2026-08-10', 1000, $1, $1)`,
          [bank.id],
        ),
      )
      await q.exec('rollback to savepoint s')
      expect(selfTransfer.message).toContain('transactions_shape')
    })
  })

  it('không ghi được thu nhập vào khoản nợ', async () => {
    await asUser(db, hung, async (q) => {
      const cats = buildCategorySeed('basic')
      for (const c of cats) await q.insert('categories', categorySchema, c)
      const loan = await q.insert<Account>('accounts', accountSchema, loanAccount())
      const err = await failure(
        q.insert('transactions', transactionSchema, {
          ...expenseTx({ accountId: loan.id }),
          type: 'income',
          categoryId: cats.find((c) => c.name === 'Lương')!.id,
        }),
      )
      expect(err.message).toBe('Không thể ghi thu nhập vào khoản nợ')
    })
  })

  it('idempotencyKey: không trùng trong cùng người dùng, người khác dùng lại được', async () => {
    const key = 'recurring:rule-1:2026-09-05'
    const insertWithKey = (userId: string) =>
      asUser(db, userId, async (q) => {
        const accs = await q.rows(`select id from public.accounts where kind = 'bank' limit 1`)
        const cats = await q.rows(`select id from public.categories where name = 'Ăn uống'`)
        await q.insert('transactions', transactionSchema, {
          ...expenseTx({ accountId: String(accs[0]!.id), categoryId: String(cats[0]!.id) }),
          origin: 'recurring',
          idempotencyKey: key,
        })
      })

    await asUser(db, hung, async (q) => {
      for (const c of buildCategorySeed('basic')) await q.insert('categories', categorySchema, c)
      await q.insert('accounts', accountSchema, cashAccount({ name: 'BIDV' }))
    })
    await insertWithKey(lan)
    const dup = await failure(insertWithKey(lan))
    expect(dup).toBeInstanceOf(ConflictError)
    expect(dup.message).toBe('Giao dịch này đã được ghi trước đó')
    await insertWithKey(hung)
  })

  it('không xóa được tài khoản đang có giao dịch (I9)', async () => {
    const err = await failure(
      asUser(db, lan, async (q) => {
        const [acc] = await q.rows(`select id from public.accounts where name = 'Vietcombank'`)
        await q.exec('delete from public.accounts where id = $1', [acc!.id])
      }),
    )
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.message).toContain('đang được sử dụng')
  })

  it('danh mục tối đa 2 cấp, con cùng loại với cha', async () => {
    await asUser(db, lan, async (q) => {
      const [food] = await q.rows(`select id from public.categories where name = 'Ăn uống'`)
      const [salary] = await q.rows(`select id from public.categories where name = 'Lương'`)
      const child = await q.insert<Category>('categories', categorySchema, {
        ...buildCategorySeed('basic')[0]!, id: crypto.randomUUID(), name: 'Ăn ngoài', type: 'expense', bucket: 'wants', parentId: String(food!.id),
      })

      await q.exec('savepoint s')
      const tooDeep = await failure(
        q.insert('categories', categorySchema, { ...child, id: crypto.randomUUID(), name: 'Phở', parentId: child.id }),
      )
      await q.exec('rollback to savepoint s')
      expect(tooDeep.message).toBe('Danh mục chỉ có tối đa 2 cấp')

      const wrongType = await failure(
        q.insert('categories', categorySchema, { ...child, id: crypto.randomUUID(), name: 'Lẫn lộn', parentId: String(salary!.id) }),
      )
      expect(wrongType.message).toBe('Danh mục con phải cùng loại thu/chi với danh mục cha')
    })
  })

  it('dòng ngân sách: phải có tháng trước, targetKey khớp target, một dòng mỗi target', async () => {
    await asUser(db, lan, async (q) => {
      const target = { kind: 'category', categoryId: crypto.randomUUID() }
      const line = { month: '2026-08', target, targetKey: `c:${target.categoryId}`, planned: 3_500_000, rollover: true }

      await q.exec('savepoint s')
      expect(await failure(q.insert('budget_lines', budgetLineSchema, line))).toBeInstanceOf(ValidationError)
      await q.exec('rollback to savepoint s')

      await q.insert('budget_months', budgetMonthSchema, {
        month: '2026-08', mode: 'zero_based', expectedIncome: 18_000_000, status: 'open', closedAt: null, note: null,
      })
      await q.insert('budget_lines', budgetLineSchema, line)

      await q.exec('savepoint s')
      const dup = await failure(q.insert('budget_lines', budgetLineSchema, { ...line, planned: 1 }))
      await q.exec('rollback to savepoint s')
      expect(dup.message).toBe('Dòng ngân sách này đã tồn tại trong tháng')

      const badKey = await failure(
        q.exec(
          `insert into public.budget_lines (month, target, target_key, planned) values ('2026-08', $1::jsonb, 'a:sai', 0)`,
          [JSON.stringify(target)],
        ),
      )
      expect(badKey.message).toContain('budget_lines_target_key_matches')
    })
  })

  it('snapshot: net_worth phải bằng tài sản − nợ', async () => {
    const err = await failure(
      asUser(db, lan, (q) =>
        q.exec(`insert into public.net_worth_snapshots (month, as_of, total_assets, total_liabilities, net_worth, liquid_assets)
                values ('2026-08', '2026-08-31', 100, 30, 80, 0)`),
      ),
    )
    expect(err.message).toContain('net_worth_snapshots_check')
  })
})

// ---------------------------------------------------------------------------
// Sao lưu & khôi phục qua hàm SQL replace_all_data
// ---------------------------------------------------------------------------

const SCHEMA_BY_TABLE = {
  settings: settingsSchema,
  accounts: accountSchema,
  categories: categorySchema,
  transactions: transactionSchema,
  holdings: holdingSchema,
  investmentTrades: investmentTradeSchema,
  priceQuotes: priceQuoteSchema,
  depositTerms: depositTermSchema,
  assetValuations: assetValuationSchema,
  budgetMonths: budgetMonthSchema,
  budgetLines: budgetLineSchema,
  recurringRules: recurringRuleSchema,
  netWorthSnapshots: netWorthSnapshotSchema,
} as const satisfies Record<TableName, unknown>

/** Giống exportAll() nhưng đọc qua SQL: mọi bảng của người dùng, đổi sang camelCase, sắp theo id. */
async function exportAs(userId: string) {
  const data = await asUser(db, userId, async (q) => {
    const entries: [TableName, Row[]][] = []
    for (const name of TABLE_NAMES) {
      const rows = await q.rows(`select * from public.${sqlTable(name)}`)
      entries.push([name, rows.map(fromRow).sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')))])
    }
    return Object.fromEntries(entries) as Record<TableName, Row[]>
  })
  const { exportedAt: _ignored, ...rest } = buildBackup(data)
  return rest
}

describe('sao lưu & khôi phục', () => {
  let mai: string
  let fresh: string

  beforeAll(async () => {
    mai = await signUp(db, 'mai@example.com')
    fresh = await signUp(db, 'mai-moi@example.com')
    // Dữ liệu chạm tới mọi bảng.
    await asUser(db, mai, async (q) => {
      await q.exec(`update public.settings set theme = 'dark', onboarding_completed = true`)
      const { byName, bank } = await seedUser(q)
      const inv = await q.insert<Account>('accounts', accountSchema, {
        ...cashAccount({ name: 'Chứng khoán' }), kind: 'investment', isLiquid: false,
        details: { platform: 'SSI', costMethod: 'average' },
      })
      const house = await q.insert<Account>('accounts', accountSchema, {
        ...cashAccount({ name: 'Căn hộ' }), kind: 'other_asset', isLiquid: false, openingBalance: 3_000_000_000,
      })
      const td = await q.insert<Account>('accounts', accountSchema, {
        ...cashAccount({ name: 'Sổ ABC' }), kind: 'term_deposit', isLiquid: false, openingBalance: 100_000_000,
        details: { bankName: 'ABC', interestPayout: 'at_maturity', maturityAction: 'renew_principal', payoutAccountId: bank.id, earlyWithdrawalRate: 0.001, dayCountBasis: 365 },
      })
      const fpt = await q.insert<{ id: string }>('holdings', holdingSchema, holding({ accountId: inv.id }))
      await q.insert('investment_trades', investmentTradeSchema, trade({ holdingId: fpt.id, cashAccountId: inv.id, quantity: '0.00125' }))
      await q.insert('price_quotes', priceQuoteSchema, { symbol: 'FPT', date: '2026-08-20', price: 125_000 })
      await q.insert('deposit_terms', depositTermSchema, {
        accountId: td.id, seq: 1, principal: 100_000_000, annualRate: 0.055, termMonths: 6,
        startDate: '2026-08-01', maturityDate: '2027-02-01', status: 'active', interestPaid: 0, closedAt: null,
      })
      await q.insert('asset_valuations', assetValuationSchema, { accountId: house.id, date: '2026-08-15', value: 3_100_000_000, note: null })
      const rule = await q.insert<{ id: string }>('recurring_rules', recurringRuleSchema, recurringRule({
        template: { type: 'income', amount: 18_000_000, accountId: bank.id, categoryId: byName('Lương').id, toAccountId: null, direction: null, note: null, tags: [] },
      }))
      await q.insert('transactions', transactionSchema, {
        ...expenseTx({ accountId: bank.id, categoryId: byName('Lương').id, tags: ['lương', 'tháng 8'] }),
        type: 'income', origin: 'recurring', recurringRuleId: rule.id, idempotencyKey: `recurring:${rule.id}:2026-08-05`,
      })
      await q.insert('budget_months', budgetMonthSchema, {
        month: '2026-08', mode: 'zero_based', expectedIncome: 18_000_000, status: 'closed', closedAt: '2026-09-01T00:00:00+07:00', note: null,
      })
      const target = { kind: 'account', accountId: td.id }
      await q.insert('budget_lines', budgetLineSchema, { month: '2026-08', target, targetKey: `a:${td.id}`, planned: 3_000_000, rollover: false })
      await q.insert('net_worth_snapshots', netWorthSnapshotSchema, {
        month: '2026-08', asOf: '2026-08-31', totalAssets: 100, totalLiabilities: 30, netWorth: 70, liquidAssets: 50,
        byKind: { bank: 50 }, byAccount: { [bank.id]: 50 }, computedAt: '2026-09-01T00:00:00Z', stale: false,
      })
    })
  })

  it('bản xuất phủ mọi bảng và qua được schema', async () => {
    const backup = await exportAs(mai)
    for (const name of TABLE_NAMES) expect(backup.data[name].length, name).toBeGreaterThan(0)
    expect(backup.data.investmentTrades[0]!.quantity).toBe('0.00125') // không mất chính xác
    expect(backup.data.settings[0]!.theme).toBe('dark')
  })

  it('khôi phục vào chính tài khoản đó → dữ liệu y nguyên (bất biến 8)', async () => {
    const before = await exportAs(mai)
    await asUser(db, mai, (q) => q.rpc('replace_all_data', toReplacePayload({ ...before, exportedAt: new Date().toISOString() })))
    expect(await exportAs(mai)).toEqual(before)
  })

  it('khôi phục sang tài khoản mới trong khi tài khoản cũ vẫn còn → không trùng khóa', async () => {
    const source = await exportAs(mai)
    await asUser(db, fresh, (q) => q.rpc('replace_all_data', toReplacePayload({ ...source, exportedAt: new Date().toISOString() })))
    expect(await exportAs(fresh)).toEqual(source)
    expect(await exportAs(mai)).toEqual(source)
  })

  it('file có dòng sai → rollback toàn bộ, dữ liệu hiện tại nguyên vẹn (E6, E14)', async () => {
    const before = await exportAs(mai)
    const broken = structuredClone(before)
    broken.data.transactions[0]!.date = '2020-01-01' // trước ngày mở tài khoản → trigger chặn giữa chừng
    const err = await failure(
      asUser(db, mai, (q) => q.rpc('replace_all_data', toReplacePayload({ ...broken, exportedAt: new Date().toISOString() }))),
    )
    expect(err.message).toContain('trước ngày bắt đầu theo dõi')
    expect(await exportAs(mai)).toEqual(before)
  })

  it('chưa đăng nhập thì không gọi được', async () => {
    const err = await failure(asUser(db, null, (q) => q.rpc('replace_all_data', {})))
    expect(err).toBeInstanceOf(AuthRequiredError)
  })
})

describe('schema TS ↔ bảng SQL', () => {
  it('mọi trường của schema Zod đều có cột tương ứng trong bảng', async () => {
    const columns = await asUser(db, lan, (q) =>
      q.rows(`select table_name, column_name from information_schema.columns where table_schema = 'public'`),
    )
    const byTable = new Map<string, Set<string>>()
    for (const c of columns) {
      const set = byTable.get(String(c.table_name)) ?? new Set<string>()
      set.add(String(c.column_name))
      byTable.set(String(c.table_name), set)
    }
    for (const name of TABLE_NAMES) {
      const schema = SCHEMA_BY_TABLE[name]
      const def = (schema as unknown as { def: { options?: { shape: object }[]; shape?: object; in?: { shape: object } } }).def
      const shapes = def.options?.map((o) => o.shape) ?? [def.shape ?? def.in?.shape ?? {}]
      const fields = new Set(shapes.flatMap((s) => Object.keys(s)))
      for (const field of fields) {
        const column = field.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`)
        expect(byTable.get(sqlTable(name))?.has(column), `${sqlTable(name)}.${column}`).toBe(true)
      }
    }
  })
})
