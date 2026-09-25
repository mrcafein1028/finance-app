// W1 hoàn tác, W3 sửa/xóa, W4 đối soát, W16 lưu trữ/xóa, cảnh báo cần xác nhận — trên dữ liệu
// tháng 8 của Lan được nạp sẵn (docs/08 §2) để mỗi kịch bản bắt đầu từ trạng thái đã biết.
import { expect, test, type Page } from '@playwright/test'
import { lan } from '../../src/test/personas'
import type { FakeBackend } from './fake-backend'
import { accountRow, addTransaction, fillTransaction, login, seedData, startApp, goTo } from './helpers'

let backend: FakeBackend
let userId: string

test.beforeEach(async ({ page }) => {
  backend = await startApp(page)
  userId = await backend.createUser('lan@example.com', 'matkhau123')
  const p1 = lan()
  await seedData(backend, userId, { accounts: p1.accounts, categories: p1.categories, transactions: p1.transactions })
  await login(page, 'lan@example.com', 'matkhau123')
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible()
})

test.afterEach(async () => {
  await backend.close()
})

const txCount = async () => (await backend.rows(userId, 'select count(*)::int as n from public.transactions'))[0]!.n

async function openAccounts(page: Page) {
  await goTo(page, 'Tài khoản & quỹ')
  await expect(page.getByRole('heading', { level: 1, name: 'Tài khoản & quỹ' })).toBeVisible()
}

test('W1: lưu rồi bấm "Hoàn tác" → số dư trở lại như cũ', async ({ page }) => {
  await openAccounts(page)
  await expect(accountRow(page, 'Tiền mặt')).toContainText('1.400.000 ₫')
  await addTransaction(page, { amount: '50k', category: 'Ăn uống', account: 'Tiền mặt', date: '2026-08-31' })
  await expect(page.getByRole('status').filter({ hasText: 'Tiền mặt còn 1.350.000 ₫' })).toBeVisible()
  await expect(accountRow(page, 'Tiền mặt')).toContainText('1.350.000 ₫')
  await page.getByRole('button', { name: 'Hoàn tác' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Đã hoàn tác' })).toBeVisible()
  await expect(accountRow(page, 'Tiền mặt')).toContainText('1.400.000 ₫')
  expect(await txCount()).toBe(16)
})

test('W3: sửa số tiền, xóa rồi hoàn tác xóa', async ({ page }) => {
  await goTo(page, 'Giao dịch')
  await page.getByRole('button', { name: 'Nhà ở, Vietcombank' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sửa giao dịch' })
  await expect(dialog.getByLabel('Số tiền')).toHaveValue('5000000')
  await dialog.getByLabel('Số tiền').fill('5,5tr')
  await dialog.getByRole('button', { name: 'Lưu' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('dl')).toContainText('12.750.000 ₫') // chi tăng thêm 500.000

  await page.getByRole('button', { name: 'Nhà ở, Vietcombank' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Xóa' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận xóa' }).click()
  await expect(page.getByRole('button', { name: 'Nhà ở, Vietcombank' })).toHaveCount(0)
  expect(await txCount()).toBe(15)
  // Có thể còn thông báo "Đã lưu" của bước sửa — bấm đúng nút Hoàn tác của thông báo xóa.
  await page.getByRole('status').filter({ hasText: 'Đã xóa giao dịch' }).getByRole('button', { name: 'Hoàn tác' }).click()
  await expect(page.getByRole('button', { name: 'Nhà ở, Vietcombank' })).toBeVisible()
  expect(await txCount()).toBe(16)
})

test('cảnh báo cần xác nhận: thấu chi ngân hàng → "Vẫn lưu"', async ({ page }) => {
  const dialog = await fillTransaction(page, { amount: '30tr', category: 'Nhà ở', account: 'Vietcombank', date: '2026-08-31' })
  await expect(dialog.getByText('Số dư "Vietcombank" sẽ âm 2.050.000 ₫ (thấu chi)')).toBeVisible()
  expect(await txCount()).toBe(16)
  await dialog.getByRole('button', { name: 'Vẫn lưu' }).click()
  await expect(dialog).toBeHidden()
  expect(await txCount()).toBe(17)
  await openAccounts(page)
  await expect(accountRow(page, 'Vietcombank')).toContainText('−2.050.000 ₫')
})

test('W4: đối soát MoMo — thực tế 850k → ghi điều chỉnh giảm 50.000', async ({ page }) => {
  await openAccounts(page)
  await accountRow(page, 'MoMo').click()
  await expect(page.getByRole('heading', { level: 1, name: 'MoMo' })).toBeVisible()
  await page.getByRole('button', { name: 'Đối soát số dư' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Số dư thực tế').fill('850k')
  await expect(dialog.getByText('App đang thừa 50.000 ₫ so với thực tế')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cập nhật' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('main').getByText('850.000 ₫').first()).toBeVisible()
  const [adj] = await backend.rows(userId, `select type, direction, amount from public.transactions where type = 'adjustment'`)
  expect(adj).toEqual({ type: 'adjustment', direction: 'down', amount: 50_000 })
})

test('W16: lưu trữ tài khoản có giao dịch; xóa được tài khoản chưa có giao dịch', async ({ page }) => {
  await openAccounts(page)
  // Tài khoản có giao dịch: Xóa… báo trước sẽ mất những gì (nên Lưu trữ thay vì xóa).
  await accountRow(page, 'MoMo').click()
  await page.getByRole('button', { name: 'Xóa…' }).click()
  const del = page.getByRole('dialog', { name: 'Xóa "MoMo"' })
  await expect(del.getByRole('list', { name: 'Dữ liệu sẽ bị xóa' })).toContainText('giao dịch')
  await del.getByRole('button', { name: 'Hủy' }).click()
  await page.getByRole('button', { name: 'Lưu trữ' }).click()
  await expect(page.getByText('Tài khoản còn 900.000 ₫')).toBeVisible()
  await page.getByRole('button', { name: 'Xác nhận lưu trữ' }).click()
  await expect(page.getByText('Ví điện tử · đã lưu trữ')).toBeVisible()

  await openAccounts(page)
  await expect(accountRow(page, 'MoMo')).toHaveCount(0)
  await page.getByRole('button', { name: /Hiện 1 tài khoản đã lưu trữ/ }).click()
  await expect(accountRow(page, 'MoMo')).toBeVisible()

  // Tài khoản mới chưa có giao dịch → xóa hẳn.
  await page.getByRole('button', { name: 'Thêm tài khoản' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Tên').fill('Ví phụ')
  await dialog.getByLabel('Số dư hiện tại').fill('0')
  await dialog.getByRole('button', { name: 'Lưu' }).click()
  await accountRow(page, 'Ví phụ').click()
  await page.getByRole('button', { name: 'Xóa…' }).click()
  await expect(page.getByRole('dialog')).toContainText('chưa có dữ liệu nào khác')
  await page.getByRole('dialog').getByRole('button', { name: 'Xóa vĩnh viễn' }).click()
  await expect(page).toHaveURL(/\/accounts$/)
  await expect(accountRow(page, 'Ví phụ')).toHaveCount(0)
})

test('tên tài khoản trùng → báo lỗi rõ ràng từ cơ sở dữ liệu', async ({ page }) => {
  await openAccounts(page)
  await page.getByRole('button', { name: 'Thêm tài khoản' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Tên').fill('momo')
  await dialog.getByLabel('Số dư hiện tại').fill('1k')
  await dialog.getByRole('button', { name: 'Lưu' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Đã có tài khoản cùng tên')
})

test('quỹ mục tiêu: góp tiền từ trang quỹ, tiến độ và số cần góp mỗi tháng', async ({ page }) => {
  await openAccounts(page)
  await accountRow(page, 'Quỹ khẩn cấp').click()
  await expect(page.getByText('Mục tiêu 60.000.000 ₫')).toBeVisible()
  await expect(page.getByText('22%')).toBeVisible()
  await page.getByRole('button', { name: 'Góp vào quỹ' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('radio', { name: 'Chuyển' })).toHaveAttribute('aria-checked', 'true')
  await dialog.getByLabel('Số tiền').fill('17tr')
  const from = dialog.getByLabel('Từ tài khoản')
  await from.selectOption(await from.locator('option', { hasText: 'Vietcombank' }).getAttribute('value'))
  await dialog.getByRole('button', { name: 'Lưu' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('50%')).toBeVisible() // 30 tr / 60 tr
})
