import type { SupabaseClient } from '@supabase/supabase-js'
import {
  accountSchema,
  assetValuationSchema,
  budgetLineSchema,
  budgetMonthSchema,
  budgetTargetKey,
  categorySchema,
  CURRENT_SCHEMA_VERSION,
  depositTermSchema,
  holdingSchema,
  investmentTradeSchema,
  netWorthSnapshotSchema,
  priceQuoteSchema,
  recurringRuleSchema,
  settingsSchema,
  transactionSchema,
  type AccountKind,
  type BudgetLine,
  type BudgetTarget,
  type Category,
  type CategoryType,
  type NetWorthSnapshot,
  type Settings,
  type SystemCategoryKey,
  type Transaction,
} from '../../schemas'
import { nowIso } from '../../lib/clock'
import { newId } from '../../lib/id'
import { AuthRequiredError } from '../errors'
import { fromRow, toRow, type Row } from '../mappers'
import { createEntityRepo, fetchAll, run, toWriteRow, validate } from './base'

/** Giá trị mặc định — trùng với DEFAULT trong bảng settings (supabase/migrations). */
export const DEFAULT_SETTINGS: Settings = {
  currency: 'VND',
  locale: 'vi-VN',
  periodStartDay: 1,
  defaultBudgetMode: 'zero_based',
  includeAccruedInterest: true,
  allowNegativeRollover: true,
  alertThresholds: [0.8, 1],
  emergencyTargetMonths: 6,
  theme: 'system',
  onboardingCompleted: false,
  lastBackupAt: null,
  schemaVersion: CURRENT_SCHEMA_VERSION,
}

async function currentUserId(client: SupabaseClient, knownUserId?: string): Promise<string> {
  // Máy chủ MCP không có phiên trình duyệt: đã xác thực token trước và truyền userId vào.
  if (knownUserId) return knownUserId
  const { data } = await client.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new AuthRequiredError()
  return id
}

function createSettingsRepo(client: SupabaseClient, knownUserId?: string) {
  const parse = (row: Row) => validate(settingsSchema, fromRow(row))

  /** Dòng settings được tạo bởi trigger khi đăng ký; phòng trường hợp chưa có thì dùng mặc định. */
  async function get(): Promise<Settings> {
    const row = await run<Row | null>(client.from('settings').select('*').maybeSingle())
    return row ? parse(row) : DEFAULT_SETTINGS
  }

  return {
    get,
    async update(patch: Partial<Settings>): Promise<Settings> {
      const next = validate(settingsSchema, { ...(await get()), ...patch })
      const userId = await currentUserId(client, knownUserId)
      return parse(await run<Row>(client.from('settings').update(toRow(next)).eq('user_id', userId).select('*').single()))
    },
  }
}

function createAccountsRepo(client: SupabaseClient) {
  const base = createEntityRepo(client, 'accounts', accountSchema, 'both')
  return {
    ...base,
    // Tên trùng được chặn bởi unique index accounts_active_name_key → ConflictError.
    listActive: async () =>
      base.parseMany(
        await fetchAll((f, t) => client.from('accounts').select('*').is('archived_at', null).order('sort_order').order('id').range(f, t)),
      ),
    /** Xóa hẳn tài khoản cùng mọi giao dịch, lệnh, kỳ gửi, định giá, dòng ngân sách gắn với nó (một transaction). */
    deleteCascade: async (id: string) =>
      run<{ transactions: number; trades: number; recurring_rules: number }>(client.rpc('delete_account_cascade', { p_account: id })),
    byKind: async (kind: AccountKind) =>
      base.parseMany(await fetchAll((f, t) => client.from('accounts').select('*').eq('kind', kind).order('id').range(f, t))),
  }
}

function createCategoriesRepo(client: SupabaseClient) {
  const base = createEntityRepo(client, 'categories', categorySchema, 'both')
  return {
    ...base,
    byType: async (type: CategoryType) =>
      base.parseMany(await fetchAll((f, t) => client.from('categories').select('*').eq('type', type).order('sort_order').order('id').range(f, t))),
    children: async (parentId: string) =>
      base.parseMany(await fetchAll((f, t) => client.from('categories').select('*').eq('parent_id', parentId).order('sort_order').order('id').range(f, t))),
    bySystemKey: async (key: SystemCategoryKey) => {
      const row = await run<Row | null>(client.from('categories').select('*').eq('system_key', key).maybeSingle())
      return row ? base.parse(row) : undefined
    },
    /** Gộp `fromId` vào `toId` (giao dịch, ngân sách, mẫu định kỳ) rồi xóa `fromId` — một transaction. Trả về số giao dịch đã chuyển. */
    merge: async (fromId: string, toId: string) => run<number>(client.rpc('merge_category', { p_from: fromId, p_to: toId })),
    /** Ghi cả bộ danh mục mẫu trong một request (cha trước con trong cùng câu lệnh INSERT). */
    async bulkCreate(records: Category[]) {
      const rows = records.map((r) => toWriteRow(validate(categorySchema, r)))
      return base.parseMany(await run<Row[]>(client.from('categories').insert(rows).select('*')))
    },
  }
}

function createTransactionsRepo(client: SupabaseClient) {
  const base = createEntityRepo(client, 'transactions', transactionSchema, 'both')
  const MIN_DATE = '0001-01-01'
  const MAX_DATE = '9999-12-31'
  return {
    ...base,

    /** Giao dịch trong khoảng ngày [from, to], cả hai đầu. */
    inRange: async (from: string, to: string) =>
      base.parseMany(
        await fetchAll((f, t) => client.from('transactions').select('*').gte('date', from).lte('date', to).order('date').order('id').range(f, t)),
      ),

    /** Mọi giao dịch chạm tới account — cả vai trò nguồn lẫn đích của chuyển khoản. */
    byAccount: async (accountId: string, from = MIN_DATE, to = MAX_DATE) =>
      base.parseMany(
        await fetchAll((f, t) =>
          client
            .from('transactions')
            .select('*')
            .or(`account_id.eq.${accountId},to_account_id.eq.${accountId}`)
            .gte('date', from)
            .lte('date', to)
            .order('date')
            .order('id')
            .range(f, t),
        ),
      ),

    byCategory: async (categoryId: string, from: string, to: string) =>
      base.parseMany(
        await fetchAll((f, t) =>
          client.from('transactions').select('*').eq('category_id', categoryId).gte('date', from).lte('date', to).order('date').order('id').range(f, t),
        ),
      ),

    byGroup: async (groupId: string) =>
      base.parseMany(await run<Row[]>(client.from('transactions').select('*').eq('group_id', groupId).order('id'))),

    byIdempotencyKey: async (key: string) => {
      const row = await run<Row | null>(client.from('transactions').select('*').eq('idempotency_key', key).maybeSingle())
      return row ? base.parse(row) : undefined
    },

    /** Ghi đè cả nhóm trong MỘT transaction (hàm SQL save_transaction_group, bất biến I8). */
    saveGroup: async (groupId: string, records: readonly Transaction[]) => {
      const rows = records.map((r) => {
        const { group_id: _g, ...row } = toWriteRow(validate(transactionSchema, { ...r, groupId }))
        return row
      })
      return base.parseMany(await run<Row[]>(client.rpc('save_transaction_group', { p_group_id: groupId, p_rows: rows })))
    },

    deleteGroup: async (groupId: string) => run<number>(client.rpc('delete_transaction_group', { p_group_id: groupId })),
  }
}

function createInvestmentRepos(client: SupabaseClient) {
  const holdings = createEntityRepo(client, 'holdings', holdingSchema, 'both')
  const trades = createEntityRepo(client, 'investment_trades', investmentTradeSchema, 'both')
  const quotes = createEntityRepo(client, 'price_quotes', priceQuoteSchema, 'created')
  return {
    holdings: {
      ...holdings,
      byAccount: async (accountId: string) =>
        holdings.parseMany(await run<Row[]>(client.from('holdings').select('*').eq('account_id', accountId).order('symbol'))),
    },
    trades: {
      ...trades,
      /** Theo thứ tự thời gian — quan trọng khi tính giá vốn bình quân. */
      byHolding: async (holdingId: string) =>
        trades.parseMany(
          await fetchAll((f, t) =>
            client.from('investment_trades').select('*').eq('holding_id', holdingId).order('date').order('created_at').order('id').range(f, t),
          ),
        ),
    },
    priceQuotes: {
      ...quotes,
      /** Giá gần nhất có ngày ≤ date. */
      latestOnOrBefore: async (symbol: string, date: string) => {
        const row = await run<Row | null>(
          client.from('price_quotes').select('*').eq('symbol', symbol).lte('date', date).order('date', { ascending: false }).limit(1).maybeSingle(),
        )
        return row ? quotes.parse(row) : undefined
      },
      /** Mỗi mã một giá mỗi ngày: nhập lại thì ghi đè. */
      upsert: async (symbol: string, date: string, price: number) => {
        const valid = validate(priceQuoteSchema, { id: newId(), symbol, date, price, createdAt: nowIso() })
        const payload = { symbol: valid.symbol, date: valid.date, price: valid.price }
        const row = await run<Row>(
          client.from('price_quotes').upsert(payload, { onConflict: 'user_id,symbol,date' }).select('*').single(),
        )
        return quotes.parse(row)
      },
    },
  }
}

function createBudgetRepos(client: SupabaseClient) {
  const months = createEntityRepo(client, 'budget_months', budgetMonthSchema, 'both')
  const lines = createEntityRepo(client, 'budget_lines', budgetLineSchema, 'both')
  return {
    months: {
      ...months,
      byMonth: async (month: string) => {
        const row = await run<Row | null>(client.from('budget_months').select('*').eq('month', month).maybeSingle())
        return row ? months.parse(row) : undefined
      },
    },
    lines: {
      ...lines,
      byMonth: async (month: string) =>
        lines.parseMany(await run<Row[]>(client.from('budget_lines').select('*').eq('month', month).order('id'))),
      /** Tạo hoặc cập nhật dòng duy nhất cho (tháng, target). Tháng phải có BudgetMonth trước (khóa ngoại). */
      upsert: async (month: string, target: BudgetTarget, values: Pick<BudgetLine, 'planned' | 'rollover'>) => {
        const now = nowIso()
        const valid = validate(budgetLineSchema, {
          id: newId(), month, target, targetKey: budgetTargetKey(target), ...values, createdAt: now, updatedAt: now,
        })
        const { id: _id, ...payload } = toWriteRow(valid)
        const row = await run<Row>(
          client.from('budget_lines').upsert(payload, { onConflict: 'user_id,month,target_key' }).select('*').single(),
        )
        return lines.parse(row)
      },
    },
  }
}

function createSnapshotsRepo(client: SupabaseClient) {
  const parse = (row: Row) => validate(netWorthSnapshotSchema, fromRow(row))
  return {
    byMonth: async (month: string) => {
      const row = await run<Row | null>(client.from('net_worth_snapshots').select('*').eq('month', month).maybeSingle())
      return row ? parse(row) : undefined
    },
    list: async () =>
      (await fetchAll((f, t) => client.from('net_worth_snapshots').select('*').order('month').range(f, t))).map(parse),
    /** Ghi (hoặc ghi đè) snapshot của một tháng. */
    put: async (snapshot: NetWorthSnapshot) => {
      const { id: _id, ...rest } = toRow(validate(netWorthSnapshotSchema, snapshot))
      const row = await run<Row>(client.from('net_worth_snapshots').upsert(rest, { onConflict: 'user_id,month' }).select('*').single())
      return parse(row)
    },
    /** Dữ liệu thuộc tháng `month` thay đổi → mọi snapshot từ tháng đó trở đi phải tính lại. */
    markStaleFrom: async (month: string) => {
      await run(client.from('net_worth_snapshots').update({ stale: true }).gte('month', month))
    },
  }
}

export interface RepositoryOptions {
  /** Người dùng đã xác thực (máy chủ MCP). Bỏ trống ở trình duyệt: lấy từ phiên đăng nhập. */
  userId?: string
}

export function createRepositories(client: SupabaseClient, options: RepositoryOptions = {}) {
  const investment = createInvestmentRepos(client)
  const budget = createBudgetRepos(client)
  const recurring = createEntityRepo(client, 'recurring_rules', recurringRuleSchema, 'both')
  const depositTerms = createEntityRepo(client, 'deposit_terms', depositTermSchema, 'both')
  const valuations = createEntityRepo(client, 'asset_valuations', assetValuationSchema, 'created')

  return {
    settings: createSettingsRepo(client, options.userId),
    accounts: createAccountsRepo(client),
    categories: createCategoriesRepo(client),
    transactions: createTransactionsRepo(client),
    holdings: investment.holdings,
    trades: investment.trades,
    priceQuotes: investment.priceQuotes,
    depositTerms: {
      ...depositTerms,
      byAccount: async (accountId: string) =>
        depositTerms.parseMany(await run<Row[]>(client.from('deposit_terms').select('*').eq('account_id', accountId).order('seq'))),
      active: async () =>
        depositTerms.parseMany(await run<Row[]>(client.from('deposit_terms').select('*').eq('status', 'active').order('maturity_date'))),
    },
    assetValuations: {
      ...valuations,
      latestOnOrBefore: async (accountId: string, date: string) => {
        const row = await run<Row | null>(
          client.from('asset_valuations').select('*').eq('account_id', accountId).lte('date', date).order('date', { ascending: false }).limit(1).maybeSingle(),
        )
        return row ? valuations.parse(row) : undefined
      },
    },
    budgetMonths: budget.months,
    budgetLines: budget.lines,
    recurringRules: {
      ...recurring,
      dueOnOrBefore: async (date: string) =>
        recurring.parseMany(
          await run<Row[]>(client.from('recurring_rules').select('*').lte('next_date', date).is('paused_at', null).order('next_date')),
        ),
    },
    snapshots: createSnapshotsRepo(client),
  }
}

export type Repositories = ReturnType<typeof createRepositories>
