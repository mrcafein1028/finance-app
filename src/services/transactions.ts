import type { Repositories } from '../data/repositories'
import type { NewRecord } from '../data/repositories/base'
import { checkTransaction, type CheckIssue, type CheckWarning, type TransactionCheckContext } from '../domain/validation'
import { nowIso } from '../lib/clock'
import { newId } from '../lib/id'
import type { Transaction } from '../schemas'
import type { TransactionFormValues } from '../schemas/forms'

export type SaveOutcome =
  | { status: 'saved'; transaction: Transaction; undo: () => Promise<void> }
  | { status: 'needs_confirmation'; warnings: CheckWarning[] }
  | { status: 'invalid'; errors: CheckIssue[] }

/** Giá trị form → bản ghi giao dịch (chưa lưu). Giữ id/metadata khi sửa. */
export function transactionFromForm(values: TransactionFormValues, editing: Transaction | null): Transaction {
  const now = nowIso()
  const common = {
    id: editing?.id ?? newId(),
    date: values.date,
    amount: values.amount,
    accountId: values.accountId,
    note: values.note || null,
    tags: editing?.tags ?? [],
    groupId: editing?.groupId ?? null,
    origin: editing?.origin ?? ('manual' as const),
    recurringRuleId: editing?.recurringRuleId ?? null,
    idempotencyKey: editing?.idempotencyKey ?? null,
    createdAt: editing?.createdAt ?? now,
    updatedAt: now,
  }
  if (values.type === 'transfer') {
    return { ...common, type: 'transfer', toAccountId: values.toAccountId, categoryId: null, direction: null }
  }
  return { ...common, type: values.type, categoryId: values.categoryId, toAccountId: null, direction: null } as Transaction
}

const withoutMeta = (t: Transaction): NewRecord<Transaction> => {
  const { createdAt: _c, updatedAt: _u, ...rest } = t
  return rest as NewRecord<Transaction>
}

/**
 * Lưu giao dịch mới hoặc bản sửa (W1, W2, W3). Kiểm tra nghiệp vụ trước; cảnh báo cần xác nhận
 * thì trả về để UI hỏi lại, lần gọi sau truyền `confirmed: true`.
 */
export async function saveTransaction(
  repos: Repositories,
  tx: Transaction,
  context: TransactionCheckContext,
  { confirmed = false }: { confirmed?: boolean } = {},
): Promise<SaveOutcome> {
  const editing = context.editing ?? null
  const { errors, warnings } = checkTransaction(tx, context)
  if (errors.length) return { status: 'invalid', errors }
  if (!confirmed && warnings.some((w) => w.confirm)) return { status: 'needs_confirmation', warnings }

  if (editing) {
    const { id: _id, ...patch } = withoutMeta(tx)
    const saved = await repos.transactions.update(editing.id, patch)
    return {
      status: 'saved',
      transaction: saved,
      undo: async () => {
        const { id: _i, ...previous } = withoutMeta(editing)
        await repos.transactions.update(editing.id, previous)
      },
    }
  }
  const saved = await repos.transactions.create(withoutMeta(tx))
  return { status: 'saved', transaction: saved, undo: () => repos.transactions.remove(saved.id) }
}

/** Xóa giao dịch (cả nhóm nếu thuộc nhóm — I8). Trả về hàm hoàn tác khôi phục đúng các bản ghi cũ. */
export async function deleteTransaction(repos: Repositories, tx: Transaction, all: readonly Transaction[]): Promise<() => Promise<void>> {
  if (tx.groupId) {
    const group = all.filter((t) => t.groupId === tx.groupId)
    await repos.transactions.deleteGroup(tx.groupId)
    return async () => {
      await repos.transactions.saveGroup(tx.groupId!, group)
    }
  }
  await repos.transactions.remove(tx.id)
  return async () => {
    await repos.transactions.create(withoutMeta(tx))
  }
}
