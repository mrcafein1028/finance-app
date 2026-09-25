import { ValidationError } from '../data/errors'
import type { Repositories } from '../data/repositories'
import type { NewRecord } from '../data/repositories/base'
import { DomainError } from '../domain/errors'
import { positionAt } from '../domain/investment'
import { D, round } from '../domain/money'
import { newId } from '../lib/id'
import { nowIso } from '../lib/clock'
import type { Account, Holding, InvestmentTrade, Transaction } from '../schemas'

const baseAccount = (name: string, openingBalance: number, openingDate: string, sortOrder: number) => ({
  name,
  class: 'asset' as const,
  currency: 'VND' as const,
  openingBalance,
  openingDate,
  isLiquid: false,
  includeInNetWorth: true,
  isEmergencyFund: false,
  goal: null,
  archivedAt: null,
  icon: null,
  color: null,
  note: null,
  sortOrder,
})

/** F4 — tài khoản đầu tư (công ty chứng khoán, Fmarket, "Vàng tích trữ"…) với tiền mặt ban đầu. */
export const createInvestmentAccount = (repos: Repositories, v: { name: string; platform: string; cash: number; openingDate: string }, sortOrder: number) =>
  repos.accounts.create({ ...baseAccount(v.name, v.cash, v.openingDate, sortOrder), kind: 'investment', details: { platform: v.platform || null, costMethod: 'average' } } as NewRecord<Account>)

/** Tài sản khác (nhà, xe…) với giá trị ước tính. */
export const createOtherAsset = (repos: Repositories, v: { name: string; value: number; date: string; note: string }, sortOrder: number) =>
  repos.accounts.create({ ...baseAccount(v.name, v.value, v.date, sortOrder), note: v.note || null, kind: 'other_asset', details: null } as NewRecord<Account>)

export const addHolding = (repos: Repositories, v: Omit<NewRecord<Holding>, 'quantityDecimals'> & { quantityDecimals?: number }) =>
  repos.holdings.create({ quantityDecimals: 0, ...v })

export interface TradeInput {
  account: Account
  holding: Holding
  side: 'buy' | 'sell'
  date: string
  quantity: string
  price: number
  fee: number
  tax: number
  /** Tài khoản trả/nhận tiền; = tài khoản đầu tư nếu dùng tiền mặt sẵn trong đó. */
  cashAccountId: string
  /** Vị thế đã có trước khi dùng app — ghi giá vốn, không trừ tiền (W10 bước 2). */
  isOpening?: boolean
}

/**
 * W10 bước 3 — ghi lệnh mua/bán. Kèm các giao dịch tiền cùng groupId:
 * phí + thuế = chi phí "Phí & thuế đầu tư"; nếu tiền đi/về tài khoản khác → chuyển khoản tương ứng.
 * Kiểm tra bán quá số đang có (I5) trước khi ghi.
 */
export async function recordTrade(repos: Repositories, input: TradeInput, allTrades: readonly InvestmentTrade[]): Promise<InvestmentTrade> {
  const q = new D(input.quantity)
  if (!q.isFinite() || q.lte(0)) throw new ValidationError([{ path: 'quantity', message: 'Số lượng phải lớn hơn 0' }])
  const groupId = newId()
  const draft: InvestmentTrade = {
    id: newId(),
    holdingId: input.holding.id,
    date: input.date,
    side: input.side,
    quantity: q.toString(),
    price: input.price,
    fee: input.fee,
    tax: input.tax,
    cashAccountId: input.cashAccountId,
    isOpening: input.isOpening ?? false,
    groupId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  try {
    // Lệnh đang nhập là lệnh MỚI NHẤT trong ngày của nó — không dựa vào giờ máy người dùng (có thể lệch với
    // giờ máy chủ đã ghi các lệnh trước) để khỏi báo nhầm "bán quá số đang có".
    positionAt([...allTrades.filter((t) => t.holdingId === input.holding.id), { ...draft, createdAt: '9999-12-31T23:59:59.999Z' }], '9999-12-31')
  } catch (e) {
    if (e instanceof DomainError) throw new ValidationError([{ path: 'quantity', message: e.message }])
    throw e
  }

  const trade = await repos.trades.create({ ...draft })
  if (draft.isOpening) return trade

  const gross = round(q.times(input.price))
  const costs = input.fee + input.tax
  const rows: Transaction[] = []
  const meta = (id = newId()) => ({ id, date: input.date, note: `${input.side === 'buy' ? 'Mua' : 'Bán'} ${input.quantity} ${input.holding.symbol}`, tags: [], groupId, origin: 'system' as const, recurringRuleId: null, idempotencyKey: null, createdAt: nowIso(), updatedAt: nowIso() })
  if (costs > 0) {
    const category = await repos.categories.bySystemKey('investment_fee_tax')
    if (!category) throw new ValidationError([{ path: '', message: 'Thiếu danh mục hệ thống "Phí & thuế đầu tư"' }])
    rows.push({ ...meta(), type: 'expense', amount: costs, accountId: input.account.id, categoryId: category.id, toAccountId: null, direction: null })
  }
  if (input.cashAccountId !== input.account.id) {
    const amount = input.side === 'buy' ? gross + costs : gross - costs
    if (amount > 0) {
      rows.push(
        input.side === 'buy'
          ? { ...meta(), type: 'transfer', amount, accountId: input.cashAccountId, toAccountId: input.account.id, categoryId: null, direction: null }
          : { ...meta(), type: 'transfer', amount, accountId: input.account.id, toAccountId: input.cashAccountId, categoryId: null, direction: null },
      )
    }
  }
  if (rows.length > 0) {
    try {
      await repos.transactions.saveGroup(groupId, rows)
    } catch (e) {
      await repos.trades.remove(trade.id) // giữ trọn vẹn: không để lệnh thiếu phần tiền
      throw e
    }
  }
  return trade
}

/** Xóa lệnh cùng các giao dịch tiền đi kèm. Chặn nếu làm lệnh bán sau đó bán quá số lượng. */
export async function deleteTrade(repos: Repositories, trade: InvestmentTrade, allTrades: readonly InvestmentTrade[]) {
  try {
    positionAt(allTrades.filter((t) => t.holdingId === trade.holdingId && t.id !== trade.id), '9999-12-31')
  } catch (e) {
    if (e instanceof DomainError) throw new ValidationError([{ path: '', message: `Không xóa được: ${e.message}` }])
    throw e
  }
  if (trade.groupId) await repos.transactions.deleteGroup(trade.groupId)
  await repos.trades.remove(trade.id)
}

/** F6 — cập nhật giá nhiều mã một lúc (chỉ các mã có giá mới). */
export async function updatePrices(repos: Repositories, date: string, prices: readonly { symbol: string; price: number }[]) {
  for (const p of prices) await repos.priceQuotes.upsert(p.symbol, date, p.price)
}

export const revalueAsset = (repos: Repositories, account: Account, date: string, value: number, note: string) =>
  repos.assetValuations.create({ accountId: account.id, date, value, note: note || null })

/** W11 — bán tài sản khác: định giá = giá bán tại ngày bán, chuyển tiền về tài khoản nhận, lưu trữ. */
export async function sellOtherAsset(repos: Repositories, account: Account, v: { date: string; price: number; toAccountId: string }) {
  await repos.assetValuations.create({ accountId: account.id, date: v.date, value: v.price, note: 'Giá bán' })
  if (v.price > 0) {
    await repos.transactions.create({
      type: 'transfer',
      date: v.date,
      amount: v.price,
      accountId: account.id,
      toAccountId: v.toAccountId,
      categoryId: null,
      direction: null,
      note: `Bán ${account.name}`,
      tags: [],
      groupId: null,
      origin: 'system',
      recurringRuleId: null,
      idempotencyKey: `asset-sale:${account.id}`,
    })
  }
  await repos.accounts.update(account.id, { archivedAt: nowIso() })
}
