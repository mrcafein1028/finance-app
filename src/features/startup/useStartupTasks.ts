import { useEffect, useRef } from 'react'
import { getRepos } from '../../data'
import { useInvalidate, useLedgerView, useRecurringRules, useSnapshots } from '../../data/queries'
import { createLedger } from '../../domain/networth'
import { today } from '../../lib/clock'
import { runStartupTasks } from '../../services/startup'
import { useAuth } from '../auth/authContext'

/** Chạy W18 một lần mỗi phiên (mỗi người dùng), sau khi dữ liệu đã tải xong. */
export function useStartupTasks() {
  const { user } = useAuth()
  const { data: view } = useLedgerView()
  const rules = useRecurringRules().data
  const snapshots = useSnapshots().data
  const invalidate = useInvalidate()
  const ranFor = useRef<string | null>(null)

  useEffect(() => {
    if (!user || !view || !rules || !snapshots || ranFor.current === user.id) return
    ranFor.current = user.id
    const repos = getRepos()
    runStartupTasks(
      repos,
      { settings: view.settings, accounts: view.accounts, rules, depositTerms: view.depositTerms, snapshots, ledger: view.ledger, today: today() },
      async () =>
        createLedger({
          accounts: view.accounts,
          transactions: await repos.transactions.list(),
          holdings: view.holdings,
          trades: view.trades,
          prices: view.prices,
          valuations: view.valuations,
          depositTerms: view.depositTerms,
          includeAccruedInterest: view.settings.includeAccruedInterest,
        }),
    )
      .then((report) => {
        if (report.recurringCreated + report.interestPayouts > 0) void invalidate('transactions', 'recurringRules')
        if (report.snapshotsWritten > 0) void invalidate('snapshots')
      })
      .catch((e: unknown) => {
        // Việc nền không được chặn người dùng; lần mở app sau sẽ thử lại.
        console.warn('Tác vụ khởi động lỗi:', e)
        ranFor.current = null
      })
  }, [user, view, rules, snapshots, invalidate])
}
