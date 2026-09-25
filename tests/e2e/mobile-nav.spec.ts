// Menu ☰ trên điện thoại: mở / đóng bằng mọi cách, nhóm trang, tiêu đề theo trang, khóa cuộn, bàn phím.
import { expect, test } from '@playwright/test'
import type { FakeBackend } from './fake-backend'
import { login, startApp } from './helpers'

let backend: FakeBackend

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Menu ☰ chỉ có trên điện thoại')
  backend = await startApp(page)
  await backend.createUser('lan@example.com', 'matkhau123', { onboarded: true })
  await login(page, 'lan@example.com', 'matkhau123')
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible()
})

test.afterEach(async () => {
  await backend?.close()
})

test('mở menu → thấy 3 nhóm + Cài đặt + tài khoản; chọn trang → chuyển trang, menu đóng, tiêu đề đổi', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'Mở menu' })
  const menu = page.getByRole('navigation', { name: 'Menu điều hướng' })
  await expect(page.locator('header').getByText('Tổng quan')).toBeVisible()
  await expect(menu).toBeHidden()
  await expect(page.getByRole('navigation', { name: 'Điều hướng nhanh' })).toHaveCount(0) // thanh dưới đã bỏ

  await toggle.click()
  const close = page.getByRole('button', { name: 'Đóng menu' })
  await expect(close).toHaveAttribute('aria-expanded', 'true')
  await expect(menu).toBeVisible()
  for (const group of ['Hằng ngày', 'Tài sản & nợ', 'Phân tích']) await expect(menu.getByRole('heading', { name: group })).toBeVisible()
  await expect(menu.getByRole('link')).toHaveText(['Tổng quan', 'Ngân sách', 'Giao dịch', 'Tài khoản & quỹ', 'Tiết kiệm', 'Đầu tư', 'Khoản nợ', 'Báo cáo', 'Mô phỏng', 'Cài đặt'])
  await expect(menu.getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('lan@example.com').filter({ visible: true })).toBeVisible()
  expect(await page.evaluate('document.body.style.overflow')).toBe('hidden') // trang phía sau không cuộn

  await menu.getByRole('link', { name: 'Khoản nợ' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Khoản nợ' })).toBeVisible()
  await expect(menu).toBeHidden()
  await expect(page.getByRole('button', { name: 'Mở menu' })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('header').getByText('Khoản nợ')).toBeVisible()
  expect(await page.evaluate('document.body.style.overflow')).toBe('')
})

test('đóng bằng nút ✕, bấm nền tối, phím Esc; bấm lại trang đang mở cũng đóng', async ({ page }) => {
  const menu = page.getByRole('navigation', { name: 'Menu điều hướng' })
  const open = () => page.getByRole('button', { name: 'Mở menu' }).click()

  await open()
  await page.getByRole('button', { name: 'Đóng menu' }).click()
  await expect(menu).toBeHidden()

  await open()
  await page.mouse.click(370, 500) // vùng nền tối bên phải ngăn menu
  await expect(menu).toBeHidden()

  await open()
  await expect(menu.getByRole('link', { name: 'Tổng quan' })).toBeFocused() // con trỏ bàn phím vào menu
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(page.getByRole('button', { name: 'Mở menu' })).toBeFocused() // trả về nút ☰

  await open()
  await menu.getByRole('link', { name: 'Tổng quan' }).click()
  await expect(menu).toBeHidden()
})

test('trang con giữ đúng tiêu đề; nút ＋ vẫn dùng được và không bị che', async ({ page }) => {
  await page.goto('/transactions/recurring')
  await expect(page.locator('header').getByText('Giao dịch')).toBeVisible()
  await page.getByRole('button', { name: 'Thêm giao dịch nhanh' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
