import { describe, expect, it } from 'vitest'
import { lan } from '../test/personas'
import { addDays } from './dates'
import { createLedger, explainNetWorthChange, netWorthAt } from './networth'
import { periodRange } from './period'
import { cashflowSeries, netWorthSeries, recentMonths, spendingByTopCategory } from './reports'

// docs/02 §7: 10.000 giao dịch (≈ 3 năm dùng thật) vẫn tính xong mọi màn hình trong dưới 2 giây.
describe('hiệu năng với 10.000 giao dịch', () => {
  it('dựng sổ cái + net worth 36 tháng + dòng tiền + top danh mục < 2 giây', () => {
    const p = lan()
    const templates = p.transactions.filter((t) => t.type === 'expense' || t.type === 'income')
    const transactions = Array.from({ length: 10_000 }, (_, i) => {
      const t = templates[i % templates.length]!
      return { ...t, id: `perf-${i}`, date: addDays('2023-09-05', Math.floor((i * 1090) / 10_000)), idempotencyKey: null, groupId: null }
    })
    const accounts = p.accounts.map((a) => ({ ...a, openingDate: '2023-09-01' }))
    const today = '2026-08-31'

    const started = performance.now()
    const ledger = createLedger({ accounts, transactions, holdings: [], trades: [], prices: [], valuations: [], depositTerms: [], includeAccruedInterest: true })
    const months = recentMonths(today, 36, 1)
    const series = netWorthSeries(ledger, months, 1, today)
    const cashflow = cashflowSeries(transactions, p.categories, months, 1)
    const range = periodRange('2026-08', 1)
    const top = spendingByTopCategory(transactions, p.categories, range)
    const change = explainNetWorthChange(ledger, range.start, range.end)
    const now = netWorthAt(ledger, today)
    const elapsed = performance.now() - started

    expect(series).toHaveLength(36)
    expect(cashflow).toHaveLength(36)
    expect(top.length).toBeGreaterThan(0)
    expect(change.endNetWorth).toBe(now.netWorth)
    expect(elapsed).toBeLessThan(2000)
  })
})
