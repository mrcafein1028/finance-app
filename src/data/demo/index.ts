import { addMonths, addMonthsToKey } from '../../domain/dates'
import { copyLines } from '../../domain/budget'
import { periodOf, previousMonth } from '../../domain/period'
import { budgetTargetKey, TABLE_NAMES, type BackupFile, type BudgetTarget, type TableName } from '../../schemas'
import { buildBackup } from '../backup'
import { DEFAULT_SETTINGS } from '../repositories'
import { hung, lan, line, mai, budgetMonth } from './personas'

// Dữ liệu mẫu cho người mới khám phá app (docs/09 Giai đoạn 8): 3 persona của docs/08, dời ngày
// để tháng "chính" của persona rơi vào tháng vừa kết thúc — trông như dữ liệu thật của bạn.

export const DEMO_PERSONAS = {
  lan: { label: 'Lan — nhân viên văn phòng, ngân sách & quỹ khẩn cấp', anchor: '2026-08' },
  hung: { label: 'Hùng — vay mua nhà & sổ tiết kiệm', anchor: '2026-09' },
  mai: { label: 'Mai — freelancer, đầu tư & thẻ tín dụng', anchor: '2026-09' },
} as const
export type DemoPersona = keyof typeof DEMO_PERSONAS

const DATE_FIELDS = new Set(['date', 'openingDate', 'startDate', 'maturityDate', 'nextDate', 'endDate', 'targetDate', 'from', 'asOf'])
const MONTH_FIELDS = new Set(['month'])
const ID_FIELDS = new Set(['id', 'accountId', 'toAccountId', 'categoryId', 'groupId', 'holdingId', 'cashAccountId', 'payoutAccountId'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function monthsBetweenKeys(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number]
  const [ty, tm] = to.split('-').map(Number) as [number, number]
  return (ty - fy) * 12 + (tm - fm)
}

/** Dời mọi ngày/tháng `offset` tháng và đổi id dạng chữ ('vcb') sang uuid — đệ quy vào jsonb (details, target…). */
function transform(value: unknown, offset: number, ids: Map<string, string>, key = ''): unknown {
  if (Array.isArray(value)) return value.map((v) => transform(v, offset, ids))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, transform(v, offset, ids, k)]))
  }
  if (typeof value !== 'string') return value
  if (DATE_FIELDS.has(key) && /^\d{4}-\d{2}-\d{2}$/.test(value)) return addMonths(value, offset)
  if (key === 'closedAt' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return addMonths(value, offset)
  if (MONTH_FIELDS.has(key) && /^\d{4}-\d{2}$/.test(value)) return addMonthsToKey(value, offset)
  if (ID_FIELDS.has(key) && value && !UUID.test(value)) {
    if (!ids.has(value)) ids.set(value, crypto.randomUUID())
    return ids.get(value)!
  }
  return value
}

function rawData(persona: DemoPersona): Record<string, object[]> {
  if (persona === 'lan') {
    const p = lan()
    const september = copyLines(p.augustLines).map((d) => line('2026-09', d.target, d.planned, d.rollover))
    return {
      accounts: p.accounts,
      categories: p.categories,
      transactions: p.transactions,
      budgetMonths: [{ ...p.augustBudget, status: 'open' }, budgetMonth('2026-09', 18_000_000)],
      budgetLines: [...p.augustLines, ...september],
    }
  }
  if (persona === 'hung') {
    const p = hung()
    return { accounts: p.accounts, categories: p.categories, transactions: [p.openDeposit, ...p.payment1], depositTerms: [p.term1] }
  }
  const p = mai()
  return {
    accounts: p.accounts,
    categories: p.categories,
    transactions: [...p.transactions, p.sellFee],
    holdings: p.holdings,
    trades: [...p.buys, p.sell],
    prices: p.prices,
  }
}

/** File sao lưu hoàn chỉnh cho persona, dời ngày theo `today`. Nạp bằng importReplace (thay toàn bộ dữ liệu). */
export function buildDemoBackup(persona: DemoPersona, today: string, periodStartDay = 1): BackupFile {
  const offset = monthsBetweenKeys(DEMO_PERSONAS[persona].anchor, previousMonth(periodOf(today, periodStartDay)))
  const ids = new Map<string, string>()
  const raw = rawData(persona)
  const tableKey: Record<string, TableName> = { prices: 'priceQuotes', trades: 'investmentTrades' }
  const data = Object.fromEntries(TABLE_NAMES.map((t) => [t, [] as object[]])) as Record<TableName, object[]>
  for (const [name, rows] of Object.entries(raw)) {
    const table = tableKey[name] ?? (name as TableName)
    data[table] = rows!.map((r) => transform(r, offset, ids) as object)
  }
  if (persona === 'lan') {
    // Tháng hiện tại: lặp lại thu chi tháng trước đến hôm nay → ngân sách tháng này có tiến độ để xem.
    const repeat = (data.transactions as { type: string; date: string; id: string; createdAt: string }[])
      .filter((t) => t.type === 'income' || t.type === 'expense')
      .map((t) => ({ ...t, id: crypto.randomUUID(), date: addMonths(t.date, 1) }))
      .filter((t) => t.date <= today)
    data.transactions = [...data.transactions, ...repeat]
  }
  data.budgetLines = data.budgetLines.map((l) => ({ ...l, targetKey: budgetTargetKey((l as { target: BudgetTarget }).target) }))
  data.settings = [{ ...DEFAULT_SETTINGS, periodStartDay, onboardingCompleted: true }]
  return buildBackup(data as never)
}
