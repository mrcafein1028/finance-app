// Dữ liệu 3 persona của docs/08 §2–4 — nguồn số liệu kỳ vọng cho test domain (và dữ liệu demo sau này).
import { buildCategorySeed } from '../seed/categories'
import { budgetTargetKey } from '../../schemas/budget'
import { KIND_META, type Account, type AccountKind, type AccountOf } from '../../schemas/account'
import type {
  BudgetLine,
  BudgetMonth,
  BudgetTarget,
  Category,
  DepositTerm,
  Holding,
  InvestmentTrade,
  PriceQuote,
  Transaction,
} from '../../schemas'

const TS = '2026-08-01T00:00:00.000Z'

type Details<K extends AccountKind> = AccountOf<K>['details']

export function makeAccount<K extends AccountKind>(
  kind: K,
  id: string,
  name: string,
  openingBalance: number,
  openingDate: string,
  extra: Partial<Omit<AccountOf<K>, 'kind' | 'class'>> & { details?: Details<K> } = {},
): Account {
  const meta = KIND_META[kind]
  return {
    id,
    name,
    kind,
    class: meta.class,
    currency: 'VND',
    openingBalance,
    openingDate,
    isLiquid: meta.isLiquid,
    includeInNetWorth: true,
    isEmergencyFund: false,
    goal: null,
    archivedAt: null,
    icon: null,
    color: null,
    note: null,
    sortOrder: 0,
    details: null,
    createdAt: TS,
    updatedAt: TS,
    ...extra,
  } as Account
}

let txSeq = 0
const txMeta = (date: string) => ({
  id: `tx-${String(++txSeq).padStart(4, '0')}`,
  date,
  note: null,
  tags: [],
  groupId: null,
  origin: 'manual' as const,
  recurringRuleId: null,
  idempotencyKey: null,
  createdAt: TS,
  updatedAt: TS,
})

export const income = (date: string, amount: number, accountId: string, categoryId: string): Transaction => ({
  ...txMeta(date), type: 'income', amount, accountId, categoryId, toAccountId: null, direction: null,
})
export const expense = (date: string, amount: number, accountId: string, categoryId: string, groupId: string | null = null): Transaction => ({
  ...txMeta(date), type: 'expense', amount, accountId, categoryId, toAccountId: null, direction: null, groupId,
})
export const refund = (date: string, amount: number, accountId: string, categoryId: string): Transaction => ({
  ...txMeta(date), type: 'refund', amount, accountId, categoryId, toAccountId: null, direction: null,
})
export const transfer = (date: string, amount: number, from: string, to: string, groupId: string | null = null): Transaction => ({
  ...txMeta(date), type: 'transfer', amount, accountId: from, toAccountId: to, categoryId: null, direction: null, groupId,
})
export const adjustment = (date: string, amount: number, accountId: string, direction: 'up' | 'down'): Transaction => ({
  ...txMeta(date), type: 'adjustment', amount, accountId, categoryId: null, toAccountId: null, direction,
})

export function line(month: string, target: BudgetTarget, planned: number, rollover = false): BudgetLine {
  return { id: `line-${month}-${budgetTargetKey(target)}`, month, target, targetKey: budgetTargetKey(target), planned, rollover, createdAt: TS, updatedAt: TS }
}

export const budgetMonth = (month: string, expectedIncome: number): BudgetMonth => ({
  id: `bm-${month}`, month, mode: 'zero_based', expectedIncome, status: 'open', closedAt: null, note: null, createdAt: TS, updatedAt: TS,
})

function categories() {
  const list = buildCategorySeed('basic')
  const byName = (name: string): Category => {
    const found = list.find((c) => c.name === name)
    if (!found) throw new Error(`Không có danh mục "${name}"`)
    return found
  }
  return { list, id: (name: string) => byName(name).id }
}

// ---------------------------------------------------------------------------
// P1 — Lan: ngân sách + quỹ khẩn cấp (docs/08 §2)
// ---------------------------------------------------------------------------
export function lan() {
  const cats = categories()
  const c = cats.id
  const accounts = [
    makeAccount('bank', 'vcb', 'Vietcombank', 25_000_000, '2026-08-01'),
    makeAccount('cash', 'cash', 'Tiền mặt', 2_000_000, '2026-08-01'),
    makeAccount('ewallet', 'momo', 'MoMo', 500_000, '2026-08-01'),
    makeAccount('goal_fund', 'fund', 'Quỹ khẩn cấp', 10_000_000, '2026-08-01', {
      isEmergencyFund: true,
      goal: { targetAmount: 60_000_000, targetDate: null },
    }),
  ]
  const cat = (name: string) => ({ kind: 'category' as const, categoryId: c(name) })
  const augustLines = [
    line('2026-08', cat('Nhà ở'), 5_000_000),
    line('2026-08', cat('Ăn uống'), 3_500_000, true),
    line('2026-08', cat('Đi lại'), 800_000),
    line('2026-08', cat('Mua sắm'), 1_500_000),
    line('2026-08', cat('Giải trí'), 1_000_000),
    line('2026-08', cat('Hóa đơn & tiện ích'), 700_000),
    line('2026-08', { kind: 'account', accountId: 'fund' }, 3_000_000),
  ]
  const transactions = [
    income('2026-08-05', 18_000_000, 'vcb', c('Lương')),
    expense('2026-08-05', 5_000_000, 'vcb', c('Nhà ở')),
    transfer('2026-08-06', 3_000_000, 'vcb', 'fund'),
    transfer('2026-08-07', 2_000_000, 'vcb', 'cash'),
    transfer('2026-08-07', 1_000_000, 'vcb', 'momo'),
    // Ăn uống 3.850.000 = Tiền mặt 2.600.000 + VCB 1.250.000
    expense('2026-08-08', 900_000, 'cash', c('Ăn uống')),
    expense('2026-08-15', 800_000, 'cash', c('Ăn uống')),
    expense('2026-08-22', 900_000, 'cash', c('Ăn uống')),
    expense('2026-08-28', 1_250_000, 'vcb', c('Ăn uống')),
    // Đi lại 600.000 qua MoMo
    expense('2026-08-09', 300_000, 'momo', c('Đi lại')),
    expense('2026-08-23', 300_000, 'momo', c('Đi lại')),
    expense('2026-08-15', 1_200_000, 'vcb', c('Mua sắm')),
    refund('2026-08-18', 200_000, 'vcb', c('Mua sắm')),
    // Giải trí 1.100.000
    expense('2026-08-16', 600_000, 'vcb', c('Giải trí')),
    expense('2026-08-30', 500_000, 'vcb', c('Giải trí')),
    expense('2026-08-20', 700_000, 'vcb', c('Hóa đơn & tiện ích')),
  ]
  return { accounts, categories: cats.list, categoryId: c, augustBudget: budgetMonth('2026-08', 18_000_000), augustLines, transactions }
}

// ---------------------------------------------------------------------------
// P2 — Hùng: vay mua nhà + sổ tiết kiệm (docs/08 §3)
// ---------------------------------------------------------------------------
export function hung() {
  const cats = categories()
  const c = cats.id
  const loanDetails: Details<'loan'> = {
    lender: 'BIDV',
    originalPrincipal: 1_200_000_000,
    rateType: 'equal_principal',
    ratePeriods: [{ from: '2026-08-01', annualRate: 0.09 }],
    termMonths: 240,
    startDate: '2026-08-01',
    paymentDay: 10,
    prepaymentFeeRate: 0.01,
    interestCategoryId: c('Lãi vay'),
  }
  const depositDetails: Details<'term_deposit'> = {
    bankName: 'ABC',
    interestPayout: 'at_maturity',
    maturityAction: 'renew_principal',
    payoutAccountId: 'vcb',
    earlyWithdrawalRate: 0.001,
    dayCountBasis: 365,
  }
  const accounts = [
    makeAccount('bank', 'vcb', 'Vietcombank', 300_000_000, '2026-01-01'),
    makeAccount('loan', 'home', 'Vay mua nhà', 1_200_000_000, '2026-08-01', { details: loanDetails }),
    makeAccount('term_deposit', 'td', 'Sổ ABC 6 tháng', 0, '2026-03-01', { details: depositDetails }),
  ]
  const term1: DepositTerm = {
    id: 'term-1', accountId: 'td', seq: 1, principal: 100_000_000, annualRate: 0.055, termMonths: 6,
    startDate: '2026-03-01', maturityDate: '2026-09-01', status: 'active', interestPaid: 0, closedAt: null,
    createdAt: TS, updatedAt: TS,
  }
  const openDeposit = transfer('2026-03-01', 100_000_000, 'vcb', 'td')
  // Trả kỳ 1 (10/09/2026): gốc 5.000.000 + lãi 9.000.000, cùng một nhóm.
  const payment1 = [
    transfer('2026-09-10', 5_000_000, 'vcb', 'home', 'pay-1'),
    expense('2026-09-10', 9_000_000, 'vcb', c('Lãi vay'), 'pay-1'),
  ]
  return { accounts, categories: cats.list, categoryId: c, loanDetails, depositDetails, term1, openDeposit, payment1 }
}

// ---------------------------------------------------------------------------
// P3 — Mai: đầu tư + thẻ tín dụng + thu nhập không đều (docs/08 §4)
// ---------------------------------------------------------------------------
export function mai() {
  const cats = categories()
  const c = cats.id
  const accounts = [
    makeAccount('bank', 'vcb', 'Vietcombank', 400_000_000, '2026-07-01'),
    makeAccount('investment', 'ck', 'Chứng khoán', 0, '2026-07-01', { details: { platform: 'SSI', costMethod: 'average' } }),
    makeAccount('credit_card', 'card', 'Thẻ tín dụng', 20_000_000, '2026-08-01', {
      details: { issuer: 'TPBank', creditLimit: 50_000_000, statementDay: 20, dueDay: 5, annualRate: 0.3, minPaymentRate: 0.05 },
    }),
  ]
  const holdings: Holding[] = [
    { id: 'fpt', accountId: 'ck', symbol: 'FPT', name: 'CTCP FPT', assetType: 'stock', unit: 'cp', quantityDecimals: 0, createdAt: TS, updatedAt: TS },
  ]
  const trade = (id: string, date: string, side: 'buy' | 'sell', quantity: string, price: number, fee: number, tax = 0): InvestmentTrade => ({
    id, holdingId: 'fpt', date, side, quantity, price, fee, tax, cashAccountId: 'ck', isOpening: false, groupId: id,
    createdAt: `${date}T00:00:00.000Z`, updatedAt: `${date}T00:00:00.000Z`,
  })
  const buys = [trade('t1', '2026-08-05', 'buy', '1000', 120_000, 180_000), trade('t2', '2026-08-12', 'buy', '500', 108_000, 81_000)]
  const sell = trade('t3', '2026-09-10', 'sell', '600', 130_000, 117_000, 78_000)
  const prices: PriceQuote[] = [{ id: 'q1', symbol: 'FPT', date: '2026-08-31', price: 125_000, createdAt: TS }]
  const fee = c('Phí & thuế đầu tư')
  const transactions = [
    income('2026-07-25', 10_000_000, 'vcb', c('Lương')),
    transfer('2026-08-01', 300_000_000, 'vcb', 'ck'),
    expense('2026-08-05', 180_000, 'ck', fee, 't1'),
    expense('2026-08-12', 81_000, 'ck', fee, 't2'),
    income('2026-08-25', 60_000_000, 'vcb', c('Lương')),
  ]
  const sellFee = expense('2026-09-10', 195_000, 'ck', fee, 't3')
  return { accounts, categories: cats.list, categoryId: c, holdings, buys, sell, sellFee, prices, transactions }
}
