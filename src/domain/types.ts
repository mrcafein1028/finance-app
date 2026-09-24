// Kiểu thực thể cho tầng domain. Suy ra từ Zod schema để form, DB và công thức
// luôn dùng chung một định nghĩa (docs/02 §4). Chỉ import kiểu — domain vẫn là hàm thuần.
export type {
  Account,
  AccountClass,
  AccountKind,
  AccountOf,
  AssetValuation,
  BudgetBucket,
  BudgetLine,
  BudgetMode,
  BudgetMonth,
  BudgetTarget,
  Category,
  CategoryType,
  CreditCardDetails,
  DepositTerm,
  Holding,
  InvestmentDetails,
  InvestmentTrade,
  LoanDetails,
  LoanRateType,
  NetWorthSnapshot,
  PriceQuote,
  RecurringRule,
  Settings,
  SystemCategoryKey,
  TermDepositDetails,
  Transaction,
  TransactionOf,
  TransactionTemplate,
  TransactionType,
} from '../schemas'

/** Số tiền nguyên đồng. Có dấu khi là số liệu dẫn xuất (net worth, chênh lệch). */
export type Money = number

/** Ngày dạng YYYY-MM-DD. */
export type IsoDate = string

/** Kỳ ngân sách dạng YYYY-MM. */
export type MonthKey = string
