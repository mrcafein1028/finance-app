import type { TableName } from '../schemas'

// Code dùng camelCase, Postgres dùng snake_case. Chỉ đổi khóa CẤP NGOÀI CÙNG:
// cột jsonb (details, target, template, goal, byKind…) giữ nguyên camelCase bên trong.

export const toSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
export const toCamel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())

export type Row = Record<string, unknown>

export function toRow(record: object): Row {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [toSnake(k), v]))
}

export function fromRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v]))
}

/** Tên bảng Postgres: investmentTrades → investment_trades. */
export const sqlTable = (name: TableName) => toSnake(name)
