import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { NewRecord } from '../data/repositories/base'
import { averageSpending, copyLines, suggestLines503020, type BudgetLineDraft } from '../domain/budget'
import { addMonthsToKey } from '../domain/dates'
import { periodRange, previousMonth } from '../domain/period'
import { checkTransaction, type CheckWarning, type TransactionCheckContext } from '../domain/validation'
import { nowIso } from '../lib/clock'
import { newId } from '../lib/id'
import { KIND_META, type Account, type BudgetTarget, type Transaction } from '../schemas'
import { createBudgetMonth } from '../services/budget'
import { updatePrices } from '../services/investments'
import { budgetLineRow, dateSchema, describeTx, guarded, loadSnapshot, monthSchema, ok, type McpDeps, type Snapshot, type ToolResult } from './context'
import { fold, resolveAccount, resolveCategory, ToolError } from './lookup'

// Công cụ GHI: đi qua đúng bộ kiểm tra của form trong app (domain/validation) và ràng buộc Postgres.
// Không bao giờ tự "vẫn lưu": cảnh báo cần xác nhận hoặc nghi trùng → trả về để Claude hỏi người dùng.

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const
/** Thẻ gắn vào giao dịch do Claude ghi — người dùng lọc / xuất CSV để rà lại. */
export const CLAUDE_TAG = 'claude'

const itemSchema = z.object({
  type: z.enum(['expense', 'income', 'transfer', 'refund']).describe('expense = chi, income = thu, transfer = chuyển giữa 2 tài khoản của người dùng (rút ATM, nạp ví, góp quỹ, trả thẻ tín dụng), refund = tiền hoàn lại cho một khoản đã chi'),
  amount: z.number().int().positive().describe('Số tiền, số nguyên đồng (VD 150000)'),
  date: dateSchema.optional().describe('Ngày giao dịch YYYY-MM-DD (mặc định hôm nay)'),
  account: z.string().min(1).describe('Tài khoản trả / nhận tiền: tên hoặc id (VD "Tiền mặt", "Vietcombank"). Với transfer: tài khoản nguồn'),
  to_account: z.string().optional().describe('Chỉ với transfer: tài khoản nhận'),
  category: z.string().optional().describe('Bắt buộc với expense/income/refund: tên danh mục lá hoặc "Nhóm > Danh mục" hoặc id'),
  note: z.string().max(200).optional().describe('Ghi chú, VD tên cửa hàng / nội dung hóa đơn'),
  tags: z.array(z.string().min(1).max(30)).max(8).optional(),
  request_id: z.string().min(1).max(80).optional().describe('Mã duy nhất của khoản này (VD số hóa đơn): gọi lại với cùng mã sẽ không ghi trùng'),
})

type Item = z.infer<typeof itemSchema>

function contextOf(s: Snapshot, transactions: readonly Transaction[]): TransactionCheckContext {
  return {
    accounts: s.view.accounts,
    categories: s.view.categories,
    transactions,
    today: s.today,
    periodStartDay: s.view.settings.periodStartDay,
    closedMonths: new Set(s.data.budgetMonths.filter((m) => m.status === 'closed').map((m) => m.month)),
  }
}

function buildTransaction(item: Item, s: Snapshot): Transaction {
  const account = resolveAccount(s.view.accounts, item.account)
  const now = nowIso()
  const tags = [...new Set([...(item.tags ?? []), CLAUDE_TAG])].slice(0, 10)
  const common = {
    id: newId(),
    date: item.date ?? s.today,
    amount: item.amount,
    accountId: account.id,
    note: item.note?.trim() || null,
    tags,
    groupId: null,
    origin: 'manual' as const,
    recurringRuleId: null,
    idempotencyKey: item.request_id ? `claude:${item.request_id}` : null,
    createdAt: now,
    updatedAt: now,
  }
  if (item.type === 'transfer') {
    if (!item.to_account) throw new ToolError('Giao dịch chuyển tiền cần to_account (tài khoản nhận).')
    const to = resolveAccount(s.view.accounts, item.to_account)
    return { ...common, type: 'transfer', toAccountId: to.id, categoryId: null, direction: null }
  }
  if (!item.category) throw new ToolError(`Giao dịch ${item.type === 'income' ? 'thu' : 'chi'} cần category. Gọi list_categories để chọn.`)
  const category = resolveCategory(s.view.categories, item.category, item.type === 'income' ? 'income' : 'expense')
  return { ...common, type: item.type, categoryId: category.id, toAccountId: null, direction: null } as Transaction
}

/** Giao dịch đã có giống hệt (cùng loại, ngày, số tiền, tài khoản, đích) — dấu hiệu gửi lại cùng một hóa đơn. */
function similarExisting(tx: Transaction, existing: readonly Transaction[]): Transaction[] {
  return existing.filter(
    (t) => t.id !== tx.id && t.type === tx.type && t.date === tx.date && t.amount === tx.amount && t.accountId === tx.accountId && t.toAccountId === tx.toAccountId && t.categoryId === tx.categoryId,
  )
}

const withoutMeta = (t: Transaction): NewRecord<Transaction> => {
  const { createdAt: _c, updatedAt: _u, ...rest } = t
  return rest as NewRecord<Transaction>
}

const warningText = (w: CheckWarning) => w.message

export function registerWriteTools(server: McpServer, deps: McpDeps) {
  server.registerTool(
    'add_transactions',
    {
      title: 'Ghi giao dịch',
      description:
        'Ghi 1–50 giao dịch (VD từ ảnh hóa đơn, sao kê, tin nhắn ngân hàng). Tất cả hoặc không: có lỗi ở bất kỳ khoản nào thì không khoản nào được lưu. Nếu có cảnh báo cần xác nhận (số dư âm, vượt hạn mức thẻ, tháng đã đóng, số tiền bất thường) hoặc nghi trùng với giao dịch đã có, công cụ KHÔNG lưu và trả về lý do — hãy hỏi người dùng rồi gọi lại với confirm_warnings / allow_duplicates = true.',
      inputSchema: {
        transactions: z.array(itemSchema).min(1).max(50),
        confirm_warnings: z.boolean().optional().describe('Người dùng đã đồng ý lưu dù có cảnh báo'),
        allow_duplicates: z.boolean().optional().describe('Người dùng xác nhận đây không phải khoản trùng'),
      },
      annotations: WRITE,
    },
    guarded(async ({ transactions: items, confirm_warnings, allow_duplicates }): Promise<ToolResult> => {
      const s = await loadSnapshot(deps)
      const accepted: Transaction[] = []
      const problems: { index: number; errors?: string[]; warnings?: string[]; possible_duplicates?: ReturnType<typeof describeTx>[] }[] = []
      const info: { index: number; message: string }[] = []

      items.forEach((item, index) => {
        let tx: Transaction
        try {
          tx = buildTransaction(item, s)
        } catch (e) {
          if (e instanceof ToolError) return void problems.push({ index, errors: [e.message] })
          throw e
        }
        // Kiểm tra trên dữ liệu đã gồm các khoản trước trong cùng lô (số dư cộng dồn).
        const { errors, warnings } = checkTransaction(tx, contextOf(s, [...s.view.transactions, ...accepted]))
        const blocking = warnings.filter((w) => w.confirm && w.code !== 'duplicate')
        const dupes = similarExisting(tx, [...s.view.transactions, ...accepted])
        const alreadyWithKey = tx.idempotencyKey ? s.view.transactions.find((t) => t.idempotencyKey === tx.idempotencyKey) : undefined
        if (alreadyWithKey) return void problems.push({ index, errors: [`request_id "${item.request_id}" đã được ghi trước đó (giao dịch ${alreadyWithKey.id}) — không ghi lại.`] })
        const problem: (typeof problems)[number] = { index }
        if (errors.length) problem.errors = errors.map((e) => e.message)
        if (blocking.length && !confirm_warnings) problem.warnings = blocking.map(warningText)
        if (dupes.length && !allow_duplicates) problem.possible_duplicates = dupes.map((d) => describeTx(d, s.view))
        if (problem.errors || problem.warnings || problem.possible_duplicates) problems.push(problem)
        for (const w of warnings.filter((w) => !w.confirm)) info.push({ index, message: w.message })
        accepted.push(tx)
      })

      if (problems.length) {
        const hasErrors = problems.some((p) => p.errors)
        return ok({
          status: 'not_saved',
          saved_count: 0,
          reason: hasErrors ? 'invalid' : 'needs_user_confirmation',
          problems,
          next_step: hasErrors
            ? 'Sửa các khoản có errors rồi gọi lại với toàn bộ danh sách.'
            : 'Hỏi người dùng về các cảnh báo / khoản nghi trùng. Nếu họ đồng ý, gọi lại y hệt kèm confirm_warnings: true và/hoặc allow_duplicates: true.',
        })
      }

      const saved: Transaction[] = []
      for (const tx of accepted) saved.push(await deps.repos.transactions.create(withoutMeta(tx)))
      const after = await loadSnapshot(deps)
      const touched = new Set(saved.flatMap((t) => [t.accountId, t.toAccountId].filter((x): x is string => !!x)))
      return ok({
        status: 'saved',
        saved_count: saved.length,
        transactions: saved.map((t) => describeTx(t, after.view)),
        balances_after: [...touched].map((id) => ({ account: after.view.accountById.get(id)?.name, balance: after.view.balances.get(id) ?? 0 })),
        notes: info,
        tagged_with: CLAUDE_TAG,
      })
    }),
  )

  server.registerTool(
    'update_transaction',
    {
      title: 'Sửa giao dịch',
      description: 'Sửa một giao dịch theo id (lấy id từ search_transactions). Chỉ truyền các trường cần đổi. Không sửa được giao dịch thuộc nghiệp vụ nhiều phần (part_of_group) — hướng dẫn người dùng sửa trong app.',
      inputSchema: {
        id: z.string().min(1),
        date: dateSchema.optional(),
        amount: z.number().int().positive().optional(),
        account: z.string().optional(),
        to_account: z.string().optional(),
        category: z.string().optional(),
        note: z.string().max(200).nullable().optional(),
        confirm_warnings: z.boolean().optional(),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    guarded(async (a) => {
      const s = await loadSnapshot(deps)
      const current = s.view.transactions.find((t) => t.id === a.id)
      if (!current) throw new ToolError(`Không tìm thấy giao dịch ${a.id}.`)
      if (current.groupId) throw new ToolError('Giao dịch này thuộc một nghiệp vụ nhiều phần (VD trả nợ gồm gốc + lãi). Hãy sửa trong app để các phần luôn khớp nhau.')
      if (current.type === 'adjustment') throw new ToolError('Không sửa giao dịch điều chỉnh số dư qua Claude — dùng "Đối soát số dư" trong app.')
      const next: Transaction = { ...current, updatedAt: nowIso() }
      if (a.date) next.date = a.date
      if (a.amount) next.amount = a.amount
      if (a.note !== undefined) next.note = a.note?.trim() || null
      if (a.account) next.accountId = resolveAccount(s.view.accounts, a.account).id
      if (a.to_account) {
        if (next.type !== 'transfer') throw new ToolError('to_account chỉ dùng cho giao dịch chuyển tiền.')
        next.toAccountId = resolveAccount(s.view.accounts, a.to_account).id
      }
      if (a.category) {
        if (next.type === 'transfer') throw new ToolError('Giao dịch chuyển tiền không có danh mục.')
        next.categoryId = resolveCategory(s.view.categories, a.category, next.type === 'income' ? 'income' : 'expense').id
      }
      const { errors, warnings } = checkTransaction(next, { ...contextOf(s, s.view.transactions), editing: current })
      if (errors.length) return ok({ status: 'not_saved', reason: 'invalid', errors: errors.map((e) => e.message) })
      const blocking = warnings.filter((w) => w.confirm && w.code !== 'duplicate')
      if (blocking.length && !a.confirm_warnings) return ok({ status: 'not_saved', reason: 'needs_user_confirmation', warnings: blocking.map(warningText) })
      const { id: _id, ...patch } = withoutMeta(next)
      const saved = await deps.repos.transactions.update(current.id, patch)
      return ok({ status: 'saved', before: describeTx(current, s.view), after: describeTx(saved, s.view) })
    }),
  )

  server.registerTool(
    'delete_transaction',
    {
      title: 'Xóa giao dịch',
      description: 'Xóa hẳn một giao dịch theo id. Luôn xác nhận với người dùng trước (nêu ngày, số tiền, nội dung). Không xóa được giao dịch thuộc nghiệp vụ nhiều phần — hướng dẫn xóa trong app.',
      inputSchema: { id: z.string().min(1) },
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    },
    guarded(async ({ id }) => {
      const s = await loadSnapshot(deps)
      const tx = s.view.transactions.find((t) => t.id === id)
      if (!tx) throw new ToolError(`Không tìm thấy giao dịch ${id} (có thể đã xóa).`)
      if (tx.groupId) throw new ToolError('Giao dịch này thuộc một nghiệp vụ nhiều phần (VD trả nợ gồm gốc + lãi, hoặc lệnh mua cổ phiếu kèm phí). Hãy xóa trong app — app sẽ xóa đủ các phần cùng lúc.')
      await deps.repos.transactions.remove(tx.id)
      return ok({ status: 'deleted', transaction: describeTx(tx, s.view) })
    }),
  )

  server.registerTool(
    'set_budget',
    {
      title: 'Lập / sửa ngân sách',
      description:
        'Tạo ngân sách cho một tháng (nếu chưa có) và/hoặc đặt số tiền kế hoạch cho từng dòng. Tạo mới: create_from = copy_previous (sao chép tháng trước), rule_50_30_20 (chia theo 50/30/20 dựa trên chi tiêu thực tế) hoặc empty; expected_income bắt buộc khi tạo nếu tháng trước chưa có. Dòng có planned = 0 sẽ bị bỏ. Không sửa được tháng đã đóng.',
      inputSchema: {
        month: monthSchema.describe('Tháng tài chính YYYY-MM'),
        expected_income: z.number().int().nonnegative().optional(),
        create_from: z.enum(['copy_previous', 'rule_50_30_20', 'empty']).optional(),
        lines: z
          .array(
            z.object({
              category: z.string().optional().describe('Danh mục chi (tên hoặc nhóm)'),
              fund: z.string().optional().describe('Hoặc quỹ / khoản nợ để giao tiền tiết kiệm, trả nợ'),
              planned: z.number().int().nonnegative(),
              rollover: z.boolean().optional().describe('Chuyển phần dư / thiếu sang tháng sau'),
            }),
          )
          .max(60)
          .optional(),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    guarded(async (a) => {
      const s = await loadSnapshot(deps)
      const startDay = s.view.settings.periodStartDay
      const existing = s.data.budgetMonths.find((m) => m.month === a.month)
      if (existing?.status === 'closed') throw new ToolError(`Tháng ${a.month} đã đóng. Mở lại tháng trong app trước khi sửa ngân sách.`)
      const previous = s.data.budgetMonths.find((m) => m.month === previousMonth(a.month))

      if (!existing) {
        const expectedIncome = a.expected_income ?? previous?.expectedIncome
        if (expectedIncome === undefined) throw new ToolError('Tháng trước chưa có ngân sách — cần expected_income (thu nhập dự kiến) để tạo.')
        const strategy = a.create_from ?? (previous ? 'copy_previous' : 'empty')
        let drafts: BudgetLineDraft[] = []
        if (strategy === 'copy_previous') {
          if (!previous) throw new ToolError('Tháng trước chưa có ngân sách để sao chép — dùng create_from "rule_50_30_20" hoặc "empty".')
          drafts = copyLines(s.data.budgetLines.filter((l) => l.month === previous.month))
        } else if (strategy === 'rule_50_30_20') {
          // Chia trong mỗi nhóm theo mức chi trung bình 3 tháng trước (như nút "Theo quy tắc 50/30/20" trong app).
          const ranges = [1, 2, 3].map((back) => periodRange(addMonthsToKey(a.month, -back), startDay))
          const fund = s.view.accounts.find((x) => x.isEmergencyFund && !x.archivedAt) ?? s.view.accounts.find((x) => x.kind === 'goal_fund' && !x.archivedAt)
          drafts = suggestLines503020(expectedIncome, s.view.categories, fund?.id ?? null, (id) => averageSpending(id, s.view.categories, s.view.transactions, ranges))
        }
        await createBudgetMonth(deps.repos, a.month, { mode: previous?.mode ?? s.view.settings.defaultBudgetMode, expectedIncome, lines: drafts })
      } else if (a.expected_income !== undefined) {
        await deps.repos.budgetMonths.update(existing.id, { expectedIncome: a.expected_income })
      }

      const changed: string[] = []
      for (const line of a.lines ?? []) {
        let target: BudgetTarget
        let name: string
        if (line.category) {
          const c = resolveBudgetCategory(s, line.category)
          target = { kind: 'category', categoryId: c.id }
          name = c.name
        } else if (line.fund) {
          const acc = resolveAccount(s.view.accounts, line.fund)
          if (!['goal_fund', 'term_deposit', 'investment', 'loan', 'credit_card', 'bnpl', 'personal_debt', 'bank'].includes(acc.kind)) {
            throw new ToolError(`"${acc.name}" (${KIND_META[acc.kind].label}) không dùng làm dòng tiết kiệm / trả nợ được.`)
          }
          target = { kind: 'account', accountId: acc.id }
          name = acc.name
        } else throw new ToolError('Mỗi dòng cần category hoặc fund.')
        const current = (await deps.repos.budgetLines.byMonth(a.month)).find((l) => (l.target.kind === 'category' ? `c:${l.target.categoryId}` : `a:${l.target.accountId}`) === (target.kind === 'category' ? `c:${target.categoryId}` : `a:${target.accountId}`))
        if (line.planned === 0) {
          if (current) await deps.repos.budgetLines.remove(current.id)
        } else {
          await deps.repos.budgetLines.upsert(a.month, target, { planned: line.planned, rollover: line.rollover ?? current?.rollover ?? false })
        }
        changed.push(name)
      }

      const after = await loadSnapshot(deps)
      const summary = after.overview.chain.get(a.month)!
      return ok({
        status: existing ? 'updated' : 'created',
        month: a.month,
        changed_lines: changed,
        expected_income: summary.expectedIncome,
        total_planned: summary.totalPlanned,
        unassigned: summary.unassigned,
        lines: summary.lines.map((l) => budgetLineRow(l, after.view)),
      })
    }),
  )

  server.registerTool(
    'create_account',
    {
      title: 'Thêm tài khoản',
      description: 'Thêm tài khoản tiền mặt, ngân hàng, ví điện tử hoặc quỹ mục tiêu với số dư hiện tại. (Sổ tiết kiệm, đầu tư, khoản vay, thẻ tín dụng cần nhiều thông tin — hướng dẫn người dùng thêm trong app.)',
      inputSchema: {
        name: z.string().trim().min(1).max(50),
        kind: z.enum(['cash', 'bank', 'ewallet', 'goal_fund']),
        opening_balance: z.number().int().nonnegative().describe('Số dư tại ngày bắt đầu theo dõi'),
        opening_date: dateSchema.optional().describe('Ngày bắt đầu theo dõi (mặc định hôm nay); giao dịch trước ngày này không ghi được'),
        is_emergency_fund: z.boolean().optional(),
        goal_amount: z.number().int().positive().optional().describe('Quỹ mục tiêu: số tiền cần đạt'),
        goal_date: dateSchema.optional().describe('Quỹ mục tiêu: hạn đạt'),
        note: z.string().max(500).optional(),
      },
      annotations: WRITE,
    },
    guarded(async (a) => {
      const s = await loadSnapshot(deps)
      const date = a.opening_date ?? s.today
      if (date > s.today) throw new ToolError('Ngày bắt đầu theo dõi không được ở tương lai.')
      if (a.goal_date && !a.goal_amount) throw new ToolError('Có goal_date thì cần goal_amount.')
      if (a.goal_date && a.goal_date <= s.today) throw new ToolError('Hạn mục tiêu phải sau hôm nay.')
      const record = {
        name: a.name,
        kind: a.kind,
        class: 'asset',
        currency: 'VND',
        openingBalance: a.opening_balance,
        openingDate: date,
        isLiquid: KIND_META[a.kind].isLiquid,
        includeInNetWorth: true,
        isEmergencyFund: a.is_emergency_fund ?? false,
        goal: a.goal_amount ? { targetAmount: a.goal_amount, targetDate: a.goal_date ?? null } : null,
        archivedAt: null,
        icon: null,
        color: null,
        note: a.note || null,
        sortOrder: Math.max(0, ...s.view.accounts.map((x) => x.sortOrder)) + 1,
        details: null,
      } as NewRecord<Account>
      const created = await deps.repos.accounts.create(record)
      return ok({ status: 'created', account: { id: created.id, name: created.name, kind_text: KIND_META[created.kind].label, balance: created.openingBalance, tracked_since: created.openingDate } })
    }),
  )

  server.registerTool(
    'update_investment_prices',
    {
      title: 'Cập nhật giá đầu tư',
      description: 'Cập nhật giá hiện tại của các mã đang nắm giữ (VD đọc từ ảnh chụp app chứng khoán). Giá là đồng / đơn vị (cổ phiếu, chứng chỉ quỹ, chỉ vàng…). Chỉ nhận mã đã có trong danh mục đầu tư.',
      inputSchema: {
        date: dateSchema.optional().describe('Ngày của giá (mặc định hôm nay)'),
        prices: z.array(z.object({ symbol: z.string().min(1).max(20), price: z.number().int().positive() })).min(1).max(50),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    guarded(async (a) => {
      const s = await loadSnapshot(deps)
      const known = new Map(s.data.holdings.map((h) => [h.symbol.toUpperCase(), h.symbol]))
      const unknown = a.prices.filter((p) => !known.has(p.symbol.toUpperCase())).map((p) => p.symbol)
      if (unknown.length) throw new ToolError(`Không có mã ${unknown.join(', ')} trong danh mục. Mã đang có: ${[...known.values()].join(', ') || '(chưa có)'}.`)
      const date = a.date ?? s.today
      if (date > s.today) throw new ToolError('Ngày của giá không được ở tương lai.')
      await updatePrices(deps.repos, date, a.prices.map((p) => ({ symbol: known.get(p.symbol.toUpperCase())!, price: p.price })))
      const after = await loadSnapshot(deps)
      return ok({
        status: 'saved',
        date,
        holdings: after.view.accounts
          .filter((x) => x.kind === 'investment' && !x.archivedAt)
          .flatMap((x) => after.view.ledger.holdingValuations(x, after.today))
          .filter((h) => a.prices.some((p) => p.symbol.toUpperCase() === h.holding.symbol.toUpperCase()))
          .map((h) => ({ symbol: h.holding.symbol, price: h.price, market_value: h.marketValue, unrealized_gain: h.unrealized, return_pct: h.returnPct })),
        net_worth_today: after.overview.netWorth.netWorth,
      })
    }),
  )
}

/** Dòng ngân sách nhận cả nhóm cha (gom danh mục con), khác với giao dịch chỉ nhận danh mục lá. */
function resolveBudgetCategory(s: Snapshot, ref: string) {
  const expense = s.view.categories.filter((c) => c.type === 'expense' && !c.archivedAt)
  const groups = expense.filter((c) => !c.parentId && expense.some((x) => x.parentId === c.id))
  try {
    return resolveCategory(s.view.categories, ref, 'expense')
  } catch (e) {
    const group = groups.find((g) => g.id === ref || fold(g.name) === fold(ref))
    if (group) return group
    throw e
  }
}
