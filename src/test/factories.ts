// Dữ liệu hợp lệ tối thiểu cho từng thực thể — test ghi đè đúng trường mình cần kiểm tra.
import type {
  Account,
  AccountOf,
  Category,
  DepositTerm,
  Holding,
  InvestmentTrade,
  RecurringRule,
  Transaction,
} from '../schemas'
import type { NewRecord } from '../data/repositories/base'

type CashLikeKind = 'cash' | 'bank' | 'ewallet' | 'goal_fund'

export const cashAccount = (
  over: Partial<Omit<NewRecord<AccountOf<'bank'>>, 'kind'>> & { kind?: CashLikeKind } = {},
): NewRecord<Account> => ({
  name: 'Vietcombank',
  kind: 'bank',
  class: 'asset',
  currency: 'VND',
  openingBalance: 25_000_000,
  openingDate: '2026-08-01',
  isLiquid: true,
  includeInNetWorth: true,
  isEmergencyFund: false,
  goal: null,
  archivedAt: null,
  icon: null,
  color: null,
  note: null,
  sortOrder: 0,
  details: null,
  ...over,
}) as NewRecord<Account>

export const loanAccount = (over: Partial<NewRecord<AccountOf<'loan'>>> = {}): NewRecord<Account> => ({
  name: 'Vay mua nhà',
  kind: 'loan',
  class: 'liability',
  currency: 'VND',
  openingBalance: 1_200_000_000,
  openingDate: '2026-08-01',
  isLiquid: false,
  includeInNetWorth: true,
  isEmergencyFund: false,
  goal: null,
  archivedAt: null,
  icon: null,
  color: null,
  note: null,
  sortOrder: 1,
  details: {
    lender: 'BIDV',
    originalPrincipal: 1_200_000_000,
    rateType: 'equal_principal',
    ratePeriods: [{ from: '2026-08-01', annualRate: 0.09 }],
    termMonths: 240,
    startDate: '2026-08-01',
    paymentDay: 10,
    prepaymentFeeRate: 0.01,
    interestCategoryId: 'cat-loan-interest',
  },
  ...over,
})

export const expenseCategory = (over: Partial<NewRecord<Category>> = {}): NewRecord<Category> => ({
  name: 'Ăn uống',
  type: 'expense',
  parentId: null,
  bucket: 'needs',
  isSystem: false,
  systemKey: null,
  archivedAt: null,
  icon: null,
  color: null,
  sortOrder: 0,
  ...over,
})

export const expenseTx = (
  over: Partial<NewRecord<Extract<Transaction, { type: 'expense' }>>> = {},
): NewRecord<Transaction> => ({
  type: 'expense',
  date: '2026-08-10',
  amount: 150_000,
  accountId: 'acc-1',
  categoryId: 'cat-1',
  toAccountId: null,
  direction: null,
  note: null,
  tags: [],
  groupId: null,
  origin: 'manual',
  recurringRuleId: null,
  idempotencyKey: null,
  ...over,
})

export const transferTx = (
  over: Partial<NewRecord<Extract<Transaction, { type: 'transfer' }>>> = {},
): NewRecord<Transaction> => ({
  type: 'transfer',
  date: '2026-08-06',
  amount: 3_000_000,
  accountId: 'acc-1',
  toAccountId: 'acc-2',
  categoryId: null,
  direction: null,
  note: null,
  tags: [],
  groupId: null,
  origin: 'manual',
  recurringRuleId: null,
  idempotencyKey: null,
  ...over,
})

export const holding = (over: Partial<NewRecord<Holding>> = {}): NewRecord<Holding> => ({
  accountId: 'acc-inv',
  symbol: 'FPT',
  name: 'CTCP FPT',
  assetType: 'stock',
  unit: 'cp',
  quantityDecimals: 0,
  ...over,
})

export const trade = (over: Partial<NewRecord<InvestmentTrade>> = {}): NewRecord<InvestmentTrade> => ({
  holdingId: 'h-1',
  date: '2026-08-15',
  side: 'buy',
  quantity: '1000',
  price: 120_000,
  fee: 180_000,
  tax: 0,
  cashAccountId: 'acc-inv',
  isOpening: false,
  groupId: null,
  ...over,
})

export const depositTerm = (over: Partial<NewRecord<DepositTerm>> = {}): NewRecord<DepositTerm> => ({
  accountId: 'acc-td',
  seq: 1,
  principal: 100_000_000,
  annualRate: 0.055,
  termMonths: 6,
  startDate: '2026-03-01',
  maturityDate: '2026-09-01',
  status: 'active',
  interestPaid: 0,
  closedAt: null,
  ...over,
})

export const recurringRule = (over: Partial<NewRecord<RecurringRule>> = {}): NewRecord<RecurringRule> => ({
  name: 'Lương',
  template: {
    type: 'income',
    amount: 18_000_000,
    accountId: 'acc-1',
    categoryId: 'cat-salary',
    toAccountId: null,
    direction: null,
    note: null,
    tags: [],
  },
  frequency: 'monthly',
  intervalCount: 1,
  dayOfMonth: 5,
  startDate: '2026-08-05',
  endDate: null,
  nextDate: '2026-09-05',
  mode: 'auto',
  pausedAt: null,
  ...over,
})
