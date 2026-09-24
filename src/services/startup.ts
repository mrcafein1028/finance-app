import type { Repositories } from '../data/repositories'
import type { Ledger } from '../domain/networth'
import type { Account, DepositTerm, NetWorthSnapshot, RecurringRule, Settings } from '../schemas'
import { runDepositPayouts } from './savings'
import { runRecurring } from './recurring'
import { refreshSnapshots } from './snapshots'

export interface StartupInput {
  settings: Settings
  accounts: readonly Account[]
  rules: readonly RecurringRule[]
  depositTerms: readonly DepositTerm[]
  snapshots: readonly NetWorthSnapshot[]
  ledger: Ledger
  today: string
}

export interface StartupReport {
  recurringCreated: number
  pendingConfirmations: number
  interestPayouts: number
  snapshotsWritten: number
}

/**
 * W18 — việc chạy mỗi lần mở app. Mọi bước đều idempotent (khóa chống trùng trong Postgres,
 * chỉ ghi khi có thay đổi) nên mở 2 tab / 2 thiết bị hay tải lại giữa chừng đều không tạo trùng.
 * Migration đã do Supabase chạy khi deploy nên không nằm ở đây.
 */
export async function runStartupTasks(repos: Repositories, input: StartupInput, reloadLedger: () => Promise<Ledger>): Promise<StartupReport> {
  const recurring = await runRecurring(repos, input.rules, input.today)
  const interestPayouts = await runDepositPayouts(repos, input.accounts, input.depositTerms, input.today)
  // Vừa sinh giao dịch cho các kỳ bị lỡ (E3) → tải lại sổ cái để snapshot các kỳ đó đúng.
  const ledger = recurring.created + interestPayouts > 0 ? await reloadLedger() : input.ledger
  const snapshotsWritten = await refreshSnapshots(repos, ledger, input.accounts, input.snapshots, input.today, input.settings.periodStartDay)
  return { recurringCreated: recurring.created, pendingConfirmations: recurring.pending.length, interestPayouts, snapshotsWritten }
}
