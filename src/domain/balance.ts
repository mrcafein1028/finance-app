import type { Account, AccountClass, IsoDate, Money, Transaction } from './types'

/**
 * Ảnh hưởng của một giao dịch lên số dư một account (docs/03 §3.5).
 * Với khoản nợ, "số dư" là dư nợ: dương = đang nợ. Trả về 0 nếu giao dịch không chạm tới account.
 */
export function transactionEffect(tx: Transaction, accountId: string, accountClass: AccountClass): Money {
  const isAsset = accountClass === 'asset'
  if (tx.type === 'transfer') {
    if (tx.accountId === accountId) return isAsset ? -tx.amount : tx.amount // nguồn: TS giảm / nợ tăng (giải ngân)
    if (tx.toAccountId === accountId) return isAsset ? tx.amount : -tx.amount // đích: TS tăng / nợ giảm (trả nợ)
    return 0
  }
  if (tx.accountId !== accountId) return 0
  switch (tx.type) {
    case 'income':
      return tx.amount // chỉ vào tài sản (DB chặn thu nhập vào khoản nợ)
    case 'expense':
      return isAsset ? -tx.amount : tx.amount // quẹt thẻ → dư nợ tăng
    case 'refund':
      return isAsset ? tx.amount : -tx.amount
    case 'adjustment':
      return tx.direction === 'up' ? tx.amount : -tx.amount
  }
}

/**
 * Đóng góp của giao dịch vào net worth qua account này: tài sản +, nợ −.
 * Tổng trên mọi account tính vào NW = biến động NW do giao dịch.
 */
export function netWorthEffect(tx: Transaction, account: Pick<Account, 'id' | 'class'>): Money {
  const effect = transactionEffect(tx, account.id, account.class)
  return account.class === 'asset' ? effect : -effect
}

/** Số dư theo giao dịch tại cuối ngày `date` = số dư đầu + Σ ảnh hưởng của giao dịch có ngày ≤ date. */
export function ledgerBalance(
  account: Pick<Account, 'id' | 'class' | 'openingBalance' | 'openingDate'>,
  transactions: readonly Transaction[],
  date: IsoDate,
): Money {
  if (date < account.openingDate) return 0
  let balance = account.openingBalance
  for (const tx of transactions) {
    if (tx.date <= date) balance += transactionEffect(tx, account.id, account.class)
  }
  return balance
}

/** Nhóm giao dịch theo mọi account mà chúng chạm tới (nguồn và đích). */
export function indexTransactionsByAccount(transactions: readonly Transaction[]): Map<string, Transaction[]> {
  const map = new Map<string, Transaction[]>()
  const push = (id: string, tx: Transaction) => {
    const list = map.get(id)
    if (list) list.push(tx)
    else map.set(id, [tx])
  }
  for (const tx of transactions) {
    push(tx.accountId, tx)
    if (tx.toAccountId && tx.toAccountId !== tx.accountId) push(tx.toAccountId, tx)
  }
  return map
}
