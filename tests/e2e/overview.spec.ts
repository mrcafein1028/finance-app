// Giai đoạn 6 — Tổng quan (D1–D6), Báo cáo (R1–R14), Mô phỏng what-if, trên dữ liệu persona.
import { expect, test } from '@playwright/test'
import { hung, lan } from '../../src/test/personas'
import type { FakeBackend } from './fake-backend'
import { login, seedData, startApp, goTo } from './helpers'

let backend: FakeBackend

test.afterEach(async () => {
  await backend.close()
})

test('Tổng quan của Lan sau tháng 8: net worth, chỉ số sức khỏe, insight, ẩn insight', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  backend = await startApp(page, { today: new Date('2026-09-10T10:00:00+07:00') })
  const userId = await backend.createUser('lan@example.com', 'matkhau123')
  const p1 = lan()
  await seedData(backend, userId, { accounts: p1.accounts, categories: p1.categories, transactions: p1.transactions })
  await login(page, 'lan@example.com', 'matkhau123')

  await expect(page.getByText('Net worth (tài sản − nợ)')).toBeVisible()
  await expect(page.getByText('43.250.000 ₫').first()).toBeVisible()
  const tiles = page.getByLabel('Chỉ số sức khỏe tài chính')
  await expect(tiles).toContainText('31,9%') // tỉ lệ tiết kiệm tháng 8
  await expect(tiles).toContainText('✓ Tốt')
  await expect(tiles).toContainText('1,3 tháng') // quỹ khẩn cấp
  await expect(tiles).toContainText('! Cần chú ý')

  const insights = page.getByRole('list', { name: 'Insight' })
  const emerg = insights.getByRole('listitem').filter({ hasText: 'Quỹ khẩn cấp đủ cho 1,3 tháng' })
  await expect(emerg).toBeVisible()
  await expect(insights).toContainText('tiết kiệm 32% thu nhập tháng 08/2026')
  await emerg.getByRole('button', { name: /^Ẩn/ }).click()
  await expect(emerg).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Net worth (tài sản − nợ)')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Insight' }).getByText('Quỹ khẩn cấp đủ cho')).toHaveCount(0) // ẩn cả khi mở lại
  expect(errors).toEqual([])
})

test('Báo cáo: mọi biểu đồ hiện, bảng số liệu khớp docs/08', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  backend = await startApp(page, { today: new Date('2026-09-10T10:00:00+07:00') })
  const userId = await backend.createUser('lan@example.com', 'matkhau123')
  const p1 = lan()
  await seedData(backend, userId, { accounts: p1.accounts, categories: p1.categories, transactions: p1.transactions, budgetMonths: [p1.augustBudget], budgetLines: p1.augustLines })
  await login(page, 'lan@example.com', 'matkhau123')
  await goTo(page, 'Báo cáo')

  const nw = page.getByRole('region', { name: 'Net worth theo thời gian' })
  await expect(nw.locator('svg.recharts-surface')).toBeVisible()
  await nw.getByRole('button', { name: 'Xem bảng số liệu' }).click()
  await expect(nw.getByRole('row', { name: /08\/2026/ })).toContainText('43.250.000 ₫')

  const waterfall = page.getByRole('region', { name: 'Vì sao net worth thay đổi?' })
  await expect(waterfall).toContainText('bắt đầu 0 ₫ (+37.500.000 ₫ số dư ban đầu của tài khoản mới) → kết thúc 43.250.000 ₫')
  await waterfall.getByRole('button', { name: 'Xem bảng số liệu' }).click()
  await expect(waterfall.getByRole('row', { name: /Thu nhập/ })).toContainText('+18.000.000 ₫')
  await expect(waterfall.getByRole('row', { name: /Chi tiêu/ })).toContainText('−12.250.000 ₫')

  const plan = page.getByRole('region', { name: 'Kế hoạch vs thực tế' })
  await plan.getByRole('button', { name: 'Xem bảng số liệu' }).click()
  await expect(plan.getByRole('row', { name: /Ăn uống/ })).toContainText('3.850.000 ₫')

  const split = page.getByRole('region', { name: 'Thu nhập đi đâu?' })
  await expect(split).toContainText('56,4%')
  await expect(split).toContainText('11,7%')
  await expect(split).toContainText('31,9%')

  await expect(page.getByRole('region', { name: 'Chi tiêu theo ngày' })).toContainText('15')
  await expect(page.getByRole('region', { name: 'Phân bổ tài sản' }).locator('svg.recharts-surface')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Tiến độ quỹ mục tiêu' })).toContainText('22%')
  expect(errors).toEqual([])
})

test('Mô phỏng: trả nợ thêm → hết nợ sớm hơn, tiết kiệm lãi', async ({ page }) => {
  backend = await startApp(page, { today: new Date('2026-09-01T10:00:00+07:00') })
  const userId = await backend.createUser('hung@example.com', 'matkhau123')
  const p2 = hung()
  await seedData(backend, userId, { accounts: p2.accounts.filter((a) => a.id !== 'td'), categories: p2.categories })
  await login(page, 'hung@example.com', 'matkhau123')
  await goTo(page, 'Mô phỏng')
  await page.getByLabel('Dự phóng trong').selectOption({ label: '10 năm' })
  const debtFree = page.locator('dd').filter({ hasText: 'Kịch bản:' })
  await expect(debtFree).toContainText('sau 10 năm')
  await page.getByLabel('Trả nợ thêm mỗi tháng').fill('20tr')
  await expect(debtFree).not.toContainText('sau 10 năm')
  await expect(page.getByText(/Tiết kiệm lãi/)).toBeVisible()
  const chart = page.getByRole('region', { name: 'Net worth dự phóng' })
  await expect(chart.locator('svg.recharts-surface')).toBeVisible()
})
