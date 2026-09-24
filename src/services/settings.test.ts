import { describe, expect, it } from 'vitest'
import { buildDemoBackup } from '../data/demo'
import { ValidationError } from '../data/errors'
import { lan } from '../test/personas'
import { mergeTargets, readBackupText, summarizeBackup, transactionsCsv } from './settings'

describe('CSV giao dịch', () => {
  it('có BOM, dấu theo chiều tiền, thoát dấu phẩy/ngoặc kép', () => {
    const p = lan()
    const accountById = new Map(p.accounts.map((a) => [a.id, a]))
    const categoryById = new Map(p.categories.map((c) => [c.id, c]))
    const tx = { ...p.transactions.find((t) => t.type === 'expense')!, note: 'Ăn "bún", chả' }
    const csv = transactionsCsv([tx], accountById, categoryById)
    expect(csv.startsWith('﻿Ngày,Loại,')).toBe(true)
    const row = csv.split('\r\n')[1]!
    expect(row).toContain(`,-${tx.amount},`)
    expect(row).toContain('"Ăn ""bún"", chả"')
  })
})

describe('gộp danh mục', () => {
  it('chỉ gợi ý danh mục lá cùng loại, không phải chính nó', () => {
    const cats = lan().categories
    const from = cats.find((c) => c.name === 'Giải trí')!
    const targets = mergeTargets(cats, from)
    expect(targets.every((c) => c.type === 'expense' && c.id !== from.id)).toBe(true)
    expect(targets.map((c) => c.name)).not.toContain('Tài chính') // nhóm cha
    expect(targets.map((c) => c.name)).toContain('Mua sắm')
  })
})

describe('dữ liệu demo & file sao lưu', () => {
  it('dời mọi ngày để tháng chính của persona là tháng vừa qua; đọc lại được như file sao lưu', () => {
    const backup = buildDemoBackup('lan', '2027-01-20')
    const months = backup.data.budgetMonths.map((m) => m.month).sort()
    expect(months).toEqual(['2026-12', '2027-01'])
    const dates = backup.data.transactions.map((t) => t.date)
    expect(dates.filter((d) => d <= '2026-12-31')).toHaveLength(lan().transactions.length) // tháng chính = tháng 12
    expect(dates.every((d) => d >= '2026-12-01' && d <= '2027-01-20')).toBe(true) // + tháng này đến hôm nay
    expect(backup.data.settings[0]!.onboardingCompleted).toBe(true)
    const again = readBackupText(JSON.stringify(backup))
    expect(summarizeBackup(again).find((r) => r.table === 'transactions')!.count).toBe(dates.length)
  })

  it('file không phải JSON / không phải của app → ValidationError', () => {
    expect(() => readBackupText('{')).toThrow(ValidationError)
    expect(() => readBackupText('{"app":"khac"}')).toThrow('Không phải file sao lưu của ứng dụng này')
  })
})
