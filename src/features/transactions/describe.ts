import { describeTransfer } from '../../domain/validation'
import { KIND_META, type Account, type Category, type Transaction } from '../../schemas'

export interface ListContext {
  accountById: ReadonlyMap<string, Account>
  categoryById: ReadonlyMap<string, Category>
}

export function describeTransaction(tx: Transaction, ctx: ListContext): string {
  switch (tx.type) {
    case 'transfer':
      return describeTransfer(ctx.accountById.get(tx.accountId), ctx.accountById.get(tx.toAccountId))
    case 'adjustment':
      return tx.direction === 'up' ? 'Điều chỉnh tăng số dư' : 'Điều chỉnh giảm số dư'
    default: {
      const c = ctx.categoryById.get(tx.categoryId)
      const name = c?.name ?? 'Danh mục đã xóa'
      return tx.type === 'refund' ? `Hoàn tiền · ${name}` : name
    }
  }
}

export const kindLabel = (kind: Account['kind']) => KIND_META[kind].label
