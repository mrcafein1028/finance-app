import type { Repositories } from '../data/repositories'
import type { BudgetLineDraft } from '../domain/budget'
import { buildSnapshot, type Ledger } from '../domain/networth'
import { nowIso } from '../lib/clock'
import type { BudgetLine, BudgetMode, BudgetMonth, BudgetTarget } from '../schemas'

/** W5 — tạo ngân sách tháng cùng các dòng (sao chép / 50-30-20 / trống). */
export async function createBudgetMonth(
  repos: Repositories,
  month: string,
  values: { mode: BudgetMode; expectedIncome: number; lines: readonly BudgetLineDraft[] },
): Promise<BudgetMonth> {
  const existing = await repos.budgetMonths.byMonth(month)
  const bm = existing
    ? await repos.budgetMonths.update(existing.id, { mode: values.mode, expectedIncome: values.expectedIncome })
    : await repos.budgetMonths.create({ month, mode: values.mode, expectedIncome: values.expectedIncome, status: 'open', closedAt: null, note: null })
  for (const l of values.lines) await repos.budgetLines.upsert(month, l.target, { planned: l.planned, rollover: l.rollover })
  return bm
}

export const updateExpectedIncome = (repos: Repositories, bm: BudgetMonth, expectedIncome: number) =>
  repos.budgetMonths.update(bm.id, { expectedIncome })

export const saveLine = (repos: Repositories, month: string, target: BudgetTarget, planned: number, rollover: boolean) =>
  repos.budgetLines.upsert(month, target, { planned, rollover })

export const removeLine = (repos: Repositories, line: BudgetLine) => repos.budgetLines.remove(line.id)

/** W7 — đóng tháng: khóa ngân sách, lưu snapshot net worth cuối kỳ. */
export async function closeMonth(repos: Repositories, bm: BudgetMonth, ledger: Ledger, periodStartDay: number) {
  await repos.snapshots.put({ id: crypto.randomUUID(), ...buildSnapshot(ledger, bm.month, periodStartDay, nowIso()) })
  return repos.budgetMonths.update(bm.id, { status: 'closed', closedAt: nowIso() })
}

export const reopenMonth = (repos: Repositories, bm: BudgetMonth) => repos.budgetMonths.update(bm.id, { status: 'open', closedAt: null })
