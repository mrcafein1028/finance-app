import { describe, expect, it } from 'vitest'
import {
  accountSchema,
  backupFileSchema,
  budgetLineSchema,
  categorySchema,
  isoDateSchema,
  moneySchema,
  transactionSchema,
} from './index'
import { cashAccount, expenseCategory, expenseTx, loanAccount, transferTx } from '../test/factories'

const meta = { id: 'x', createdAt: '2026-09-24T10:00:00.000Z', updatedAt: '2026-09-24T10:00:00.000Z' }

describe('kiểu cơ bản', () => {
  it('tiền phải là số nguyên đồng không âm', () => {
    expect(moneySchema.safeParse(1_234_567).success).toBe(true)
    expect(moneySchema.safeParse(0).success).toBe(true)
    expect(moneySchema.safeParse(1.5).success).toBe(false)
    expect(moneySchema.safeParse(-1).success).toBe(false)
    expect(moneySchema.safeParse(1e18).success).toBe(false)
  })

  it('ngày phải tồn tại thật', () => {
    expect(isoDateSchema.safeParse('2028-02-29').success).toBe(true) // năm nhuận
    expect(isoDateSchema.safeParse('2026-02-29').success).toBe(false)
    expect(isoDateSchema.safeParse('2026-13-01').success).toBe(false)
    expect(isoDateSchema.safeParse('24/09/2026').success).toBe(false)
  })
})

describe('account', () => {
  it('chấp nhận tài khoản ngân hàng và khoản vay hợp lệ', () => {
    expect(accountSchema.safeParse({ ...cashAccount(), ...meta }).success).toBe(true)
    expect(accountSchema.safeParse({ ...loanAccount(), ...meta }).success).toBe(true)
  })

  it('class phải khớp kind', () => {
    expect(accountSchema.safeParse({ ...cashAccount(), class: 'liability', ...meta }).success).toBe(false)
  })

  it('khoản nợ không được là quỹ khẩn cấp hay có mục tiêu tích lũy', () => {
    expect(accountSchema.safeParse({ ...loanAccount(), isEmergencyFund: true, ...meta }).success).toBe(false)
    expect(
      accountSchema.safeParse({ ...loanAccount(), goal: { targetAmount: 1, targetDate: null }, ...meta }).success,
    ).toBe(false)
  })

  it('mức lãi đầu tiên phải bắt đầu từ ngày giải ngân và các mốc tăng dần', () => {
    const base = loanAccount()
    const details = base.kind === 'loan' ? base.details : null
    const bad = {
      ...base,
      ...meta,
      details: {
        ...details,
        ratePeriods: [
          { from: '2026-08-01', annualRate: 0.07 },
          { from: '2026-08-01', annualRate: 0.11 },
        ],
      },
    }
    const result = accountSchema.safeParse(bad)
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.message)).toContain('Các mốc lãi suất phải tăng dần theo ngày')
  })
})

describe('transaction', () => {
  it('chi tiêu bắt buộc có danh mục', () => {
    expect(transactionSchema.safeParse({ ...expenseTx(), ...meta }).success).toBe(true)
    expect(transactionSchema.safeParse({ ...expenseTx(), categoryId: null, ...meta }).success).toBe(false)
  })

  it('chuyển khoản không có danh mục và không chuyển cho chính mình', () => {
    expect(transactionSchema.safeParse({ ...transferTx(), ...meta }).success).toBe(true)
    expect(transactionSchema.safeParse({ ...transferTx(), categoryId: 'c', ...meta }).success).toBe(false)
    expect(transactionSchema.safeParse({ ...transferTx(), toAccountId: 'acc-1', ...meta }).success).toBe(false)
  })

  it('số tiền phải > 0', () => {
    expect(transactionSchema.safeParse({ ...expenseTx(), amount: 0, ...meta }).success).toBe(false)
  })
})

describe('category & budget', () => {
  it('danh mục thu không có nhóm 50/30/20', () => {
    expect(categorySchema.safeParse({ ...expenseCategory(), type: 'income', ...meta }).success).toBe(false)
  })

  it('targetKey của dòng ngân sách phải khớp target', () => {
    const line = {
      ...meta,
      month: '2026-08',
      target: { kind: 'category', categoryId: 'c1' },
      planned: 3_500_000,
      rollover: true,
    }
    expect(budgetLineSchema.safeParse({ ...line, targetKey: 'c:c1' }).success).toBe(true)
    expect(budgetLineSchema.safeParse({ ...line, targetKey: 'a:c1' }).success).toBe(false)
  })
})

describe('file sao lưu', () => {
  it('từ chối file từ phiên bản mới hơn với thông báo rõ ràng', () => {
    const result = backupFileSchema.safeParse({
      app: 'tai-chinh-ca-nhan',
      schemaVersion: 99,
      exportedAt: '2026-09-24T10:00:00.000Z',
      data: {},
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.message).join()).toContain('phiên bản mới hơn')
  })
})
