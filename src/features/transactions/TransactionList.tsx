import { transactionEffect } from '../../domain/balance'
import { today } from '../../lib/clock'
import { formatDate } from '../../lib/format'
import type { Transaction } from '../../schemas'
import { Money } from '../../components/ui/Money'
import { describeTransaction, type ListContext } from './describe'

const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy']
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!

/** Số tiền hiển thị: theo góc nhìn của một account (trang chi tiết) hoặc theo thu/chi (danh sách chung). */
function displayAmount(tx: Transaction, ctx: ListContext, accountId?: string): number {
  if (accountId) {
    const account = ctx.accountById.get(accountId)
    if (account) return transactionEffect(tx, accountId, account.class) * (account.class === 'liability' ? -1 : 1)
  }
  switch (tx.type) {
    case 'income':
    case 'refund':
      return tx.amount
    case 'expense':
      return -tx.amount
    case 'adjustment':
      return tx.direction === 'up' ? tx.amount : -tx.amount
    case 'transfer':
      return 0
  }
}

function accountLine(tx: Transaction, ctx: ListContext): string {
  const from = ctx.accountById.get(tx.accountId)?.name ?? '?'
  if (tx.type === 'transfer') return `${from} → ${ctx.accountById.get(tx.toAccountId)?.name ?? '?'}`
  return from
}

export function TransactionList({
  transactions,
  ctx,
  accountId,
  onSelect,
}: {
  transactions: readonly Transaction[]
  ctx: ListContext
  /** Hiển thị số tiền theo ảnh hưởng lên account này. */
  accountId?: string
  onSelect: (tx: Transaction) => void
}) {
  const byDate = new Map<string, Transaction[]>()
  for (const tx of transactions) {
    const list = byDate.get(tx.date) ?? []
    list.push(tx)
    byDate.set(tx.date, list)
  }
  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a))
  const now = today()

  return (
    <div className="flex flex-col gap-4">
      {dates.map((date) => (
        <section key={date} aria-label={`Ngày ${formatDate(date)}`}>
          <h3 className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-muted">
            {weekday(date)}, {formatDate(date)}
            {date > now && ' · dự kiến'}
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {byDate.get(date)!.map((tx) => {
              const amount = displayAmount(tx, ctx, accountId)
              const label = describeTransaction(tx, ctx)
              return (
                <li key={tx.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(tx)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas"
                    aria-label={`${label}, ${accountLine(tx, ctx)}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{label}</span>
                      <span className="block truncate text-sm text-muted">
                        {accountLine(tx, ctx)}
                        {tx.note ? ` · ${tx.note}` : ''}
                      </span>
                    </span>
                    {tx.type === 'transfer' && !accountId ? (
                      <Money value={tx.amount} className="text-muted" />
                    ) : (
                      <Money value={amount} sign tone="auto" />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
