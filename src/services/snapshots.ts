import type { Repositories } from '../data/repositories'
import { buildSnapshot, type Ledger } from '../domain/networth'
import { nextMonth, periodOf, periodRange } from '../domain/period'
import type { Account, NetWorthSnapshot } from '../schemas'

/** Các kỳ đã kết thúc kể từ kỳ chứa ngày bắt đầu theo dõi sớm nhất (tối đa 120 kỳ). */
export function endedMonths(accounts: readonly Account[], today: string, periodStartDay: number): string[] {
  if (accounts.length === 0) return []
  const first = accounts.reduce((min, a) => (a.openingDate < min ? a.openingDate : min), accounts[0]!.openingDate)
  const months: string[] = []
  for (let m = periodOf(first, periodStartDay); periodRange(m, periodStartDay).end < today && months.length < 120; m = nextMonth(m)) months.push(m)
  return months
}

const sameValues = (a: NetWorthSnapshot, b: Omit<NetWorthSnapshot, 'id' | 'computedAt'>) =>
  a.asOf === b.asOf &&
  a.netWorth === b.netWorth &&
  a.totalAssets === b.totalAssets &&
  a.totalLiabilities === b.totalLiabilities &&
  a.liquidAssets === b.liquidAssets &&
  JSON.stringify(a.byAccount) === JSON.stringify(b.byAccount) &&
  !a.stale

/**
 * W18 bước 5 — tạo snapshot cho mọi kỳ đã kết thúc, và tính lại những snapshot đã lệch với dữ liệu
 * hiện tại (VD vừa ghi giao dịch lùi ngày — E4). Chỉ ghi khi có thay đổi → chạy lại không tốn gì.
 */
export async function refreshSnapshots(
  repos: Repositories,
  ledger: Ledger,
  accounts: readonly Account[],
  existing: readonly NetWorthSnapshot[],
  today: string,
  periodStartDay: number,
): Promise<number> {
  const byMonth = new Map(existing.map((s) => [s.month, s]))
  let written = 0
  for (const month of endedMonths(accounts, today, periodStartDay)) {
    const computed = buildSnapshot(ledger, month, periodStartDay, new Date().toISOString())
    const stored = byMonth.get(month)
    if (stored && sameValues(stored, computed)) continue
    await repos.snapshots.put({ id: stored?.id ?? crypto.randomUUID(), ...computed })
    written++
  }
  return written
}
