// Bất biến bắt buộc (docs/08 §1), kiểm tra trên hàng nghìn bộ dữ liệu ngẫu nhiên bằng fast-check.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { makeAccount } from '../test/personas'
import { spendingByCategory, incomeInPeriod } from './budget'
import { addDays } from './dates'
import { allocate, sum } from './money'
import { buildSchedule, type LoanTerms } from './loan'
import { createLedger, explainNetWorthChange, netWorthAt, sumOfChange } from './networth'
import { periodRange } from './period'
import type { Transaction } from './types'

const ACCOUNTS = [
  makeAccount('bank', 'bank', 'Ngân hàng', 50_000_000, '2026-08-01'),
  makeAccount('cash', 'cash', 'Tiền mặt', 2_000_000, '2026-08-01'),
  makeAccount('goal_fund', 'fund', 'Quỹ', 0, '2026-08-10'),
  makeAccount('loan', 'loan', 'Khoản vay', 100_000_000, '2026-08-01', {
    details: {
      lender: null, originalPrincipal: 100_000_000, rateType: 'annuity', ratePeriods: [{ from: '2026-08-01', annualRate: 0.1 }],
      termMonths: 24, startDate: '2026-08-01', paymentDay: 5, prepaymentFeeRate: 0, interestCategoryId: 'cat',
    },
  }),
  makeAccount('credit_card', 'card', 'Thẻ', 0, '2026-08-01', {
    details: { issuer: null, creditLimit: 30_000_000, statementDay: 20, dueDay: 5, annualRate: 0.3, minPaymentRate: 0.05 },
  }),
  makeAccount('bank', 'outside', 'Không tính NW', 5_000_000, '2026-08-01', { includeInNetWorth: false }),
]
const IDS = ACCOUNTS.map((a) => a.id)
const ASSETS = ACCOUNTS.filter((a) => a.class === 'asset').map((a) => a.id)
const INCLUDED = ACCOUNTS.filter((a) => a.includeInNetWorth).map((a) => a.id)

const dateArb = fc.integer({ min: 0, max: 60 }).map((d) => addDays('2026-08-01', d))
const amountArb = fc.integer({ min: 1, max: 20_000_000 })
const categoryArb = fc.constantFrom('food', 'rent', 'salary', 'fun')

let seq = 0
const meta = (date: string) => ({
  id: `p-${++seq}`, date, note: null, tags: [], groupId: null, origin: 'manual' as const, recurringRuleId: null, idempotencyKey: null,
  createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
})

const txArb: fc.Arbitrary<Transaction> = fc.oneof(
  fc.record({ date: dateArb, amount: amountArb, accountId: fc.constantFrom(...ASSETS), categoryId: categoryArb }).map(
    (t): Transaction => ({ ...meta(t.date), ...t, type: 'income', toAccountId: null, direction: null }),
  ),
  fc.record({ date: dateArb, amount: amountArb, accountId: fc.constantFrom(...IDS), categoryId: categoryArb, type: fc.constantFrom('expense', 'refund') as fc.Arbitrary<'expense' | 'refund'> }).map(
    (t): Transaction => ({ ...meta(t.date), ...t, toAccountId: null, direction: null }),
  ),
  fc
    .record({ date: dateArb, amount: amountArb, from: fc.constantFrom(...IDS), to: fc.constantFrom(...IDS) })
    .filter((t) => t.from !== t.to)
    .map((t): Transaction => ({ ...meta(t.date), type: 'transfer', amount: t.amount, accountId: t.from, toAccountId: t.to, categoryId: null, direction: null })),
  fc.record({ date: dateArb, amount: amountArb, accountId: fc.constantFrom(...IDS), direction: fc.constantFrom('up', 'down') as fc.Arbitrary<'up' | 'down'> }).map(
    (t): Transaction => ({ ...meta(t.date), ...t, type: 'adjustment', toAccountId: null, categoryId: null }),
  ),
)
// Giao dịch trước ngày mở account bị DB chặn → loại khỏi dữ liệu sinh ngẫu nhiên cho đúng thực tế.
const validFor = (t: Transaction) =>
  [t.accountId, t.toAccountId].every((id) => !id || t.date >= ACCOUNTS.find((a) => a.id === id)!.openingDate)
const ledgerArb = fc.array(txArb, { maxLength: 60 }).map((txs) => txs.filter(validFor))

describe('bất biến net worth', () => {
  it('1. netWorth = Σ tài sản − Σ nợ (theo giá trị có dấu của từng account)', () => {
    fc.assert(
      fc.property(ledgerArb, dateArb, (txs, date) => {
        const nw = netWorthAt(createLedger({ accounts: ACCOUNTS, transactions: txs }), date)
        const signed = sum(ACCOUNTS.filter((a) => a.id in nw.byAccount).map((a) => (a.class === 'asset' ? 1 : -1) * nw.byAccount[a.id]!))
        expect(nw.netWorth).toBe(signed)
        expect(nw.netWorth).toBe(nw.totalAssets - nw.totalLiabilities)
        expect(nw.totalAssets).toBeGreaterThanOrEqual(0)
        expect(nw.totalLiabilities).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: 500 },
    )
  })

  it('2. phân rã ΔNW cộng lại đúng tới từng đồng, với mọi khoảng thời gian', () => {
    fc.assert(
      fc.property(ledgerArb, dateArb, fc.integer({ min: 0, max: 40 }), (txs, from, length) => {
        const to = addDays(from, length)
        const c = explainNetWorthChange(createLedger({ accounts: ACCOUNTS, transactions: txs }), from, to)
        expect(c.startNetWorth + sumOfChange(c)).toBe(c.endNetWorth)
        expect(c.market + c.revaluation + c.accruedInterest).toBe(0) // không có đầu tư/định giá/sổ tiết kiệm
        expect(c.other).toBe(0) // tài khoản tiền: mọi biến động đều giải thích được bằng giao dịch
      }),
      { numRuns: 500 },
    )
  })

  it('3. chuyển tiền giữa các account tính vào NW không đổi net worth, không đổi thu/chi', () => {
    const includedPair = fc.tuple(fc.constantFrom(...INCLUDED), fc.constantFrom(...INCLUDED)).filter(([a, b]) => a !== b)
    fc.assert(
      fc.property(ledgerArb, includedPair, amountArb, fc.integer({ min: 9, max: 60 }), (txs, [from, to], amount, day) => {
        const date = addDays('2026-08-01', day)
        const extra: Transaction = { ...meta(date), type: 'transfer', amount, accountId: from, toAccountId: to, categoryId: null, direction: null }
        const withTransfer = [...txs, extra]
        const aug = periodRange('2026-08', 1)
        for (const d of [date, addDays(date, 5), '2026-09-30']) {
          expect(netWorthAt(createLedger({ accounts: ACCOUNTS, transactions: withTransfer }), d).netWorth).toBe(
            netWorthAt(createLedger({ accounts: ACCOUNTS, transactions: txs }), d).netWorth,
          )
        }
        expect(incomeInPeriod(withTransfer, aug)).toBe(incomeInPeriod(txs, aug))
        expect([...spendingByCategory(withTransfer, aug)]).toEqual([...spendingByCategory(txs, aug)])
      }),
      { numRuns: 300 },
    )
  })
})

describe('bất biến lịch trả nợ', () => {
  it('4. Σ gốc = dư nợ ban đầu; kỳ cuối dư nợ = 0; không kỳ nào âm (mọi loại lãi)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000, max: 5_000_000_000 }),
        fc.integer({ min: 0, max: 300 }).map((x) => x / 1000),
        fc.integer({ min: 1, max: 360 }),
        fc.constantFrom('annuity', 'equal_principal', 'flat', 'zero') as fc.Arbitrary<LoanTerms['rateType']>,
        (principal, rate, months, rateType) => {
          const rows = buildSchedule({
            rateType,
            ratePeriods: [{ from: '2026-01-01', annualRate: rateType === 'zero' ? 0 : rate }],
            originalPrincipal: principal,
            startDate: '2026-01-01',
            paymentDay: 15,
            termMonths: months,
          })
          expect(rows).toHaveLength(months)
          expect(sum(rows.map((r) => r.principal))).toBe(principal)
          expect(rows.at(-1)!.closingBalance).toBe(0)
          for (const r of rows) {
            expect(r.principal).toBeGreaterThanOrEqual(0)
            expect(r.interest).toBeGreaterThanOrEqual(0)
            expect(r.openingBalance - r.principal).toBe(r.closingBalance)
          }
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('bất biến chia tiền', () => {
  it('5. chia không lệch: Σ phần = tổng, chênh lệch giữa các phần đều nhau ≤ 1 đồng', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 50 }), (total, weights) => {
        const parts = allocate(total, weights)
        expect(sum(parts)).toBe(total)
        if (new Set(weights).size === 1) expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1)
      }),
      { numRuns: 1000 },
    )
  })
})
