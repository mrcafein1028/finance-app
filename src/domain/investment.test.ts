import { describe, expect, it } from 'vitest'
import { mai } from '../test/personas'
import { DomainError } from './errors'
import { createPriceBook, positionAt, tradeAmounts, tradeCashFlow, valueHolding } from './investment'

const p3 = mai()
const fpt = p3.holdings[0]!

describe('giá vốn bình quân — P3 Mai (docs/08 §4)', () => {
  it('mua 1.000 × 120.000 rồi 500 × 108.000 → giá vốn 116.000, tiền mặt giảm 174 tr', () => {
    const pos = positionAt(p3.buys, '2026-08-31')
    expect(pos.quantity.toString()).toBe('1500')
    expect(pos.avgCost.toNumber()).toBe(116_000)
    expect(pos.costBasis).toBe(174_000_000)
    expect(pos.feesAndTaxes).toBe(261_000)
    expect(tradeCashFlow(p3.buys, '2026-08-31')).toBe(-174_000_000)
  })

  it('giá 125.000 → giá trị 187,5 tr, lãi chưa thực hiện +13,5 tr (+7,76%)', () => {
    const v = valueHolding(fpt, p3.buys, createPriceBook(p3.prices), '2026-08-31')
    expect(v.marketValue).toBe(187_500_000)
    expect(v.unrealized).toBe(13_500_000)
    expect(v.returnPct).toBeCloseTo(0.0776, 4)
    expect(v.priceDate).toBe('2026-08-31')
  })

  it('chưa có giá → dùng giá vốn và báo priceDate = null', () => {
    const v = valueHolding(fpt, p3.buys, createPriceBook([]), '2026-08-31')
    expect(v.marketValue).toBe(174_000_000)
    expect(v.priceDate).toBeNull()
  })

  it('bán 600 × 130.000 → lãi thực hiện 8,4 tr; còn 900 cp, giá vốn vẫn 116.000', () => {
    const trades = [...p3.buys, p3.sell]
    const pos = positionAt(trades, '2026-09-10')
    expect(pos.realized).toBe(8_400_000)
    expect(pos.quantity.toString()).toBe('900')
    expect(pos.avgCost.toNumber()).toBe(116_000)
    expect(pos.feesAndTaxes).toBe(456_000)
    const v = valueHolding(fpt, trades, createPriceBook(p3.prices), '2026-09-10')
    expect(v.netProfit).toBe(8_400_000 + (900 * 125_000 - 900 * 116_000) - 456_000)
  })

  it('bán 1.000 cp khi chỉ còn 900 → bị chặn (I5)', () => {
    const oversell = { ...p3.sell, id: 't4', date: '2026-09-11', quantity: '1000' }
    expect(() => positionAt([...p3.buys, p3.sell, oversell], '2026-09-30')).toThrow(DomainError)
  })

  it('số lượng thập phân không mất chính xác; vị thế đầu kỳ không trừ tiền', () => {
    const btc = [
      { ...p3.buys[0]!, quantity: '0.00125', price: 1_600_000_000, fee: 0 },
      { ...p3.buys[1]!, quantity: '0.1', price: 1_500_000_000, fee: 0, isOpening: true },
    ]
    const pos = positionAt(btc, '2026-08-31')
    expect(pos.quantity.toString()).toBe('0.10125')
    expect(tradeCashFlow(btc, '2026-08-31')).toBe(-2_000_000)
  })
})

describe('nhập lệnh: tổng tiền và phí / thuế theo %', () => {
  it('bán 100 CCQ, tổng 2.600.000, phí 1,5%, thuế 0,1% → nhận 2.558.400', () => {
    expect(tradeAmounts({ side: 'sell', quantity: '100', price: { mode: 'total', total: 2_600_000 }, fee: { mode: 'percent', rate: 0.015 }, tax: { mode: 'percent', rate: 0.001 } })).toEqual({
      unitPrice: 26_000,
      gross: 2_600_000,
      fee: 39_000,
      tax: 2_600,
      cash: 2_558_400,
      roundingDifference: 0,
    })
  })

  it('mua 196,5 CCQ tổng 5 triệu: giá làm tròn 25.445 ₫, lệch 57 ₫ được báo ra; phí nhập theo số tiền', () => {
    const r = tradeAmounts({ side: 'buy', quantity: '196.5', price: { mode: 'total', total: 5_000_000 }, fee: { mode: 'amount', amount: 0 }, tax: { mode: 'amount', amount: 0 } })
    expect(r).toMatchObject({ unitPrice: 25_445, gross: 4_999_943, cash: 4_999_943, roundingDifference: -57 })
  })

  it('nhập theo giá / đơn vị như cũ: 1.000 cp × 120.000, phí 0,15%', () => {
    expect(tradeAmounts({ side: 'buy', quantity: '1000', price: { mode: 'unit', unitPrice: 120_000 }, fee: { mode: 'percent', rate: 0.0015 }, tax: { mode: 'amount', amount: 0 } })).toMatchObject({ gross: 120_000_000, fee: 180_000, cash: 120_180_000 })
  })
})
