// Sửa thông tin đã nhập sai / xóa hẳn tài khoản — mọi loại tài khoản (Quản lý: Sửa thông tin · Lưu trữ · Xóa…).
import { expect, test, type Page } from '@playwright/test'
import { toReplacePayload } from '../../src/data/backup'
import { buildDemoBackup, type DemoPersona } from '../../src/data/demo'
import type { FakeBackend } from './fake-backend'
import { accountRow, goTo, login, startApp } from './helpers'

let backend: FakeBackend
let userId: string

async function setup(page: Page, persona: DemoPersona) {
  backend = await startApp(page, { today: new Date('2026-09-25T10:00:00+07:00') })
  userId = await backend.createUser('x@example.com', 'matkhau123')
  await backend.asUser(userId, (tx) => tx.query('select public.replace_all_data($1::jsonb)', [JSON.stringify(toReplacePayload(buildDemoBackup(persona, '2026-09-25')))]))
  await login(page, 'x@example.com', 'matkhau123')
  await expect(page.getByText('Net worth (tài sản − nợ)')).toBeVisible()
}

test.afterEach(async () => {
  await backend.close()
})

test('thẻ tín dụng: sửa hạn mức và dư nợ lúc bắt đầu → số liệu trên trang cập nhật', async ({ page }) => {
  await setup(page, 'mai')
  await goTo(page, 'Khoản nợ')
  await page.getByRole('main').getByRole('link').filter({ hasText: 'Thẻ tín dụng' }).first().click()
  await page.getByRole('button', { name: 'Sửa thông tin' }).click()
  const d = page.getByRole('dialog', { name: 'Sửa thẻ tín dụng' })
  await expect(d.getByLabel('Hạn mức')).toHaveValue('50000000')
  await d.getByLabel('Hạn mức').fill('40tr')
  await d.getByLabel('Dư nợ lúc bắt đầu theo dõi').fill('18tr')
  await d.getByLabel('Ngày sao kê').selectOption({ label: 'Ngày 25' })
  await d.getByRole('button', { name: 'Lưu' }).click()
  await expect(d).toBeHidden()
  await expect(page.getByText('18.000.000 ₫').first()).toBeVisible()
  await expect(page.getByText('40.000.000 ₫')).toBeVisible()
  await expect(page.getByText('45%')).toBeVisible()
  await expect(page.getByText('Ngày 25 / ngày 5')).toBeVisible()
})

test('khoản vay: sửa dư nợ lúc bắt đầu và lãi suất; dư nợ quá thấp so với số đã trả → bị chặn', async ({ page }) => {
  await setup(page, 'hung')
  await goTo(page, 'Khoản nợ')
  await page.getByRole('link', { name: /Vay mua nhà/ }).click()
  await page.getByRole('button', { name: 'Sửa thông tin' }).click()
  const d = page.getByRole('dialog', { name: 'Sửa khoản vay' })
  await expect(d.getByLabel('Dư nợ lúc bắt đầu theo dõi')).toHaveValue('1200000000')

  // Đã trả gốc 5 triệu sau ngày bắt đầu → dư nợ ban đầu 4 triệu là vô lý.
  await d.getByLabel('Dư nợ lúc bắt đầu theo dõi').fill('4tr')
  await d.getByRole('button', { name: 'Lưu' }).click()
  await expect(d.getByRole('alert')).toContainText('các khoản đã trả sau đó vượt dư nợ')

  await d.getByLabel('Dư nợ lúc bắt đầu theo dõi').fill('1,1ty')
  await d.getByLabel('Lãi suất lúc giải ngân (%/năm)').fill('8,5')
  await d.getByRole('button', { name: 'Lưu' }).click()
  await expect(d).toBeHidden()
  await expect(page.getByText('1.095.000.000 ₫').first()).toBeVisible() // 1,1 tỷ − 5 triệu gốc đã trả
  await expect(page.getByText('8,5%/năm')).toBeVisible()
})

test('sổ tiết kiệm chưa phát sinh lãi: sửa số tiền gửi → giao dịch chuyển tiền mở sổ sửa theo', async ({ page }) => {
  await setup(page, 'hung')
  await goTo(page, 'Tiết kiệm')
  await page.getByRole('link').filter({ hasText: 'Sổ ABC' }).first().click()
  await page.getByRole('button', { name: 'Sửa thông tin' }).click()
  const d = page.getByRole('dialog', { name: 'Sửa sổ tiết kiệm' })
  await d.getByLabel('Số tiền gửi').fill('120tr')
  await d.getByRole('button', { name: 'Lưu' }).click()
  await expect(d).toBeHidden()
  await expect(page.getByText('120.000.000 ₫').first()).toBeVisible()
  // Giao dịch chuyển tiền mở sổ (Vietcombank → sổ) được sửa theo.
  const [open] = await backend.rows(userId, `select t.amount from public.transactions t join public.accounts a on a.id = t.to_account_id where a.kind = 'term_deposit'`)
  expect(open).toEqual({ amount: 120_000_000 })
})

test('xóa khoản vay kèm dữ liệu: xem trước, phải tích xác nhận, xóa cả nhóm trả nợ', async ({ page }) => {
  await setup(page, 'hung')
  await goTo(page, 'Khoản nợ')
  await page.getByRole('link', { name: /Vay mua nhà/ }).click()
  await page.getByRole('button', { name: 'Xóa…' }).click()
  const d = page.getByRole('dialog', { name: 'Xóa "Vay mua nhà"' })
  await expect(d.getByRole('list', { name: 'Dữ liệu sẽ bị xóa' })).toContainText('2 giao dịch')
  await d.getByRole('button', { name: 'Xóa vĩnh viễn' }).click()
  await expect(d.getByRole('alert')).toContainText('Tích xác nhận')
  await d.getByLabel('Tôi hiểu, xóa vĩnh viễn tài khoản và dữ liệu trên').check()
  await d.getByRole('button', { name: 'Xóa vĩnh viễn' }).click()
  await expect(page).toHaveURL(/\/liabilities$/)
  await expect(page.getByText('Không có khoản vay nào')).toBeVisible()
  expect(await backend.rows(userId, `select id from public.transactions where group_id is not null`)).toEqual([])
})

test('không xóa được ngân hàng đang nhận lãi sổ tiết kiệm; tiền mặt: số dư ban đầu làm âm quỹ → bị chặn', async ({ page }) => {
  await setup(page, 'hung')
  await goTo(page, 'Tài khoản & quỹ')
  await accountRow(page, 'Vietcombank').click()
  await page.getByRole('button', { name: 'Xóa…' }).click()
  const d = page.getByRole('dialog', { name: 'Xóa "Vietcombank"' })
  await expect(d.getByRole('alert')).toContainText('Sổ tiết kiệm “Sổ ABC 6 tháng” đang nhận lãi vào tài khoản này')
  await d.getByRole('button', { name: 'Hủy' }).click()

  // Số dư đầu 300 triệu đã chi / chuyển đi nhiều → hạ xuống 1 triệu thì các khoản sau sẽ làm âm.
  await page.getByRole('button', { name: 'Sửa thông tin' }).click()
  const edit = page.getByRole('dialog')
  await edit.getByLabel('Số dư hiện tại').fill('1tr')
  await edit.getByRole('button', { name: 'Lưu' }).click()
  await expect(edit).toBeHidden() // ngân hàng được phép thấu chi (đã cảnh báo lúc ghi giao dịch)
})

test('tài khoản đầu tư và tài sản khác: sửa tên, tiền mặt / giá trị ban đầu', async ({ page }) => {
  await setup(page, 'mai')
  await goTo(page, 'Đầu tư')
  await page.getByRole('main').getByRole('link').first().click()
  await page.getByRole('button', { name: 'Sửa thông tin' }).click()
  const d = page.getByRole('dialog', { name: 'Sửa tài khoản đầu tư' })
  await d.getByLabel('Tên', { exact: true }).fill('SSI của Mai')
  await d.getByRole('button', { name: 'Lưu' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'SSI của Mai' })).toBeVisible()
})
