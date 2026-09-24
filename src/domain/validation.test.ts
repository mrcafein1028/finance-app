import { describe, expect, it } from 'vitest'
import { expense, income, lan, makeAccount, transfer } from '../test/personas'
import { checkTransaction, describeTransfer, minBalanceFrom, type TransactionCheckContext } from './validation'

const p1 = lan()
const loan = makeAccount('loan', 'loan', 'Vay xe', 10_000_000, '2026-08-01', {
  details: {
    lender: null, originalPrincipal: 10_000_000, rateType: 'zero', ratePeriods: [{ from: '2026-08-01', annualRate: 0 }],
    termMonths: 10, startDate: '2026-08-01', paymentDay: 5, prepaymentFeeRate: 0, interestCategoryId: 'x',
  },
})
const card = makeAccount('credit_card', 'card', 'Thẻ', 4_000_000, '2026-08-01', {
  details: { issuer: null, creditLimit: 5_000_000, statementDay: 20, dueDay: 5, annualRate: 0.3, minPaymentRate: 0.05 },
})
const accounts = [...p1.accounts, loan, card]

const ctx = (over: Partial<TransactionCheckContext> = {}): TransactionCheckContext => ({
  accounts,
  categories: p1.categories,
  transactions: p1.transactions,
  today: '2026-08-31',
  now: new Date('2026-08-31T12:00:00Z'),
  ...over,
})
const food = p1.categoryId('Ăn uống')

describe('lỗi chặn lưu (docs/08 §2 "Tiếp tục tháng 9")', () => {
  it('chi 150.000 từ Tiền mặt ngày 31/07 → trước ngày bắt đầu theo dõi', () => {
    const r = checkTransaction(expense('2026-07-31', 150_000, 'cash', food), ctx())
    expect(r.errors).toEqual([{ path: 'date', message: 'Ngày phải từ 01/08/2026 (ngày bắt đầu theo dõi "Tiền mặt")' }])
  })

  it('rút 20.000.000 khỏi Tiền mặt (đang 1.400.000) → tiền mặt âm', () => {
    const r = checkTransaction(expense('2026-08-31', 20_000_000, 'cash', food), ctx())
    expect(r.errors).toEqual([{ path: 'accountId', message: 'Tiền mặt "Tiền mặt" sẽ bị âm 18.600.000 ₫' }])
  })

  it('chi tiền mặt ngày quá khứ làm âm một ngày giữa tháng cũng bị chặn', () => {
    // 08/08 tiền mặt còn 3.100.000 sau bữa 900.000; chi thêm 3.000.000 ngày 08/08 → 22/08 bị âm.
    const r = checkTransaction(expense('2026-08-08', 3_000_000, 'cash', food), ctx())
    expect(r.errors[0]?.message).toContain('sẽ bị âm')
  })

  it('trả nợ vượt dư nợ → báo số tối đa (I6)', () => {
    const r = checkTransaction(transfer('2026-08-10', 12_000_000, 'vcb', 'loan'), ctx())
    expect(r.errors).toEqual([{ path: 'amount', message: 'Vượt dư nợ của "Vay xe" — tối đa 10.000.000 ₫' }])
    expect(checkTransaction(transfer('2026-08-10', 10_000_000, 'vcb', 'loan'), ctx()).errors).toEqual([])
  })

  it('thu nhập vào khoản nợ, danh mục nhóm cha, danh mục sai loại', () => {
    expect(checkTransaction(income('2026-08-10', 1, 'loan', p1.categoryId('Lương')), ctx()).errors[0]?.message).toBe('Không thể ghi thu nhập vào khoản nợ')
    expect(checkTransaction(expense('2026-08-10', 1, 'vcb', p1.categoryId('Tài chính')), ctx()).errors[0]?.message).toBe('Hãy chọn danh mục con thay vì nhóm "Tài chính"')
    expect(checkTransaction(expense('2026-08-10', 1, 'vcb', p1.categoryId('Lương')), ctx()).errors[0]?.message).toBe('Hãy chọn danh mục chi')
  })

  it('tài khoản đã lưu trữ không nhận giao dịch mới', () => {
    const archived = accounts.map((a) => (a.id === 'momo' ? { ...a, archivedAt: '2026-08-25T00:00:00Z' } : a))
    expect(checkTransaction(expense('2026-08-26', 1, 'momo', food), ctx({ accounts: archived })).errors[0]?.message).toBe('Tài khoản "MoMo" đã lưu trữ')
  })
})

describe('cảnh báo cần xác nhận', () => {
  const codes = (tx: ReturnType<typeof expense>, over: Partial<TransactionCheckContext> = {}) =>
    checkTransaction(tx, ctx(over)).warnings.map((w) => w.code)

  it('ngân hàng âm → thấu chi (cho lưu nếu xác nhận)', () => {
    const r = checkTransaction(expense('2026-08-31', 30_000_000, 'vcb', p1.categoryId('Nhà ở')), ctx())
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([{ code: 'overdraft', message: 'Số dư "Vietcombank" sẽ âm 2.050.000 ₫ (thấu chi)', confirm: true }])
  })

  it('vượt hạn mức thẻ', () => {
    expect(codes(expense('2026-08-20', 2_000_000, 'card', food))).toEqual(['over_limit'])
  })

  it('số tiền lớn bất thường (> 10 lần mức thường chi)', () => {
    // Trung bình 4 lần chi Ăn uống = 962.500 → ngưỡng 9.625.000
    expect(codes(expense('2026-08-31', 9_700_000, 'vcb', food))).toContain('large_amount')
    expect(codes(expense('2026-08-31', 9_600_000, 'vcb', food))).not.toContain('large_amount')
    expect(codes(expense('2026-08-31', 900_000, 'vcb', food))).not.toContain('large_amount')
  })

  it('trùng giao dịch vừa lưu trong 2 phút', () => {
    const just = { ...expense('2026-08-31', 50_000, 'vcb', food), createdAt: '2026-08-31T11:59:30Z' }
    expect(codes(expense('2026-08-31', 50_000, 'vcb', food), { transactions: [...p1.transactions, just] })).toContain('duplicate')
    expect(codes(expense('2026-08-31', 50_000, 'vcb', food))).not.toContain('duplicate')
  })

  it('tháng đã đóng cần xác nhận; ngày tương lai chỉ để hiển thị', () => {
    const r = checkTransaction(expense('2026-08-10', 1_000, 'vcb', food), ctx({ closedMonths: new Set(['2026-08']) }))
    expect(r.warnings).toEqual([{ code: 'closed_month', message: 'Tháng 08/2026 đã đóng — lưu sẽ mở lại số liệu của tháng này', confirm: true }])
    const future = checkTransaction(expense('2026-09-05', 1_000, 'vcb', food), ctx())
    expect(future.warnings).toEqual([{ code: 'future', message: 'Giao dịch dự kiến — chưa tính vào số dư hôm nay', confirm: false }])
  })
})

describe('sửa giao dịch', () => {
  it('sửa số tiền: tính lại số dư không kèm bản cũ', () => {
    const original = p1.transactions.find((t) => t.accountId === 'cash' && t.amount === 900_000)!
    const edited = { ...original, amount: 2_000_000 }
    expect(checkTransaction(edited, ctx({ editing: original })).errors).toEqual([])
    const tooMuch = { ...original, amount: 4_000_000 }
    expect(checkTransaction(tooMuch, ctx({ editing: original })).errors[0]?.message).toContain('sẽ bị âm')
  })

  it('không báo trùng khi sửa chính nó', () => {
    const t = { ...expense('2026-08-31', 50_000, 'vcb', food), createdAt: '2026-08-31T11:59:30Z' }
    expect(checkTransaction({ ...t, note: 'sửa' }, ctx({ transactions: [...p1.transactions, t], editing: t })).warnings).toEqual([])
  })
})

describe('tiện ích', () => {
  it('số dư thấp nhất từ một ngày', () => {
    const cash = p1.accounts.find((a) => a.id === 'cash')!
    expect(minBalanceFrom(cash, p1.transactions, '2026-08-01')).toBe(1_400_000)
    expect(minBalanceFrom(cash, [], '2026-08-01')).toBe(2_000_000)
  })

  it('mô tả chuyển khoản theo ý nghĩa (W2)', () => {
    const [vcb, , momo, fund] = p1.accounts
    expect(describeTransfer(vcb, momo)).toBe('Chuyển tiền')
    expect(describeTransfer(vcb, fund)).toBe('Tiết kiệm vào Quỹ khẩn cấp')
    expect(describeTransfer(fund, vcb)).toBe('Rút từ Quỹ khẩn cấp')
    expect(describeTransfer(vcb, loan)).toBe('Trả nợ Vay xe')
    expect(describeTransfer(loan, vcb)).toBe('Giải ngân Vay xe')
  })
})
