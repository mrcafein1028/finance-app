import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { createLedger, type Ledger } from '../domain/networth'
import { today } from '../lib/clock'
import type {
  Account,
  AssetValuation,
  BudgetLine,
  BudgetMonth,
  Category,
  DepositTerm,
  Holding,
  InvestmentTrade,
  NetWorthSnapshot,
  PriceQuote,
  RecurringRule,
  Settings,
  Transaction,
} from '../schemas'
import { DEFAULT_SETTINGS } from './repositories'
import { getRepos } from './index'

// Hook đọc dữ liệu qua TanStack Query. Mọi màn hình dùng chung cache theo các khóa dưới đây;
// sau khi ghi, gọi useInvalidate() để các màn hình liên quan tự tải lại (docs/02 §3).

export const queryKeys = {
  settings: ['settings'] as const,
  accounts: ['accounts'] as const,
  categories: ['categories'] as const,
  transactions: ['transactions'] as const,
  budgetMonths: ['budgetMonths'] as const,
  budgetLines: ['budgetLines'] as const,
  recurringRules: ['recurringRules'] as const,
  snapshots: ['snapshots'] as const,
  holdings: ['holdings'] as const,
  trades: ['trades'] as const,
  priceQuotes: ['priceQuotes'] as const,
  valuations: ['valuations'] as const,
  depositTerms: ['depositTerms'] as const,
}
export type QueryName = keyof typeof queryKeys

const byDateDesc = <T extends { date: string; createdAt: string }>(a: T, b: T) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)

export const useSettings = () => useQuery({ queryKey: queryKeys.settings, queryFn: () => getRepos().settings.get() })
export const useAccounts = () =>
  useQuery({
    queryKey: queryKeys.accounts,
    queryFn: async () => (await getRepos().accounts.list()).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi')),
  })
export const useCategories = () => useQuery({ queryKey: queryKeys.categories, queryFn: () => getRepos().categories.list() })
/** Mọi giao dịch của người dùng (đủ nhỏ để giữ trong bộ nhớ; 10.000 giao dịch ≈ 2 MB). */
export const useTransactions = () => useQuery({ queryKey: queryKeys.transactions, queryFn: async () => (await getRepos().transactions.list()).sort(byDateDesc) })
export const useBudgetMonths = () => useQuery({ queryKey: queryKeys.budgetMonths, queryFn: () => getRepos().budgetMonths.list() })
export const useBudgetLines = () => useQuery({ queryKey: queryKeys.budgetLines, queryFn: () => getRepos().budgetLines.list() })
export const useRecurringRules = () => useQuery({ queryKey: queryKeys.recurringRules, queryFn: () => getRepos().recurringRules.list() })
export const useSnapshots = () => useQuery({ queryKey: queryKeys.snapshots, queryFn: () => getRepos().snapshots.list() })
export const useHoldings = () => useQuery({ queryKey: queryKeys.holdings, queryFn: () => getRepos().holdings.list() })
export const useTrades = () => useQuery({ queryKey: queryKeys.trades, queryFn: () => getRepos().trades.list() })
export const usePriceQuotes = () => useQuery({ queryKey: queryKeys.priceQuotes, queryFn: () => getRepos().priceQuotes.list() })
export const useValuations = () => useQuery({ queryKey: queryKeys.valuations, queryFn: () => getRepos().assetValuations.list() })
export const useDepositTerms = () => useQuery({ queryKey: queryKeys.depositTerms, queryFn: () => getRepos().depositTerms.list() })

/** Làm mới cache sau khi ghi. Không truyền khóa → làm mới tất cả. */
export function useInvalidate() {
  const client = useQueryClient()
  return useCallback(
    (...keys: QueryName[]) =>
      Promise.all((keys.length ? keys : (Object.keys(queryKeys) as QueryName[])).map((k) => client.invalidateQueries({ queryKey: queryKeys[k] }))),
    [client],
  )
}

export interface LedgerView {
  settings: Settings
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  holdings: Holding[]
  trades: InvestmentTrade[]
  prices: PriceQuote[]
  valuations: AssetValuation[]
  depositTerms: DepositTerm[]
  ledger: Ledger
  /** Giá trị hiện tại (hôm nay) theo account — tài sản: giá trị; nợ: dư nợ. */
  balances: Map<string, number>
  categoryById: Map<string, Category>
  accountById: Map<string, Account>
}

/** Toàn bộ dữ liệu gốc + sổ cái đã dựng sẵn — nền cho mọi màn hình tính số dư / net worth. */
export function useLedgerView(): { data: LedgerView | undefined; isLoading: boolean; error: unknown } {
  const queries = {
    settings: useSettings(),
    accounts: useAccounts(),
    categories: useCategories(),
    transactions: useTransactions(),
    holdings: useHoldings(),
    trades: useTrades(),
    prices: usePriceQuotes(),
    valuations: useValuations(),
    depositTerms: useDepositTerms(),
  }
  const all = Object.values(queries)
  const ready = all.every((q) => q.data !== undefined)

  const data = useMemo(() => {
    if (!ready) return undefined
    const settings = queries.settings.data ?? DEFAULT_SETTINGS
    const accounts = queries.accounts.data!
    const ledger = createLedger({
      accounts,
      transactions: queries.transactions.data!,
      holdings: queries.holdings.data!,
      trades: queries.trades.data!,
      prices: queries.prices.data!,
      valuations: queries.valuations.data!,
      depositTerms: queries.depositTerms.data!,
      includeAccruedInterest: settings.includeAccruedInterest,
    })
    const date = today()
    return {
      settings,
      accounts,
      categories: queries.categories.data!,
      transactions: queries.transactions.data!,
      holdings: queries.holdings.data!,
      trades: queries.trades.data!,
      prices: queries.prices.data!,
      valuations: queries.valuations.data!,
      depositTerms: queries.depositTerms.data!,
      ledger,
      balances: new Map(accounts.map((a) => [a.id, ledger.valueOf(a, date)])),
      categoryById: new Map(queries.categories.data!.map((c) => [c.id, c])),
      accountById: new Map(accounts.map((a) => [a.id, a])),
    }
  }, [
    ready,
    queries.settings.data,
    queries.accounts.data,
    queries.categories.data,
    queries.transactions.data,
    queries.holdings.data,
    queries.trades.data,
    queries.prices.data,
    queries.valuations.data,
    queries.depositTerms.data,
  ])

  return {
    data,
    isLoading: all.some((q) => q.isLoading),
    error: all.find((q) => q.error)?.error ?? null,
  }
}

export type { BudgetLine, BudgetMonth, NetWorthSnapshot, RecurringRule }
