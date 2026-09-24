// Giai đoạn 7 — Cài đặt: danh mục (W15), sao lưu / khôi phục (W17), dữ liệu demo, xóa toàn bộ, tùy chọn.
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { lan } from '../../src/test/personas'
import type { FakeBackend } from './fake-backend'
import { addTransaction, login, seedData, selectByText, startApp, goTo } from './helpers'

let backend: FakeBackend
let userId: string

async function setup(page: Page, today = '2026-08-31') {
  backend = await startApp(page, { today: new Date(`${today}T10:00:00+07:00`) })
  userId = await backend.createUser('lan@example.com', 'matkhau123')
  const p1 = lan()
  await seedData(backend, userId, { accounts: p1.accounts, categories: p1.categories, transactions: p1.transactions, budgetMonths: [p1.augustBudget], budgetLines: p1.augustLines })
  await login(page, 'lan@example.com', 'matkhau123')
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible()
}

const openSettings = async (page: Page) => {
  await goTo(page, 'Cài đặt')
  await expect(page.getByRole('heading', { level: 1, name: 'Cài đặt' })).toBeVisible()
}

test.afterEach(async () => {
  await backend.close()
})

test('W15: thêm, xóa danh mục chưa dùng; danh mục đã dùng phải gộp; gộp giữ nguyên tổng chi', async ({ page }) => {
  await setup(page)
  await openSettings(page)
  const section = page.getByRole('region', { name: 'Danh mục thu chi' })
  const list = section.getByRole('list', { name: 'Danh sách danh mục' })

  // Thêm "Thú cưng" (Mong muốn)
  await section.getByRole('button', { name: 'Thêm danh mục' }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Tên danh mục').fill('Thú cưng')
  await dialog.getByRole('button', { name: 'Lưu' }).click()
  await expect(dialog).toBeHidden()
  await expect(list).toContainText('Thú cưng')

  // Không thể biến "Ăn uống" (đã có giao dịch) thành nhóm
  await section.getByRole('button', { name: 'Thêm danh mục' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Tên danh mục').fill('Cà phê')
  await selectByText(dialog.getByLabel('Thuộc nhóm'), 'Ăn uống')
  await dialog.getByRole('button', { name: 'Lưu' }).click()
  await expect(dialog.getByRole('alert')).toContainText('"Ăn uống" đã có giao dịch')
  await dialog.getByRole('button', { name: 'Hủy' }).click()

  // Xóa danh mục đã dùng → báo phải gộp; xóa danh mục chưa dùng → được
  await section.getByRole('button', { name: 'Sửa danh mục Giải trí' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Xóa' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'hãy gộp vào danh mục khác' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Hủy' }).click()
  await section.getByRole('button', { name: 'Sửa danh mục Thú cưng' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Xóa' }).click()
  await expect(list).not.toContainText('Thú cưng')

  // Danh mục hệ thống: chỉ đổi tên
  await section.getByRole('button', { name: 'Sửa danh mục Lãi vay' }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('chỉ đổi được tên')
  await expect(dialog.getByRole('button', { name: 'Xóa' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Hủy' }).click()

  // Gộp Giải trí → Mua sắm
  await section.getByRole('button', { name: 'Sửa danh mục Giải trí' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Gộp…' }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('1 dòng ngân sách')
  await selectByText(dialog.getByLabel('Gộp vào danh mục'), 'Mua sắm')
  await dialog.getByRole('button', { name: 'Gộp và xóa' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Đã gộp "Giải trí" vào "Mua sắm"' })).toBeVisible()
  await expect(list).not.toContainText('Giải trí')

  await goTo(page, 'Ngân sách')
  const shopping = page.getByRole('button', { name: 'Dòng ngân sách Mua sắm' })
  await expect(shopping).toContainText('Đã chi 2.100.000 ₫ / 2.500.000 ₫') // 1tr + 1,1tr ; 1,5tr + 1tr
  await expect(page.getByRole('button', { name: 'Dòng ngân sách Giải trí' })).toHaveCount(0)
})

test('W17: sao lưu JSON → sửa dữ liệu → khôi phục (tự sao lưu trước lên Storage) → dữ liệu như lúc sao lưu', async ({ page }) => {
  await setup(page)
  await expect(page.getByText('Bạn chưa sao lưu dữ liệu lần nào.')).toBeVisible()
  await openSettings(page)
  const data = page.getByRole('region', { name: 'Dữ liệu & sao lưu' })

  const downloadPromise = page.waitForEvent('download')
  await data.getByRole('button', { name: 'Tải file sao lưu (JSON)' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^tai-chinh-sao-luu-.*\.json$/)
  const file = await download.path()
  const backup = JSON.parse(await readFile(file, 'utf8'))
  expect(backup.app).toBe('tai-chinh-ca-nhan')
  expect(backup.data.transactions).toHaveLength(lan().transactions.length)
  await expect(data).not.toContainText('chưa bao giờ')

  // Nhắc sao lưu biến mất
  await goTo(page, 'Tổng quan')
  await expect(page.getByText('Net worth (tài sản − nợ)')).toBeVisible()
  await expect(page.getByText('Bạn chưa sao lưu dữ liệu lần nào.')).toHaveCount(0)

  await addTransaction(page, { amount: '5tr', category: 'Mua sắm', account: 'Vietcombank', date: '2026-08-31' })
  await expect(page.getByText('38.250.000 ₫').first()).toBeVisible()

  await openSettings(page)
  await data.getByLabel('Chọn file sao lưu').setInputFiles(file)
  const dialog = page.getByRole('dialog', { name: 'Khôi phục từ file sao lưu' })
  await expect(dialog.getByRole('list', { name: 'Nội dung file sao lưu' })).toContainText(`Giao dịch${lan().transactions.length}`)
  await dialog.getByRole('button', { name: 'Thay thế toàn bộ dữ liệu' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Bản sao dữ liệu cũ đã lưu trên máy chủ' })).toBeVisible()
  expect([...backend.files.keys()]).toEqual([expect.stringMatching(new RegExp(`^user-files/${userId}/backups/.+\\.json$`))])

  await goTo(page, 'Tổng quan')
  await expect(page.getByText('43.250.000 ₫').first()).toBeVisible()
})

test('W17: file hỏng bị từ chối, dữ liệu không đổi; Storage lỗi → bản sao cũ được tải về máy', async ({ page }) => {
  await setup(page)
  await openSettings(page)
  const data = page.getByRole('region', { name: 'Dữ liệu & sao lưu' })
  await data.getByLabel('Chọn file sao lưu').setInputFiles({ name: 'hong.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"khac"') })
  await expect(data.getByRole('alert')).toContainText('File không phải JSON hợp lệ')
  await data.getByLabel('Chọn file sao lưu').setInputFiles({ name: 'khac.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"khac"}') })
  await expect(data.getByRole('alert')).toContainText('Không phải file sao lưu của ứng dụng này')

  backend.storageDown = true
  await data.getByRole('button', { name: 'Nạp dữ liệu demo…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nạp dữ liệu demo' })
  await dialog.getByLabel('Nhân vật').selectOption({ index: 1 }) // Hùng
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Nạp dữ liệu demo' }).click()
  const safety = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8'))
  expect(safety.data.transactions).toHaveLength(lan().transactions.length) // dữ liệu Lan trước khi thay
  await expect(page.getByRole('status').filter({ hasText: 'Bản sao dữ liệu cũ đã được tải về máy' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible()
  await goTo(page, 'Khoản nợ')
  await expect(page.getByText('Vay mua nhà').first()).toBeVisible()
})

test('Xóa toàn bộ (gõ XÓA) → onboarding → "Xem dữ liệu demo" → tổng quan của Lan', async ({ page }) => {
  await setup(page, '2026-09-10')
  await openSettings(page)
  await page.getByRole('button', { name: 'Xóa toàn bộ dữ liệu…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Xóa toàn bộ dữ liệu' })
  await dialog.getByLabel('Gõ "XÓA" để xác nhận').fill('xoa')
  await dialog.getByRole('button', { name: 'Xóa vĩnh viễn' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Gõ đúng chữ XÓA')
  await dialog.getByLabel('Gõ "XÓA" để xác nhận').fill('XÓA')
  await dialog.getByRole('button', { name: 'Xóa vĩnh viễn' }).click()

  await expect(page.getByRole('heading', { name: 'Chào mừng' })).toBeVisible()
  expect(await backend.rows(userId, 'select id from public.transactions')).toEqual([])
  expect(backend.files.size).toBe(1) // đã sao lưu trước khi xóa

  await page.getByRole('button', { name: 'Xem dữ liệu demo' }).click()
  await expect(page.getByText('Net worth (tài sản − nợ)')).toBeVisible()
  await expect(page.getByLabel('Chỉ số sức khỏe tài chính')).toContainText('31,9%') // docs/08: tỉ lệ tiết kiệm tháng 8 của Lan
  await goTo(page, 'Ngân sách')
  await expect(page.getByText('Tháng 09/2026')).toBeVisible()
})

test('Tùy chọn: giao diện tối áp dụng ngay và giữ sau khi tải lại; đổi mật khẩu rồi đăng nhập lại', async ({ page }) => {
  await setup(page)
  await openSettings(page)
  const prefs = page.getByRole('region', { name: 'Tùy chọn' })
  await prefs.getByLabel('Giao diện').selectOption('dark')
  await prefs.getByLabel('Ngày bắt đầu tháng tài chính').selectOption('25')
  await expect(prefs).toContainText('tính lại khoảng ngày của mọi tháng')
  await prefs.getByLabel('Ngày bắt đầu tháng tài chính').selectOption('1')
  await prefs.getByRole('button', { name: 'Lưu cài đặt' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Cài đặt' })).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)

  const account = page.getByRole('region', { name: 'Tài khoản đăng nhập' })
  await expect(account).toContainText('lan@example.com')
  await account.getByRole('button', { name: 'Đổi mật khẩu' }).click()
  await account.getByLabel('Mật khẩu mới', { exact: true }).fill('matkhaumoi456')
  await account.getByLabel('Nhập lại mật khẩu mới').fill('matkhaumoi456')
  await account.getByRole('button', { name: 'Lưu mật khẩu' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Đã đổi mật khẩu' })).toBeVisible()
  await account.getByRole('button', { name: 'Đăng xuất' }).click()
  await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible()
  await login(page, 'lan@example.com', 'matkhaumoi456')
  await expect(page.getByRole('heading', { level: 1, name: 'Cài đặt' })).toBeVisible() // quay lại đúng trang đang mở
})

test('E9 + E13: tài khoản mới tinh, màn hình 360px — mọi trang có trạng thái rỗng, không NaN, không cuộn ngang', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 360, height: 740 })
  backend = await startApp(page, { today: new Date('2026-09-10T10:00:00+07:00') })
  await backend.createUser('moi@example.com', 'matkhau123', { onboarded: true })
  await login(page, 'moi@example.com', 'matkhau123')
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible()
  for (const label of ['Tổng quan', 'Ngân sách', 'Giao dịch', 'Tài khoản & quỹ', 'Tiết kiệm', 'Đầu tư', 'Khoản nợ', 'Báo cáo', 'Mô phỏng', 'Cài đặt']) {
    await goTo(page, label)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.waitForLoadState('networkidle')
    const body = await page.locator('main').innerText()
    expect(body, label).not.toMatch(/NaN|undefined|Infinity/)
    const overflow = await page.locator('html').evaluate((html) => html.scrollWidth - html.clientWidth)
    expect(overflow, `${label} cuộn ngang`).toBeLessThanOrEqual(0)
  }
  expect(errors).toEqual([])
})
