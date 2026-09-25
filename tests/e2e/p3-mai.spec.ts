// Kịch bản P3 — Mai (docs/08 §4): đầu tư FPT (W10), thẻ tín dụng (W13), tài sản khác (W11), qua giao diện.
import { expect, test, type Page } from '@playwright/test'
import { buildCategorySeed } from '../../src/data/seed/categories'
import { makeAccount } from '../../src/test/personas'
import type { FakeBackend } from './fake-backend'
import { accountRow, addTransaction, login, seedData, selectByText, startApp, goTo } from './helpers'

let backend: FakeBackend
let userId: string

test.beforeEach(async ({ page }) => {
  backend = await startApp(page, { today: new Date('2026-08-31T10:00:00+07:00') })
  userId = await backend.createUser('mai@example.com', 'matkhau123')
  await seedData(backend, userId, {
    accounts: [makeAccount('bank', 'vcb', 'Vietcombank', 400_000_000, '2026-07-01')],
    categories: buildCategorySeed('basic'),
  })
  await login(page, 'mai@example.com', 'matkhau123')
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible()
})

test.afterEach(async () => {
  await backend.close()
})

async function trade(page: Page, v: { side?: 'Bán'; quantity: string; price: string; fee: string; tax?: string; date: string }) {
  const d = page.getByRole('dialog', { name: 'Ghi lệnh' })
  if (v.side) await d.getByRole('radio', { name: v.side }).click()
  await d.getByLabel(/^Số lượng/).fill(v.quantity)
  // Kịch bản gốc (docs/08) nhập giá / cp và phí, thuế bằng số tiền.
  await d.getByRole('radiogroup', { name: 'Nhập giá theo' }).getByRole('radio', { name: /^Giá \// }).click()
  await d.getByLabel(/^Giá \//).fill(v.price)
  await d.getByRole('radiogroup', { name: 'Cách nhập phí' }).getByRole('radio', { name: '₫' }).click()
  await d.getByLabel(/^Phí/).fill(v.fee)
  await d.getByRole('radiogroup', { name: 'Cách nhập thuế' }).getByRole('radio', { name: '₫' }).click()
  await d.getByLabel(/^Thuế/).fill(v.tax ?? '0')
  await d.getByLabel('Ngày').fill(v.date)
  return d
}

test('W10: nạp 300 tr → mua FPT 2 lần → giá 125.000 → bán 600 cp; chặn bán quá số đang có', async ({ page }) => {
  test.setTimeout(120_000)
  await goTo(page, 'Đầu tư')
  await page.getByRole('button', { name: 'Thêm tài khoản đầu tư' }).click()
  const acc = page.getByRole('dialog', { name: 'Thêm tài khoản đầu tư' })
  await acc.getByLabel('Tên', { exact: true }).fill('Chứng khoán')
  await acc.getByLabel('Tính từ ngày').fill('2026-07-01')
  await acc.getByRole('button', { name: 'Lưu' }).click()
  await page.getByRole('link', { name: /Chứng khoán/ }).click()

  await page.getByRole('button', { name: 'Nạp tiền' }).click()
  const nap = page.getByRole('dialog')
  await nap.getByLabel('Số tiền').fill('300tr')
  await selectByText(nap.getByLabel('Từ tài khoản'), 'Vietcombank')
  await nap.getByLabel('Ngày').fill('2026-08-01')
  await nap.getByRole('button', { name: 'Lưu' }).click()
  await expect(nap).toBeHidden()

  await page.getByRole('button', { name: 'Thêm mã' }).click()
  const h = page.getByRole('dialog', { name: 'Thêm mã' })
  await h.getByLabel('Mã', { exact: true }).fill('fpt')
  await h.getByRole('button', { name: 'Thêm và ghi lệnh' }).click()
  let d = await trade(page, { quantity: '1000', price: '120k', fee: '180k', date: '2026-08-05' })
  await expect(d.getByRole('status', { name: 'Tóm tắt lệnh' })).toContainText('Giá trị lệnh120.000.000 ₫')
  await expect(d.getByRole('status', { name: 'Tóm tắt lệnh' })).toContainText('Tổng tiền phải trả120.180.000 ₫')
  await d.getByRole('button', { name: 'Lưu' }).click()
  await expect(d).toBeHidden()

  await page.getByRole('button', { name: 'Mua / Bán' }).click()
  d = await trade(page, { quantity: '500', price: '108k', fee: '81k', date: '2026-08-12' })
  await d.getByRole('button', { name: 'Lưu' }).click()
  await expect(d).toBeHidden()

  await page.getByRole('button', { name: 'Cập nhật giá' }).click()
  const pr = page.getByRole('dialog', { name: 'Cập nhật giá' })
  await pr.getByLabel(/^FPT/).fill('125k')
  await pr.getByRole('button', { name: 'Lưu' }).click()
  await expect(pr).toBeHidden()

  const row = page.getByRole('row', { name: /FPT/ })
  await expect(row).toContainText('1.500 cp')
  await expect(row).toContainText('116.000 ₫') // giá vốn bình quân
  await expect(row).toContainText('187.500.000 ₫')
  await expect(row).toContainText('+13.500.000 ₫')
  await expect(page.getByText('313.239.000 ₫').first()).toBeVisible() // tiền mặt 125.739.000 + CK 187.500.000

  await page.getByRole('button', { name: 'Mua / Bán' }).click()
  d = await trade(page, { side: 'Bán', quantity: '2000', price: '130k', fee: '0', date: '2026-08-31' })
  await d.getByRole('button', { name: 'Lưu' }).click()
  await expect(d.getByRole('alert')).toContainText('chỉ đang có 1500')

  d = await trade(page, { side: 'Bán', quantity: '600', price: '130k', fee: '117k', tax: '78k', date: '2026-08-31' })
  await expect(d.getByRole('status', { name: 'Tóm tắt lệnh' })).toContainText('Lãi/lỗ thực hiện (trước phí, thuế)+8.400.000 ₫')
  await expect(d.getByRole('status', { name: 'Tóm tắt lệnh' })).toContainText('Tiền thực nhận77.805.000 ₫') // 78.000.000 − 117.000 − 78.000
  await d.getByRole('button', { name: 'Lưu' }).click()
  await expect(d).toBeHidden()
  await expect(row).toContainText('900 cp')
  await expect(row).toContainText('116.000 ₫')

  const [fees] = await backend.rows(userId, `select sum(amount)::bigint as s from public.transactions where type = 'expense'`)
  expect(fees!.s).toBe(180_000 + 81_000 + 195_000)
})

test('W13: thẻ 20 tr / hạn mức 50 tr, lãi 30% → trả tối thiểu mất 29 tháng; 400k không bao giờ hết', async ({ page }) => {
  await goTo(page, 'Khoản nợ')
  await page.getByRole('button', { name: 'Thêm thẻ tín dụng' }).click()
  const d = page.getByRole('dialog', { name: 'Thêm thẻ tín dụng' })
  await d.getByLabel('Tên thẻ').fill('Visa TPBank')
  await d.getByLabel('Hạn mức').fill('50tr')
  await d.getByLabel('Dư nợ hiện tại').fill('20tr')
  await d.getByRole('button', { name: 'Lưu' }).click()
  const card = page.getByRole('link', { name: /Visa TPBank/ })
  await expect(card).toContainText('Dùng 40% hạn mức · tối thiểu 1.000.000 ₫')
  await card.click()
  await expect(page.getByRole('status').filter({ hasText: 'Trả hết' })).toHaveText('Trả hết sau khoảng 29 tháng (~2,4 năm).')
  await page.getByLabel('Nếu mỗi tháng trả').fill('400k')
  await expect(page.getByText(/không bao giờ hết/)).toBeVisible()

  // Chi tiêu bằng thẻ làm dư nợ tăng; thanh toán thẻ từ ngân hàng làm dư nợ giảm.
  await addTransaction(page, { amount: '2tr', category: 'Mua sắm', account: 'Visa TPBank', date: '2026-08-31' })
  await expect(page.getByText('22.000.000 ₫').first()).toBeVisible()
  await addTransaction(page, { type: 'Chuyển', amount: '22tr', account: 'Vietcombank', to: 'Visa TPBank', date: '2026-08-31' })
  await expect(page.getByText('Trả hết sau khoảng 0 tháng').or(page.getByText('Không còn dư nợ.'))).toBeVisible()
})

test('W11: căn hộ 3 tỷ → định giá 3,2 tỷ → bán 3,3 tỷ về VCB', async ({ page }) => {
  await goTo(page, 'Đầu tư')
  await page.getByRole('button', { name: 'Thêm tài sản khác' }).click()
  const d = page.getByRole('dialog', { name: 'Thêm tài sản khác' })
  await d.getByLabel('Tên').fill('Căn hộ Q7')
  await d.getByLabel('Giá trị ước tính').fill('3ty')
  await d.getByLabel('Tại ngày').fill('2026-07-01')
  await d.getByRole('button', { name: 'Lưu' }).click()
  await page.getByRole('link', { name: /Căn hộ Q7/ }).click()
  await page.getByRole('button', { name: 'Định giá lại' }).click()
  const r = page.getByRole('dialog', { name: 'Định giá lại' })
  await r.getByLabel('Giá trị mới').fill('3,2ty')
  await r.getByLabel('Tại ngày').fill('2026-08-15')
  await r.getByRole('button', { name: 'Lưu' }).click()
  await expect(page.getByText('3.200.000.000 ₫').first()).toBeVisible()

  await page.getByRole('button', { name: 'Bán tài sản' }).click()
  const s = page.getByRole('dialog', { name: 'Bán Căn hộ Q7' })
  await s.getByLabel('Giá bán').fill('3,3ty')
  await selectByText(s.getByLabel('Nhận tiền vào'), 'Vietcombank')
  await s.getByRole('button', { name: 'Xác nhận bán' }).click()
  await expect(s).toBeHidden()
  await expect(page.getByText('Tài sản khác · đã bán')).toBeVisible()
  await goTo(page, 'Tài khoản & quỹ')
  await expect(accountRow(page, 'Vietcombank')).toContainText('3.700.000.000 ₫')
})
