import { budgetTargetKey } from '../schemas/budget'
import { addDays } from './dates'
import { allocate, D, ratio, round, sum } from './money'
import { daysElapsed, daysInPeriod, isInPeriod, type PeriodRange } from './period'
import type {
  Account,
  BudgetBucket,
  BudgetLine,
  BudgetMonth,
  BudgetTarget,
  Category,
  IsoDate,
  Money,
  MonthKey,
  Transaction,
} from './types'

export type LineStatus = 'ok' | 'warning' | 'full' | 'over'

export interface BudgetLineSummary {
  line: BudgetLine
  planned: Money
  carryIn: Money
  /** Ngân sách khả dụng của tháng = planned + carryIn. */
  budget: Money
  actual: Money
  available: Money
  /** actual / budget; null khi budget ≤ 0. */
  usage: number | null
  status: LineStatus
  /** Mức "đáng lẽ chỉ nên tiêu đến" tính tới hôm nay. */
  pace: Money
  /** actual > pace — đang tiêu nhanh hơn kế hoạch. */
  aheadOfPace: boolean
}

export interface BudgetMonthSummary {
  month: MonthKey
  range: PeriodRange
  expectedIncome: Money
  totalPlanned: Money
  /** expectedIncome − totalPlanned; zero-based hướng tới 0, âm là phân bổ lố. */
  unassigned: Money
  actualIncome: Money
  /** Σ chi − Σ hoàn tiền trong kỳ. */
  actualExpense: Money
  netCashFlow: Money
  /** Chi tiêu của các danh mục không thuộc dòng ngân sách nào. */
  unbudgetedSpend: Money
  unbudgetedByCategory: Map<string, Money>
  lines: BudgetLineSummary[]
}

export interface BudgetInput {
  range: PeriodRange
  budgetMonth: Pick<BudgetMonth, 'expectedIncome'> | null
  lines: readonly BudgetLine[]
  categories: readonly Category[]
  accounts: readonly Pick<Account, 'id' | 'isLiquid'>[]
  /** Có thể chứa giao dịch ngoài kỳ — sẽ được lọc theo range. */
  transactions: readonly Transaction[]
  /** available cuối tháng trước theo targetKey (từ carryForward). */
  previousAvailable?: ReadonlyMap<string, Money>
  allowNegativeRollover?: boolean
  /** [ngưỡng cảnh báo, ngưỡng vượt] — mặc định [0.8, 1]. */
  alertThresholds?: readonly [number, number]
  today: IsoDate
}

/** Chi tiêu ròng theo danh mục lá trong kỳ: chi − hoàn tiền. */
export function spendingByCategory(transactions: readonly Transaction[], range: PeriodRange): Map<string, Money> {
  const map = new Map<string, Money>()
  for (const tx of transactions) {
    if (!isInPeriod(tx.date, range)) continue
    if (tx.type !== 'expense' && tx.type !== 'refund') continue
    const delta = tx.type === 'expense' ? tx.amount : -tx.amount
    map.set(tx.categoryId, (map.get(tx.categoryId) ?? 0) + delta)
  }
  return map
}

export function incomeInPeriod(transactions: readonly Transaction[], range: PeriodRange): Money {
  return sum(transactions.filter((t) => t.type === 'income' && isInPeriod(t.date, range)).map((t) => t.amount))
}

/** Danh mục và mọi danh mục con của nó (tối đa 2 cấp). */
export function withDescendants(categoryId: string, categories: readonly Category[]): Set<string> {
  const ids = new Set([categoryId])
  for (const c of categories) if (c.parentId === categoryId) ids.add(c.id)
  return ids
}

/** Tiền thực sự đổ vào account mục tiêu từ các account thanh khoản khác (trừ phần rút ra). */
function savedInto(accountId: string, transactions: readonly Transaction[], range: PeriodRange, liquid: Set<string>): Money {
  let total = 0
  for (const tx of transactions) {
    if (tx.type !== 'transfer' || !isInPeriod(tx.date, range)) continue
    if (tx.toAccountId === accountId && tx.accountId !== accountId && liquid.has(tx.accountId)) total += tx.amount
    if (tx.accountId === accountId && tx.toAccountId !== accountId && liquid.has(tx.toAccountId)) total -= tx.amount
  }
  return total
}

function lineStatus(actual: Money, budget: Money, warn: number): LineStatus {
  if (budget <= 0) return actual > 0 ? 'over' : 'ok'
  if (actual > budget) return 'over'
  if (actual === budget) return 'full'
  return actual >= budget * warn ? 'warning' : 'ok'
}

export function summarizeBudgetMonth(input: BudgetInput): BudgetMonthSummary {
  const { range, categories, transactions, today } = input
  const warn = input.alertThresholds?.[0] ?? 0.8
  const allowNegative = input.allowNegativeRollover ?? true
  const spending = spendingByCategory(transactions, range)
  const liquid = new Set(input.accounts.filter((a) => a.isLiquid).map((a) => a.id))
  const elapsed = daysElapsed(range, today)
  const totalDays = daysInPeriod(range)
  const covered = new Set<string>()

  const lines = input.lines.map((line): BudgetLineSummary => {
    let actual: Money
    if (line.target.kind === 'category') {
      const ids = withDescendants(line.target.categoryId, categories)
      ids.forEach((id) => covered.add(id))
      actual = sum([...ids].map((id) => spending.get(id) ?? 0))
    } else {
      actual = savedInto(line.target.accountId, transactions, range, liquid)
    }

    const previous = input.previousAvailable?.get(line.targetKey) ?? 0
    const carryIn = line.rollover ? (allowNegative ? previous : Math.max(0, previous)) : 0
    const budget = line.planned + carryIn
    const pace = budget > 0 ? round(new D(budget).times(elapsed).div(totalDays)) : 0
    const status = lineStatus(actual, budget, warn)
    return {
      line,
      planned: line.planned,
      carryIn,
      budget,
      actual,
      available: budget - actual,
      usage: ratio(actual, budget),
      status,
      pace,
      aheadOfPace: status !== 'over' && actual > pace,
    }
  })

  const unbudgetedByCategory = new Map<string, Money>()
  for (const [categoryId, amount] of spending) {
    if (!covered.has(categoryId) && amount !== 0) unbudgetedByCategory.set(categoryId, amount)
  }

  const expectedIncome = input.budgetMonth?.expectedIncome ?? 0
  const totalPlanned = sum(input.lines.map((l) => l.planned))
  const actualIncome = incomeInPeriod(transactions, range)
  const actualExpense = sum([...spending.values()])
  return {
    month: range.month,
    range,
    expectedIncome,
    totalPlanned,
    unassigned: expectedIncome - totalPlanned,
    actualIncome,
    actualExpense,
    netCashFlow: actualIncome - actualExpense,
    unbudgetedSpend: sum([...unbudgetedByCategory.values()]),
    unbudgetedByCategory,
    lines,
  }
}

/** Số dư cuối tháng của mọi dòng → đầu vào previousAvailable của tháng sau. */
export function carryForward(summary: BudgetMonthSummary): Map<string, Money> {
  return new Map(summary.lines.map((l) => [l.line.targetKey, l.available]))
}

export interface BudgetLineDraft {
  target: BudgetTarget
  targetKey: string
  planned: Money
  rollover: boolean
}

/** W5 "Sao chép tháng trước": giữ target, planned, rollover. */
export function copyLines(lines: readonly BudgetLine[]): BudgetLineDraft[] {
  return lines.map((l) => ({ target: l.target, targetKey: budgetTargetKey(l.target), planned: l.planned, rollover: l.rollover }))
}

/** Thu nhập dự kiến gợi ý: tháng trước, hoặc trung bình tối đa 3 tháng gần nhất (cũ → mới). */
export function suggestExpectedIncome(history: readonly Money[], mode: 'previous' | 'average3'): Money {
  if (history.length === 0) return 0
  if (mode === 'previous') return history.at(-1)!
  const recent = history.slice(-3)
  return round(new D(sum(recent)).div(recent.length))
}

/** Gợi ý 50/30/20 cho onboarding: Thiết yếu / Mong muốn / Tiết kiệm. */
export function split503020(income: Money): Record<BudgetBucket, Money> {
  const [needs, wants, savings] = allocate(income, [50, 30, 20]) as [Money, Money, Money]
  return { needs, wants, savings }
}

/** Nhóm 50/30/20 của danh mục: của chính nó, không có thì của cha, không có nữa thì "Mong muốn". */
export function bucketOf(categoryId: string, byId: ReadonlyMap<string, Category>): BudgetBucket {
  const c = byId.get(categoryId)
  if (!c) return 'wants'
  if (c.bucket) return c.bucket
  const parent = c.parentId ? byId.get(c.parentId) : undefined
  return parent?.bucket ?? 'wants'
}

export interface BucketBreakdown {
  income: Money
  needs: Money
  wants: Money
  /** Phần còn lại của thu nhập = dòng tiền ròng. */
  savings: Money
  /** Tỉ trọng trên thu nhập; null khi chưa có thu nhập. */
  shares: { needs: number; wants: number; savings: number } | null
}

/** Cơ cấu chi tiêu thực tế theo 50/30/20 (docs/04 §9). */
export function bucketBreakdown(transactions: readonly Transaction[], categories: readonly Category[], range: PeriodRange): BucketBreakdown {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const totals = { needs: 0, wants: 0, savings: 0 }
  for (const [categoryId, amount] of spendingByCategory(transactions, range)) totals[bucketOf(categoryId, byId)] += amount
  const income = incomeInPeriod(transactions, range)
  const savings = income - totals.needs - totals.wants - totals.savings
  return {
    income,
    needs: totals.needs,
    wants: totals.wants + totals.savings, // chi vào danh mục gắn "savings" hiếm gặp; tính như chi tiêu mong muốn
    savings,
    shares:
      income > 0
        ? { needs: totals.needs / income, wants: (totals.wants + totals.savings) / income, savings: savings / income }
        : null,
  }
}

// ---------------------------------------------------------------------------
// Chuỗi nhiều tháng (rollover cần available của tháng trước — docs/04 §4)
// ---------------------------------------------------------------------------

export interface BudgetChainInput extends Omit<BudgetInput, 'range' | 'budgetMonth' | 'lines' | 'previousAvailable'> {
  months: readonly Pick<BudgetMonth, 'month' | 'expectedIncome'>[]
  lines: readonly BudgetLine[]
  rangeOf: (month: MonthKey) => PeriodRange
}

/**
 * Tổng hợp mọi tháng có ngân sách theo thứ tự thời gian, chuyển available sang tháng kế tiếp.
 * Tháng bị bỏ trống ở giữa làm đứt chuỗi (không có gì để chuyển).
 */
export function summarizeBudgetChain(input: BudgetChainInput): Map<MonthKey, BudgetMonthSummary> {
  const result = new Map<MonthKey, BudgetMonthSummary>()
  const sorted = [...input.months].sort((a, b) => a.month.localeCompare(b.month))
  let previous: BudgetMonthSummary | null = null
  for (const m of sorted) {
    const range = input.rangeOf(m.month)
    const prevIsAdjacent = previous !== null && input.rangeOf(previous.month).end === addDays(range.start, -1)
    const summary = summarizeBudgetMonth({
      ...input,
      range,
      budgetMonth: m,
      lines: input.lines.filter((l) => l.month === m.month),
      previousAvailable: prevIsAdjacent && previous ? carryForward(previous) : undefined,
    })
    result.set(m.month, summary)
    previous = summary
  }
  return result
}

/** Chi tiêu ròng trung bình các kỳ gần nhất (tối đa 3) của một danh mục và các con của nó. */
export function averageSpending(categoryId: string, categories: readonly Category[], transactions: readonly Transaction[], ranges: readonly PeriodRange[]): Money {
  if (ranges.length === 0) return 0
  const ids = withDescendants(categoryId, categories)
  const totals = ranges.map((r) => {
    const spent = spendingByCategory(transactions, r)
    return sum([...ids].map((id) => spent.get(id) ?? 0))
  })
  return round(new D(sum(totals)).div(ranges.length))
}

/**
 * W5 "Theo mẫu 50/30/20": chia thu nhập cho các nhóm danh mục chi cấp 1. Trong mỗi nhóm (Thiết yếu /
 * Mong muốn), chia theo tỉ lệ chi tiêu thực tế trước đây; chưa có lịch sử thì chia đều.
 * 20% tiết kiệm vào quỹ khẩn cấp (hoặc quỹ mục tiêu đầu tiên) nếu có.
 */
export function suggestLines503020(
  income: Money,
  categories: readonly Category[],
  savingsAccountId: string | null,
  history: (categoryId: string) => Money = () => 0,
): BudgetLineDraft[] {
  const split = split503020(income)
  const tops = categories.filter((c) => c.type === 'expense' && c.parentId === null && !c.archivedAt && !isSystemGroup(c, categories))
  const drafts: BudgetLineDraft[] = []
  for (const bucket of ['needs', 'wants'] as const) {
    const group = tops.filter((c) => (c.bucket ?? 'wants') === bucket)
    if (group.length === 0) continue
    const weights = group.map((c) => Math.max(0, history(c.id)))
    const amounts = allocate(split[bucket], weights.some((w) => w > 0) ? weights.map((w) => w + 1) : group.map(() => 1))
    group.forEach((c, i) => {
      const target: BudgetTarget = { kind: 'category', categoryId: c.id }
      drafts.push({ target, targetKey: budgetTargetKey(target), planned: amounts[i]!, rollover: bucket === 'needs' })
    })
  }
  if (savingsAccountId) {
    const target: BudgetTarget = { kind: 'account', accountId: savingsAccountId }
    drafts.push({ target, targetKey: budgetTargetKey(target), planned: split.savings, rollover: false })
  }
  return drafts
}

/** Nhóm danh mục hệ thống ("Tài chính": lãi vay, phí…) — không đưa vào gợi ý ngân sách. */
function isSystemGroup(category: Category, categories: readonly Category[]): boolean {
  const children = categories.filter((c) => c.parentId === category.id)
  return children.length > 0 && children.every((c) => c.isSystem)
}
