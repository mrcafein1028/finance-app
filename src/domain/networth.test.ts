import { describe, expect, it } from 'vitest'
import { adjustment, hung, lan, mai, makeAccount, transfer } from '../test/personas'
import { buildSnapshot, createLedger, explainNetWorthChange, netWorthAt, sumOfChange } from './networth'

describe('P1 Lan — net worth (docs/08 §2)', () => {
  const p1 = lan()
  const ledger = createLedger({ accounts: p1.accounts, transactions: p1.transactions })

  it('thiết lập ngày 01/08: net worth 37.500.000', () => {
    expect(netWorthAt(ledger, '2026-08-01').netWorth).toBe(37_500_000)
    expect(netWorthAt(ledger, '2026-07-31').netWorth).toBe(0)
  })

  it('cuối tháng 8: số dư từng account và net worth 43.250.000', () => {
    const nw = netWorthAt(ledger, '2026-08-31')
    expect(nw.byAccount).toEqual({ vcb: 27_950_000, cash: 1_400_000, momo: 900_000, fund: 13_000_000 })
    expect(nw).toMatchObject({ totalAssets: 43_250_000, totalLiabilities: 0, netWorth: 43_250_000, liquidAssets: 43_250_000 })
  })

  it('phân rã tháng 8: Δ = +5.750.000 = dòng tiền ròng, thị trường = 0', () => {
    const c = explainNetWorthChange(ledger, '2026-08-02', '2026-08-31')
    expect(c).toMatchObject({ startNetWorth: 37_500_000, endNetWorth: 43_250_000, income: 18_000_000, expense: -12_450_000, refund: 200_000, market: 0, other: 0 })
    expect(sumOfChange(c)).toBe(5_750_000)
  })

  it('cả tháng tính từ 01/08: số dư ban đầu 37,5 tr là một mục riêng', () => {
    const c = explainNetWorthChange(ledger, '2026-08-01', '2026-08-31')
    expect(c).toMatchObject({ startNetWorth: 0, openingBalances: 37_500_000, other: 0 })
    expect(c.startNetWorth + sumOfChange(c)).toBe(c.endNetWorth)
  })

  it('snapshot cuối kỳ', () => {
    const s = buildSnapshot(ledger, '2026-08', 1, '2026-09-01T00:00:00.000Z')
    expect(s).toMatchObject({ month: '2026-08', asOf: '2026-08-31', netWorth: 43_250_000, stale: false })
    expect(s.byKind).toEqual({ bank: 27_950_000, cash: 1_400_000, ewallet: 900_000, goal_fund: 13_000_000 })
  })
})

describe('P2 Hùng — khoản vay & sổ tiết kiệm (docs/08 §3)', () => {
  const p2 = hung()
  const base = [p2.openDeposit]
  const ledgerWith = (transactions = base, includeAccruedInterest = true) =>
    createLedger({ accounts: p2.accounts, transactions, depositTerms: [p2.term1], includeAccruedInterest })

  it('ngày 01/06: giá trị sổ = 100.000.000 + lãi dồn tích 1.386.301', () => {
    expect(ledgerWith().valueOf(p2.accounts[2]!, '2026-06-01')).toBe(101_386_301)
    expect(ledgerWith(base, false).valueOf(p2.accounts[2]!, '2026-06-01')).toBe(100_000_000)
  })

  it('trả kỳ 1: VCB −14 tr, dư nợ 1.195.000.000, net worth chỉ giảm 9 tr (phần lãi)', () => {
    const before = netWorthAt(ledgerWith(), '2026-09-09')
    const ledger = ledgerWith([...base, ...p2.payment1])
    const after = netWorthAt(ledger, '2026-09-10')
    expect(after.byAccount.home).toBe(1_195_000_000)
    expect(after.byAccount.vcb! - before.byAccount.vcb!).toBe(-14_000_000)
    // Sổ đã hết kỳ ngày 01/09 nhưng chưa xử lý đáo hạn → giữ giá trị gốc + lãi cả kỳ.
    expect(after.byAccount.td).toBe(102_772_603)
    expect(after.netWorth - before.netWorth).toBe(-9_000_000)

    const c = explainNetWorthChange(ledger, '2026-09-10', '2026-09-10')
    expect(c).toMatchObject({ expense: -9_000_000, income: 0, externalTransfer: 0 })
    expect(sumOfChange(c)).toBe(-9_000_000)
  })

  it('xóa cả nhóm giao dịch trả nợ → dư nợ về 1.200.000.000', () => {
    expect(netWorthAt(ledgerWith(), '2026-09-30').byAccount.home).toBe(1_200_000_000)
  })

  it('lãi dồn tích xuất hiện thành một mục riêng trong thác nước', () => {
    const c = explainNetWorthChange(ledgerWith(), '2026-04-01', '2026-06-01')
    // Dồn tích tới 01/06 (92 ngày) − tới 31/03 (30 ngày) = 1.386.301 − 452.055
    expect(c.accruedInterest).toBe(934_246)
    expect(c.startNetWorth + sumOfChange(c)).toBe(c.endNetWorth)
  })
})

describe('P3 Mai — đầu tư & thẻ (docs/08 §4)', () => {
  const p3 = mai()
  const ledger = createLedger({
    accounts: p3.accounts,
    transactions: p3.transactions,
    holdings: p3.holdings,
    trades: p3.buys,
    prices: p3.prices,
  })

  it('tiền mặt TK chứng khoán 125.739.000 + cổ phiếu 187.500.000', () => {
    const ck = p3.accounts[1]!
    expect(ledger.valueOf(ck, '2026-08-31')).toBe(125_739_000 + 187_500_000)
  })

  it('thác nước tháng 8: thị trường +13.500.000, chi tiêu gồm 261.000 phí, thẻ là số dư ban đầu', () => {
    const c = explainNetWorthChange(ledger, '2026-08-01', '2026-08-31')
    expect(c).toMatchObject({ market: 13_500_000, expense: -261_000, income: 60_000_000, openingBalances: -20_000_000, other: 0 })
    expect(c.startNetWorth + sumOfChange(c)).toBe(c.endNetWorth)
  })

  it('nợ thẻ 20 tr trên tổng tài sản', () => {
    const nw = netWorthAt(ledger, '2026-08-31')
    expect(nw.totalLiabilities).toBe(20_000_000)
    // VCB: 400 − 300 + 10 + 60 = 170 tr; chứng khoán 313.239.000
    expect(nw.totalAssets).toBe(170_000_000 + 313_239_000)
    expect(nw.netWorth).toBe(170_000_000 + 313_239_000 - 20_000_000)
  })
})

describe('trường hợp đặc biệt', () => {
  it('tài khoản thấu chi được tính sang nợ, net worth không đổi (E8/I7)', () => {
    const accounts = [makeAccount('bank', 'b', 'Thấu chi', 1_000_000, '2026-08-01')]
    const ledger = createLedger({ accounts, transactions: [adjustment('2026-08-02', 3_000_000, 'b', 'down')] })
    const nw = netWorthAt(ledger, '2026-08-02')
    expect(nw).toMatchObject({ totalAssets: 0, totalLiabilities: 2_000_000, netWorth: -2_000_000, liquidAssets: 0 })
    expect(nw.byAccount.b).toBe(-2_000_000)
  })

  it('account không tính vào net worth: chuyển tiền sang đó là "chuyển ra ngoài"', () => {
    const accounts = [
      makeAccount('bank', 'a', 'A', 10_000_000, '2026-08-01'),
      makeAccount('bank', 'x', 'Quỹ chung gia đình', 0, '2026-08-01', { includeInNetWorth: false }),
    ]
    const ledger = createLedger({ accounts, transactions: [transfer('2026-08-05', 4_000_000, 'a', 'x')] })
    const c = explainNetWorthChange(ledger, '2026-08-02', '2026-08-31')
    expect(c.externalTransfer).toBe(-4_000_000)
    expect(c.endNetWorth).toBe(6_000_000)
  })

  it('account đã lưu trữ không còn tính từ sau ngày lưu trữ (E12)', () => {
    const accounts = [makeAccount('cash', 'c', 'Ví cũ', 500_000, '2026-08-01', { archivedAt: '2026-08-20T10:00:00.000Z' })]
    const ledger = createLedger({ accounts, transactions: [] })
    expect(netWorthAt(ledger, '2026-08-19').netWorth).toBe(500_000)
    expect(netWorthAt(ledger, '2026-08-20').netWorth).toBe(0)
  })

  it('tài sản khác lấy định giá gần nhất', () => {
    const house = makeAccount('other_asset', 'h', 'Căn hộ', 3_000_000_000, '2026-01-01')
    const ledger = createLedger({
      accounts: [house],
      transactions: [],
      valuations: [
        { id: 'v1', accountId: 'h', date: '2026-07-01', value: 3_200_000_000, note: null, createdAt: '2026-07-01T00:00:00Z' },
      ],
    })
    expect(ledger.valueOf(house, '2026-06-30')).toBe(3_000_000_000)
    expect(ledger.valueOf(house, '2026-07-01')).toBe(3_200_000_000)
    expect(explainNetWorthChange(ledger, '2026-07-01', '2026-07-31').revaluation).toBe(200_000_000)
  })

  it('bán tài sản: định giá và chuyển tiền cùng ngày → giá trị về 0, net worth chuyển sang tài khoản nhận', () => {
    const house = makeAccount('other_asset', 'h', 'Căn hộ', 3_000_000_000, '2026-01-01')
    const bank = makeAccount('bank', 'b', 'VCB', 0, '2026-01-01')
    const ledger = createLedger({
      accounts: [house, bank],
      transactions: [transfer('2026-09-10', 3_300_000_000, 'h', 'b')],
      valuations: [{ id: 'v', accountId: 'h', date: '2026-09-10', value: 3_300_000_000, note: null, createdAt: '2026-09-10T00:00:00Z' }],
    })
    expect(ledger.valueOf(house, '2026-09-10')).toBe(0)
    expect(netWorthAt(ledger, '2026-09-10').netWorth).toBe(3_300_000_000)
    const c = explainNetWorthChange(ledger, '2026-09-01', '2026-09-30')
    expect(c.revaluation).toBe(300_000_000) // lãi khi bán
    expect(c.startNetWorth + sumOfChange(c)).toBe(c.endNetWorth)
  })
})
