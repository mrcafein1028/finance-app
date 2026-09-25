import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { bucketBreakdown, withDescendants } from '../domain/budget'
import { addDays } from '../domain/dates'
import { topInsights } from '../domain/insights'
import { creditCardMinimumPayment, creditCardMonthsToPayoff } from '../domain/loan'
import { explainNetWorthChange, netWorthAt } from '../domain/networth'
import { periodRange, previousMonth } from '../domain/period'
import { cashflowSeries, netWorthSeries, recentMonths, spendingByTopCategory } from '../domain/reports'
import { termActiveAt, termInterest } from '../domain/savings'
import { KIND_META, type AccountOf } from '../schemas'
import { isLoan, upcomingSchedule } from '../services/liabilities'
import { upcomingItems } from '../services/overview'
import { pendingOccurrences } from '../services/recurring'
import { transactionsCsv } from '../services/settings'
import { budgetLineRow, dateSchema, describeTx, guarded, loadSnapshot, monthSchema, ok, RATING_TEXT, type McpDeps } from './context'
import { fold, resolveAccount, ToolError } from './lookup'

const READ = { readOnlyHint: true, openWorldHint: false } as const

const indicator = (i: { value: number | null; rating: keyof typeof RATING_TEXT | null }) => ({
  value: i.value,
  rating: i.rating,
  rating_text: i.rating ? RATING_TEXT[i.rating] : 'Chưa đủ dữ liệu',
})

export function registerReadTools(server: McpServer, deps: McpDeps) {
  server.registerTool(
    'get_financial_overview',
    {
      title: 'Tổng quan tài chính',
      description:
        'Bức tranh hiện tại: net worth (tài sản − nợ), 4 chỉ số sức khỏe tài chính kèm xếp loại, ngân sách tháng này, các gợi ý đáng chú ý và việc sắp đến hạn (trả nợ, sổ đáo hạn, giao dịch định kỳ). Gọi đầu tiên khi người dùng hỏi chung về tình hình tài chính.',
      inputSchema: {},
      annotations: READ,
    },
    guarded(async () => {
      const { overview, view, data, today } = await loadSnapshot(deps)
      const { netWorth, health, budget } = overview
      return ok({
        today,
        current_month: overview.currentMonth,
        current_period: { start: overview.currentRange.start, end: overview.currentRange.end },
        net_worth: {
          value: netWorth.netWorth,
          total_assets: netWorth.totalAssets,
          total_liabilities: netWorth.totalLiabilities,
          liquid_assets: netWorth.liquidAssets,
          at_end_of_last_period: overview.previousNetWorth,
          change_since_last_period: overview.previousNetWorth === null ? null : netWorth.netWorth - overview.previousNetWorth,
        },
        health: {
          measured_month: overview.lastEnded?.month ?? null,
          savings_rate: { ...indicator(health.savingsRate), meaning: '(thu − chi) / thu của tháng đã kết thúc gần nhất; tốt ≥ 20%' },
          emergency_fund_months: { ...indicator(health.emergencyMonths), meaning: 'quỹ khẩn cấp (hoặc tiền dễ rút) / chi thiết yếu trung bình 3 tháng; tốt ≥ 6' },
          debt_to_income: { ...indicator(health.debtToIncome), meaning: 'khoản phải trả nợ hằng tháng / thu nhập; tốt ≤ 30%' },
          debt_to_asset: { ...indicator(health.debtToAsset), meaning: 'tổng nợ / tổng tài sản; tốt ≤ 30%' },
          credit_utilization: indicator(health.creditUtilization),
        },
        budget_this_month: budget
          ? {
              expected_income: budget.expectedIncome,
              unassigned: budget.unassigned,
              actual_income: budget.actualIncome,
              actual_expense: budget.actualExpense,
              lines_needing_attention: budget.lines
                .filter((l) => l.line.target.kind === 'category' && (l.status === 'over' || l.status === 'warning' || l.aheadOfPace))
                .map((l) => budgetLineRow(l, view)),
            }
          : null,
        insights: topInsights(overview.insightContext, new Set(), 5).map((i) => ({ tone: i.tone, priority: i.priority, message: i.message })),
        upcoming_14_days: upcomingItems(overview, data.recurringRules, 14).map((i) => ({ date: i.date, kind: i.kind, label: i.label, amount: i.amount, overdue: i.overdue ?? false })),
        recurring_waiting_for_confirmation: pendingOccurrences(data.recurringRules, today).length,
      })
    }),
  )

  server.registerTool(
    'list_accounts',
    {
      title: 'Danh sách tài khoản',
      description:
        'Mọi tài khoản và số dư hôm nay: tiền mặt, ngân hàng, ví điện tử, quỹ mục tiêu (kèm tiến độ), sổ tiết kiệm, đầu tư, tài sản khác, khoản vay, thẻ tín dụng. Với khoản nợ, balance là số tiền còn nợ (số dương).',
      inputSchema: { include_archived: z.boolean().optional().describe('Gồm cả tài khoản đã lưu trữ (mặc định không)') },
      annotations: READ,
    },
    guarded(async ({ include_archived }) => {
      const { view } = await loadSnapshot(deps)
      const rows = view.accounts
        .filter((a) => include_archived || !a.archivedAt)
        .map((a) => {
          const balance = view.balances.get(a.id) ?? 0
          return {
            id: a.id,
            name: a.name,
            kind: a.kind,
            kind_text: KIND_META[a.kind].label,
            class: a.class,
            balance,
            is_emergency_fund: a.isEmergencyFund,
            goal: a.goal ? { target_amount: a.goal.targetAmount, target_date: a.goal.targetDate, progress: Math.min(1, balance / a.goal.targetAmount) } : null,
            tracked_since: a.openingDate,
            archived: a.archivedAt !== null,
          }
        })
      const active = rows.filter((r) => !r.archived)
      return ok({
        accounts: rows,
        total_assets: active.filter((r) => r.class === 'asset').reduce((s, r) => s + r.balance, 0),
        total_liabilities: active.filter((r) => r.class === 'liability').reduce((s, r) => s + r.balance, 0),
      })
    }),
  )

  server.registerTool(
    'list_categories',
    {
      title: 'Danh mục thu chi',
      description: 'Danh mục thu/chi của người dùng, theo nhóm. Chỉ danh mục có usable_for_transactions = true mới ghi giao dịch được (danh mục lá, chưa lưu trữ).',
      inputSchema: { type: z.enum(['income', 'expense']).optional().describe('Lọc theo loại') },
      annotations: READ,
    },
    guarded(async ({ type }) => {
      const { view } = await loadSnapshot(deps)
      const cats = view.categories.filter((c) => !type || c.type === type)
      return ok({
        categories: cats
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            group: c.parentId ? (view.categoryById.get(c.parentId)?.name ?? null) : null,
            bucket_50_30_20: c.bucket,
            is_system: c.isSystem,
            usable_for_transactions: !c.archivedAt && !view.categories.some((x) => x.parentId === c.id),
            archived: c.archivedAt !== null,
          })),
      })
    }),
  )

  server.registerTool(
    'search_transactions',
    {
      title: 'Tìm giao dịch',
      description:
        'Tìm và liệt kê giao dịch theo khoảng ngày (mặc định tháng tài chính hiện tại), loại, tài khoản, danh mục (gồm danh mục con), số tiền, chữ trong ghi chú. Trả về tổng thu / tổng chi của kết quả. format "csv" trả về bảng CSV để xuất báo cáo.',
      inputSchema: {
        from: dateSchema.optional().describe('Từ ngày (gồm)'),
        to: dateSchema.optional().describe('Đến ngày (gồm)'),
        month: monthSchema.optional().describe('Hoặc một tháng tài chính YYYY-MM (thay cho from/to)'),
        type: z.enum(['expense', 'income', 'transfer', 'refund', 'adjustment']).optional(),
        account: z.string().optional().describe('Tên hoặc id tài khoản'),
        category: z.string().optional().describe('Tên danh mục hoặc nhóm (gồm cả danh mục con)'),
        text: z.string().optional().describe('Chữ cần tìm trong ghi chú, thẻ, tên danh mục'),
        min_amount: z.number().int().nonnegative().optional(),
        max_amount: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(500).optional().describe('Số dòng tối đa (mặc định 50)'),
        format: z.enum(['json', 'csv']).optional(),
      },
      annotations: READ,
    },
    guarded(async (a) => {
      const { view, overview } = await loadSnapshot(deps)
      const startDay = view.settings.periodStartDay
      const range = a.month ? periodRange(a.month, startDay) : { start: a.from ?? (a.to ? '0001-01-01' : overview.currentRange.start), end: a.to ?? (a.from ? '9999-12-31' : overview.currentRange.end) }
      const account = a.account ? resolveAccount(view.accounts, a.account) : null
      let categoryIds: Set<string> | null = null
      if (a.category) {
        const q = fold(a.category)
        const hit = view.categories.find((c) => c.id === a.category || fold(c.name) === q) ?? view.categories.find((c) => fold(c.name).includes(q))
        if (!hit) throw new ToolError(`Không tìm thấy danh mục "${a.category}". Gọi list_categories để xem danh sách.`)
        categoryIds = withDescendants(hit.id, view.categories)
      }
      const text = a.text ? fold(a.text) : null
      const matches = view.transactions.filter((t) => {
        if (t.date < range.start || t.date > range.end) return false
        if (a.type && t.type !== a.type) return false
        if (account && t.accountId !== account.id && t.toAccountId !== account.id) return false
        if (categoryIds && (!t.categoryId || !categoryIds.has(t.categoryId))) return false
        if (a.min_amount !== undefined && t.amount < a.min_amount) return false
        if (a.max_amount !== undefined && t.amount > a.max_amount) return false
        if (text) {
          const hay = fold([t.note ?? '', ...t.tags, t.categoryId ? (view.categoryById.get(t.categoryId)?.name ?? '') : ''].join(' '))
          if (!hay.includes(text)) return false
        }
        return true
      })
      const income = matches.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const expense = matches.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0) - matches.filter((t) => t.type === 'refund').reduce((s, t) => s + t.amount, 0)
      if (a.format === 'csv') {
        return { content: [{ type: 'text' as const, text: transactionsCsv(matches, view.accountById, view.categoryById).replace(/^\uFEFF/, '') }] }
      }
      const limit = a.limit ?? 50
      return ok({
        from: range.start,
        to: range.end,
        count: matches.length,
        total_income: income,
        total_expense_net_of_refunds: expense,
        truncated: matches.length > limit,
        transactions: matches.slice(0, limit).map((t) => describeTx(t, view)),
      })
    }),
  )

  server.registerTool(
    'get_budget',
    {
      title: 'Ngân sách tháng',
      description:
        'Ngân sách một tháng tài chính (mặc định tháng hiện tại): thu nhập dự kiến, phần chưa phân bổ (zero-based hướng tới 0), từng dòng với kế hoạch, số chuyển từ tháng trước, đã chi, còn lại, trạng thái và có đang tiêu nhanh hơn kế hoạch không; chi tiêu ngoài ngân sách.',
      inputSchema: { month: monthSchema.optional() },
      annotations: READ,
    },
    guarded(async ({ month }) => {
      const { view, overview, data } = await loadSnapshot(deps)
      const m = month ?? overview.currentMonth
      const summary = overview.chain.get(m)
      const bm = data.budgetMonths.find((b) => b.month === m)
      if (!summary || !bm) {
        const range = periodRange(m, view.settings.periodStartDay)
        return ok({ month: m, period: range, exists: false, hint: 'Tháng này chưa có ngân sách. Có thể tạo bằng set_budget (sao chép tháng trước, theo 50/30/20 hoặc trống).' })
      }
      return ok({
        month: m,
        period: { start: summary.range.start, end: summary.range.end },
        exists: true,
        mode: bm.mode,
        status: bm.status,
        expected_income: summary.expectedIncome,
        total_planned: summary.totalPlanned,
        unassigned: summary.unassigned,
        actual_income: summary.actualIncome,
        actual_expense: summary.actualExpense,
        net_cash_flow: summary.netCashFlow,
        lines: summary.lines.map((l) => budgetLineRow(l, view)),
        unbudgeted_spending: [...summary.unbudgetedByCategory].map(([id, amount]) => ({ category: view.categoryById.get(id)?.name ?? id, amount })),
      })
    }),
  )

  server.registerTool(
    'get_monthly_report',
    {
      title: 'Báo cáo tháng',
      description:
        'Báo cáo một tháng tài chính (mặc định tháng vừa kết thúc): thu, chi, dòng tiền, tỉ lệ tiết kiệm, cơ cấu 50/30/20 so với mục tiêu, chi nhiều nhất theo nhóm danh mục, vì sao net worth thay đổi (thu nhập, chi tiêu, thị trường, định giá lại, lãi dồn tích…), và kế hoạch so với thực tế.',
      inputSchema: { month: monthSchema.optional() },
      annotations: READ,
    },
    guarded(async ({ month }) => {
      const { view, overview } = await loadSnapshot(deps)
      const m = month ?? previousMonth(overview.currentMonth)
      const range = periodRange(m, view.settings.periodStartDay)
      const b = bucketBreakdown(view.transactions, view.categories, range)
      const expense = b.needs + b.wants
      const end = range.end < overview.now ? range.end : overview.now
      const change = explainNetWorthChange(view.ledger, range.start, end)
      const summary = overview.chain.get(m)
      return ok({
        month: m,
        period: { start: range.start, end: range.end },
        complete: range.end < overview.now,
        income: b.income,
        expense,
        net_cash_flow: b.income - expense,
        savings_rate: b.income > 0 ? (b.income - expense) / b.income : null,
        rule_50_30_20: b.shares ? { needs: b.shares.needs, wants: b.shares.wants, savings_and_debt: b.shares.savings, target: { needs: 0.5, wants: 0.3, savings_and_debt: 0.2 } } : null,
        top_spending: spendingByTopCategory(view.transactions, view.categories, range)
          .slice(0, 8)
          .map((c) => ({ category: view.categoryById.get(c.categoryId)?.name ?? c.categoryId, amount: c.amount, share_of_expense: expense > 0 ? c.amount / expense : null })),
        net_worth_change: {
          start: change.startNetWorth,
          opening_balances_of_new_accounts: change.openingBalances,
          income: change.income,
          expense: change.expense,
          refunds: change.refund,
          adjustments: change.adjustment,
          market_movement: change.market,
          revaluation: change.revaluation,
          accrued_interest: change.accruedInterest,
          external_transfers: change.externalTransfer,
          other: change.other,
          end: change.endNetWorth,
        },
        budget: summary
          ? { expected_income: summary.expectedIncome, over_budget: summary.lines.filter((l) => l.status === 'over' && l.line.target.kind === 'category').map((l) => budgetLineRow(l, view)) }
          : null,
      })
    }),
  )

  server.registerTool(
    'get_trends',
    {
      title: 'Xu hướng nhiều tháng',
      description: 'Theo từng tháng tài chính gần nhất: thu, chi thiết yếu, chi mong muốn, dòng tiền, tỉ lệ tiết kiệm, tài sản, nợ và net worth cuối tháng. Dùng để vẽ biểu đồ hoặc so sánh các tháng.',
      inputSchema: { months: z.number().int().min(2).max(36).optional().describe('Số tháng gần nhất (mặc định 6)') },
      annotations: READ,
    },
    guarded(async ({ months }) => {
      const { view, today } = await loadSnapshot(deps)
      const startDay = view.settings.periodStartDay
      const keys = recentMonths(today, months ?? 6, startDay)
      const flows = cashflowSeries(view.transactions, view.categories, keys, startDay)
      const worth = netWorthSeries(view.ledger, keys, startDay, today)
      return ok({
        months: keys.map((m, i) => ({
          month: m,
          income: flows[i]!.income,
          needs: flows[i]!.needs,
          wants: flows[i]!.wants,
          expense: flows[i]!.expense,
          net_cash_flow: flows[i]!.net,
          savings_rate: flows[i]!.savingsRate,
          assets: worth[i]!.assets,
          liabilities: -worth[i]!.liabilities,
          net_worth: worth[i]!.netWorth,
          net_worth_date: worth[i]!.date,
        })),
      })
    }),
  )

  server.registerTool(
    'get_debts',
    {
      title: 'Khoản nợ',
      description: 'Khoản vay (dư nợ, lãi suất, kỳ trả tới gồm gốc/lãi, ngày trả hết, tổng lãi còn phải trả) và thẻ tín dụng (dư nợ, hạn mức, tỉ lệ sử dụng, tối thiểu phải trả, bao lâu hết nợ nếu chỉ trả tối thiểu).',
      inputSchema: {},
      annotations: READ,
    },
    guarded(async () => {
      const { view, today } = await loadSnapshot(deps)
      const loans = view.accounts
        .filter(isLoan)
        .filter((a) => !a.archivedAt)
        .map((l) => {
          const schedule = upcomingSchedule(l, view.transactions, today)
          const next = schedule[0]
          return {
            id: l.id,
            name: l.name,
            kind_text: KIND_META[l.kind].label,
            lender: l.details.lender,
            outstanding: view.balances.get(l.id) ?? 0,
            annual_rate: l.details.ratePeriods.filter((p) => p.from <= today).at(-1)?.annualRate ?? l.details.ratePeriods[0]!.annualRate,
            rate_type: l.details.rateType,
            next_payment: next ? { due_date: next.dueDate, principal: next.principal, interest: next.interest, total: next.payment, overdue: next.dueDate < today } : null,
            payments_left: schedule.length,
            payoff_date: schedule.at(-1)?.dueDate ?? null,
            remaining_interest: schedule.reduce((s, r) => s + r.interest, 0),
          }
        })
      const cards = view.accounts
        .filter((a): a is AccountOf<'credit_card'> => a.kind === 'credit_card' && !a.archivedAt)
        .map((c) => {
          const balance = Math.max(0, view.balances.get(c.id) ?? 0)
          const minimum = creditCardMinimumPayment(balance, c.details.minPaymentRate)
          return {
            id: c.id,
            name: c.name,
            balance,
            credit_limit: c.details.creditLimit,
            utilization: c.details.creditLimit > 0 ? balance / c.details.creditLimit : null,
            annual_rate: c.details.annualRate,
            minimum_payment: minimum,
            statement_day: c.details.statementDay,
            due_day: c.details.dueDay,
            months_to_payoff_paying_minimum: creditCardMonthsToPayoff(balance, c.details.annualRate, minimum),
          }
        })
      return ok({ loans, credit_cards: cards })
    }),
  )

  server.registerTool(
    'get_savings_and_investments',
    {
      title: 'Tiết kiệm & đầu tư',
      description: 'Sổ tiết kiệm (gốc, lãi suất, ngày đáo hạn, lãi dự kiến, giá trị hiện tại gồm lãi dồn tích), tài khoản đầu tư (tiền mặt, từng mã: số lượng, giá vốn bình quân, giá gần nhất và ngày của giá, giá trị, lãi/lỗ) và tài sản khác.',
      inputSchema: {},
      annotations: READ,
    },
    guarded(async () => {
      const { view, today } = await loadSnapshot(deps)
      const active = view.accounts.filter((a) => !a.archivedAt)
      const deposits = active
        .filter((a): a is AccountOf<'term_deposit'> => a.kind === 'term_deposit')
        .map((a) => {
          const terms = view.depositTerms.filter((t) => t.accountId === a.id && t.status === 'active')
          const term = termActiveAt(terms, today) ?? terms[0]
          return {
            id: a.id,
            name: a.name,
            bank: a.details.bankName,
            value_today: view.balances.get(a.id) ?? 0,
            principal: term?.principal ?? null,
            annual_rate: term?.annualRate ?? null,
            start_date: term?.startDate ?? null,
            maturity_date: term?.maturityDate ?? null,
            expected_interest: term ? termInterest(term) : null,
            matured_waiting_for_action: term ? term.maturityDate <= today : false,
          }
        })
      const investments = active
        .filter((a) => a.kind === 'investment')
        .map((a) => {
          const holdings = view.ledger.holdingValuations(a, today)
          const total = view.balances.get(a.id) ?? 0
          return {
            id: a.id,
            name: a.name,
            value_today: total,
            cash: total - holdings.reduce((s, h) => s + h.marketValue, 0),
            holdings: holdings
              .filter((h) => !h.position.quantity.isZero() || h.position.realized !== 0)
              .map((h) => ({
                symbol: h.holding.symbol,
                name: h.holding.name,
                quantity: h.position.quantity.toNumber(),
                unit: h.holding.unit,
                average_cost: Math.round(h.position.avgCost.toNumber()),
                price: h.price,
                price_date: h.priceDate,
                price_is_stale: h.priceDate === null || h.priceDate < addDays(today, -7),
                market_value: h.marketValue,
                unrealized_gain: h.unrealized,
                return_pct: h.returnPct,
                realized_gain: h.position.realized,
                fees_and_taxes: h.position.feesAndTaxes,
              })),
          }
        })
      const others = active.filter((a) => a.kind === 'other_asset').map((a) => ({ id: a.id, name: a.name, value_today: view.balances.get(a.id) ?? 0, note: a.note }))
      return ok({ term_deposits: deposits, investment_accounts: investments, other_assets: others, net_worth_today: netWorthAt(view.ledger, today).netWorth })
    }),
  )
}

