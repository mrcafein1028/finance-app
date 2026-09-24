import { ConflictError } from '../data/errors'
import type { Repositories } from '../data/repositories'
import type { NewRecord } from '../data/repositories/base'
import { dueOccurrences, firstOccurrence, nextOccurrenceAfter, recurringKey } from '../domain/recurring'
import { addDays } from '../domain/dates'
import type { RecurringRule, Transaction, TransactionTemplate } from '../schemas'

export type RuleDraft = Pick<RecurringRule, 'name' | 'template' | 'frequency' | 'intervalCount' | 'dayOfMonth' | 'startDate' | 'endDate' | 'mode'>

export async function createRule(repos: Repositories, draft: RuleDraft) {
  const nextDate = firstOccurrence(draft) ?? draft.startDate
  return repos.recurringRules.create({ ...draft, nextDate, pausedAt: null })
}

export async function updateRule(repos: Repositories, rule: RecurringRule, draft: RuleDraft) {
  // Đổi lịch → tính lại lần kế tiếp nhưng không quay lại các lần đã xử lý.
  const scheduleChanged =
    draft.frequency !== rule.frequency || draft.intervalCount !== rule.intervalCount || draft.dayOfMonth !== rule.dayOfMonth || draft.startDate !== rule.startDate
  const nextDate = scheduleChanged ? (nextOccurrenceAfter(draft, addDays(rule.nextDate, -1)) ?? rule.nextDate) : rule.nextDate
  return repos.recurringRules.update(rule.id, { ...draft, nextDate })
}

export const pauseRule = (repos: Repositories, rule: RecurringRule, paused: boolean) =>
  repos.recurringRules.update(rule.id, { pausedAt: paused ? new Date().toISOString() : null })

export const deleteRule = (repos: Repositories, rule: RecurringRule) => repos.recurringRules.remove(rule.id)

function transactionFrom(rule: RecurringRule, date: string, template: TransactionTemplate = rule.template): NewRecord<Transaction> {
  return {
    ...template,
    date,
    groupId: null,
    origin: 'recurring',
    recurringRuleId: rule.id,
    idempotencyKey: recurringKey(rule.id, date),
  } as NewRecord<Transaction>
}

/** Ghi một lần lặp. Đã ghi rồi (unique idempotency_key) → coi như xong, không tạo trùng (W18). */
async function post(repos: Repositories, rule: RecurringRule, date: string, template?: TransactionTemplate): Promise<'created' | 'existed'> {
  try {
    await repos.transactions.create(transactionFrom(rule, date, template))
    return 'created'
  } catch (e) {
    if (e instanceof ConflictError) return 'existed'
    throw e
  }
}

async function advance(repos: Repositories, rule: RecurringRule, processed: string) {
  const next = nextOccurrenceAfter(rule, processed)
  // Quy tắc hết hạn: đẩy nextDate qua ngày kết thúc để không còn lần nào đến hạn.
  return repos.recurringRules.update(rule.id, { nextDate: next ?? addDays(rule.endDate ?? processed, 1) })
}

export interface PendingOccurrence {
  rule: RecurringRule
  date: string
}

/**
 * W18 bước 2 — sinh các lần đến hạn của quy tắc "tự động" (kể cả các kỳ bị lỡ khi lâu không mở app);
 * quy tắc "cần xác nhận" trả về danh sách chờ. Chạy lại bao nhiêu lần cũng không tạo trùng.
 */
export async function runRecurring(repos: Repositories, rules: readonly RecurringRule[], today: string): Promise<{ created: number; pending: PendingOccurrence[] }> {
  let created = 0
  const pending: PendingOccurrence[] = []
  for (const rule of rules) {
    const due = dueOccurrences(rule, today)
    if (due.length === 0) continue
    if (rule.mode === 'confirm') {
      pending.push(...due.map((date) => ({ rule, date })))
      continue
    }
    for (const date of due) if ((await post(repos, rule, date)) === 'created') created++
    await advance(repos, rule, due.at(-1)!)
  }
  return { created, pending }
}

/** Xác nhận một lần chờ (có thể sửa số tiền) → ghi giao dịch và chuyển sang lần sau. */
export async function confirmOccurrence(repos: Repositories, rule: RecurringRule, date: string, amount?: number) {
  await post(repos, rule, date, amount ? { ...rule.template, amount } : undefined)
  return advance(repos, rule, date)
}

/** Bỏ qua một lần (VD tháng này không đóng tiền nhà) — không ghi giao dịch. */
export const skipOccurrence = (repos: Repositories, rule: RecurringRule, date: string) => advance(repos, rule, date)

/** Các lần chờ xác nhận (tính thuần, không ghi) — cho màn hình & thông báo. */
export const pendingOccurrences = (rules: readonly RecurringRule[], today: string): PendingOccurrence[] =>
  rules.filter((r) => r.mode === 'confirm').flatMap((rule) => dueOccurrences(rule, today).map((date) => ({ rule, date })))
