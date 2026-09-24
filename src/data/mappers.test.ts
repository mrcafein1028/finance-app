import { describe, expect, it } from 'vitest'
import { datetimeSchema, TABLE_NAMES } from '../schemas'
import { ConflictError, DatabaseError, ForbiddenError, fromDbError, AuthRequiredError, ValidationError } from './errors'
import { fromRow, sqlTable, toRow } from './mappers'

describe('camelCase ↔ snake_case', () => {
  it('chỉ đổi khóa cấp ngoài, giữ nguyên nội dung jsonb', () => {
    const record = { openingBalance: 1, isEmergencyFund: false, details: { payoutAccountId: 'x', earlyWithdrawalRate: 0.001 } }
    const row = toRow(record)
    expect(row).toEqual({ opening_balance: 1, is_emergency_fund: false, details: { payoutAccountId: 'x', earlyWithdrawalRate: 0.001 } })
    expect(fromRow(row)).toEqual(record)
  })

  it('tên bảng Postgres', () => {
    expect(TABLE_NAMES.map(sqlTable)).toContain('net_worth_snapshots')
    expect(sqlTable('investmentTrades')).toBe('investment_trades')
  })
})

describe('định dạng thời gian của Postgres', () => {
  it('chấp nhận timestamptz dạng PostgREST trả về (micro giây, +00:00)', () => {
    expect(datetimeSchema.safeParse('2026-09-24T10:00:00.123456+00:00').success).toBe(true)
    expect(datetimeSchema.safeParse('2026-09-24T10:00:00Z').success).toBe(true)
  })
})

describe('fromDbError', () => {
  it.each([
    [{ code: '23505', message: 'duplicate key value violates unique constraint "accounts_active_name_key"' }, ConflictError, 'Đã có tài khoản cùng tên'],
    [{ code: '23503', message: 'update or delete on table "accounts" violates foreign key constraint "x"' }, ConflictError, 'đang được sử dụng'],
    [{ code: '23503', message: 'insert or update on table "transactions" violates foreign key constraint "x"' }, ValidationError, 'không tồn tại'],
    [{ code: 'P0001', message: 'Không thể ghi thu nhập vào khoản nợ' }, ValidationError, 'Không thể ghi thu nhập vào khoản nợ'],
    [{ code: '42501', message: 'new row violates row-level security policy for table "accounts"' }, ForbiddenError, 'không có quyền'],
    [{ code: '42501', message: 'permission denied for table accounts' }, AuthRequiredError, 'đăng nhập'],
    [{ code: '08006', message: 'connection failure' }, DatabaseError, 'connection failure'],
  ])('%o', (error, type, message) => {
    const mapped = fromDbError(error)
    expect(mapped).toBeInstanceOf(type)
    expect(mapped.message).toContain(message)
  })
})
