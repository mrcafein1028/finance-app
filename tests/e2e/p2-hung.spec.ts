// Kịch bản P2 — Hùng (docs/08 §3): sổ tiết kiệm (W9) và vay mua nhà gốc đều (W12), qua giao diện.
import { expect, test, type Page } from '@playwright/test'
import { buildCategorySeed } from '../../src/data/seed/categories'
import { makeAccount } from '../../src/test/personas'
import type { FakeBackend } from './fake-backend'
import { accountRow, login, seedData, selectByText, startApp, goTo } from './helpers'

let backend: FakeBackend
let userId: string

async function setup(page: Page, today: string) {
  backend = await startApp(page, { today: new Date(`${today}T10:00:00+07:00`) })
  userId = await backend.createUser('hung@example.com', 'matkhau123')
  await seedData(backend, userId, {
    accounts: [makeAccount('bank', 'vcb', 'Vietcombank', 300_000_000, '2026-01-01')],
    categories: buildCategorySeed('basic'),
  })
  await login(page, 'hung@example.com', 'matkhau123')
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible()
}

async function travelTo(page: Page, date: string) {
  await page.clock.setFixedTime(new Date(`${date}T10:00:00+07:00`))
  await page.reload()
}

test.afterEach(async () => {
  await backend.close()
})

test('W9: mở sổ 100 tr → lãi dồn tích 01/06 → đáo hạn 01/09 tái tục gốc', async ({ page }) => {
  await setup(page, '2026-03-01')
  await goTo(page, 'Tiết kiệm')
  await page.getByRole('button', { name: 'Mở sổ' }).click()
  const d = page.getByRole('dialog', { name: 'Mở sổ tiết kiệm' })
  await d.getByLabel('Tên sổ').fill('Sổ ABC 6 tháng')
  await d.getByLabel('Ngân hàng').fill('ABC')
  await d.getByLabel('Số tiền gửi').fill('100tr')
  await d.getByLabel('Lãi suất (%/năm)').fill('5,5')
  await d.getByLabel('Kỳ hạn', { exact: true }).selectOption({ label: '6 tháng' })
  await expect(d.getByRole('status')).toHaveText('Đáo hạn 01/09/2026 · lãi dự kiến 2.772.603 ₫')
  await selectByText(d.getByLabel('Trích tiền từ'), 'Vietcombank')
  await selectByText(d.getByLabel('Tài khoản nhận lãi / tiền tất toán'), 'Vietcombank')
  await d.getByRole('button', { name: 'Lưu' }).click()
  await expect(d).toBeHidden()
  await expect(page.getByRole('link', { name: /Sổ ABC 6 tháng/ })).toContainText('100.000.000 ₫')

  await travelTo(page, '2026-06-01')
  await expect(page.getByRole('link', { name: /Sổ ABC 6 tháng/ })).toContainText('101.386.301 ₫')

  await travelTo(page, '2026-09-02')
  const card = page.getByRole('link', { name: /Sổ ABC 6 tháng/ })
  await expect(card).toContainText('Đã đáo hạn 01/09/2026 — cần xử lý')
  await card.click()
  await page.getByRole('button', { name: 'Xử lý đáo hạn' }).click()
  const m = page.getByRole('dialog', { name: 'Đáo hạn Sổ ABC 6 tháng' })
  await expect(m.getByLabel('Lãi thực nhận')).toHaveValue('2772603')
  await m.getByLabel('Lãi suất kỳ mới (%/năm)').fill('5')
  await m.getByRole('button', { name: 'Xác nhận' }).click()
  await expect(m).toBeHidden()
  await expect(page.getByText('Kỳ 2: 01/09/2026 → 01/03/2027 · 5%')).toBeVisible()

  await goTo(page, 'Tài khoản & quỹ')
  await expect(accountRow(page, 'Vietcombank')).toContainText('202.772.603 ₫') // 300 − 100 + lãi
  const [interest] = await backend.rows(userId, `select amount, idempotency_key from public.transactions where type = 'income'`)
  expect(interest!.amount).toBe(2_772_603)
})

test('W9: rút trước hạn 01/06 → chỉ hưởng 25.205 ₫, gốc về VCB, sổ lưu trữ', async ({ page }) => {
  await setup(page, '2026-03-01')
  await goTo(page, 'Tiết kiệm')
  await page.getByRole('button', { name: 'Mở sổ' }).click()
  const d = page.getByRole('dialog', { name: 'Mở sổ tiết kiệm' })
  await d.getByLabel('Tên sổ').fill('Sổ ABC')
  await d.getByLabel('Ngân hàng').fill('ABC')
  await d.getByLabel('Số tiền gửi').fill('100tr')
  await d.getByLabel('Lãi suất (%/năm)').fill('5,5')
  await selectByText(d.getByLabel('Trích tiền từ'), 'Vietcombank')
  await selectByText(d.getByLabel('Tài khoản nhận lãi / tiền tất toán'), 'Vietcombank')
  await d.getByRole('button', { name: 'Lưu' }).click()
  await travelTo(page, '2026-06-01')
  await page.getByRole('link', { name: /Sổ ABC/ }).click()
  await page.getByRole('button', { name: 'Rút trước hạn' }).click()
  const e = page.getByRole('dialog', { name: 'Rút trước hạn Sổ ABC' })
  await expect(e.getByText('Dự tính: 25.205 ₫')).toBeVisible()
  await e.getByRole('button', { name: 'Rút' }).click()
  await expect(e).toBeHidden()
  await expect(page.getByText('· đã tất toán')).toBeVisible()
  await goTo(page, 'Tài khoản & quỹ')
  await expect(accountRow(page, 'Vietcombank')).toContainText('300.025.205 ₫')
})

test('W12: vay nhà 1,2 tỷ gốc đều 9% → trả kỳ 1 → đổi lãi suất → trả trước 100 tr → xóa cả nhóm', async ({ page }) => {
  test.setTimeout(120_000)
  await setup(page, '2026-08-01')
  await goTo(page, 'Khoản nợ')
  await page.getByRole('button', { name: 'Thêm khoản vay' }).click()
  const d = page.getByRole('dialog', { name: 'Thêm khoản vay' })
  await d.getByLabel('Tên', { exact: true }).fill('Vay mua nhà')
  await d.getByLabel('Bên cho vay').fill('BIDV')
  await d.getByLabel('Số tiền vay ban đầu').fill('1,2ty')
  await d.getByLabel('Dư nợ hiện tại').fill('1,2ty')
  await d.getByLabel('Lãi suất (%/năm)').fill('9')
  await d.getByLabel('Tổng số tháng vay').fill('240')
  await d.getByLabel('Ngày giải ngân').fill('2026-08-01')
  await d.getByLabel('Ngày trả hằng tháng').selectOption({ label: 'Ngày 10' })
  await d.getByLabel('Phí trả trước hạn (%)').fill('1')
  await expect(d.getByRole('status')).toContainText('Kỳ đầu (10/09/2026): 14.000.000 ₫ (gốc 5.000.000 ₫ + lãi 9.000.000 ₫)')
  await expect(d.getByRole('status')).toContainText('trả hết 10/08/2046')
  await d.getByRole('button', { name: 'Lưu' }).click()
  await expect(d).toBeHidden()

  await travelTo(page, '2026-09-10')
  await page.getByRole('link', { name: /Vay mua nhà/ }).click()
  await expect(page.getByText('10/09/2026 · 14.000.000 ₫')).toBeVisible()
  await page.getByRole('button', { name: 'Ghi trả kỳ này' }).click()
  const pay = page.getByRole('dialog', { name: 'Trả nợ Vay mua nhà' })
  await expect(pay.getByLabel('Tiền gốc')).toHaveValue('5000000')
  await expect(pay.getByLabel('Tiền lãi')).toHaveValue('9000000')
  await selectByText(pay.getByLabel('Trả từ tài khoản'), 'Vietcombank')
  await pay.getByRole('button', { name: 'Lưu' }).click()
  await expect(pay).toBeHidden()
  await expect(page.getByText('1.195.000.000 ₫').first()).toBeVisible()
  const groups = await backend.rows(userId, `select count(distinct group_id)::int as g, count(*)::int as n from public.transactions where group_id is not null`)
  expect(groups[0]).toEqual({ g: 1, n: 2 })

  // Hết ưu đãi: 11% từ kỳ 13 (10/09/2027 — kỳ 1 là 10/09/2026) → lãi kỳ 13 = 1.140.000.000 × 11%/12
  await page.getByRole('button', { name: 'Đổi lãi suất' }).click()
  const rate = page.getByRole('dialog', { name: 'Đổi lãi suất' })
  await rate.getByLabel('Áp dụng từ ngày').fill('2027-09-10')
  await rate.getByLabel('Lãi suất mới (%/năm)').fill('11')
  await rate.getByRole('button', { name: 'Lưu' }).click()
  await expect(rate).toBeHidden()
  await expect(page.getByRole('row', { name: /^13 10\/09\/2027/ })).toContainText('10.450.000 ₫')

  // Trả trước 100 tr, giảm kỳ hạn, phí 1%
  await page.getByRole('button', { name: 'Trả trước' }).click()
  const pre = page.getByRole('dialog', { name: 'Trả trước Vay mua nhà' })
  await pre.getByLabel('Số tiền trả trước').fill('100tr')
  await expect(pre.getByRole('status')).toContainText('phí trả trước 1.000.000 ₫')
  await expect(pre.getByRole('status')).toContainText('Trả hết sớm hơn 20 kỳ')
  await selectByText(pre.getByLabel('Trả từ tài khoản'), 'Vietcombank')
  await pre.getByRole('button', { name: 'Xác nhận trả trước' }).click()
  await expect(pre).toBeHidden()
  await expect(page.getByText('1.095.000.000 ₫').first()).toBeVisible()

  // Xóa phần lãi của kỳ 1 → hệ thống xóa cả nhóm (I8), dư nợ trở lại
  await page.getByRole('button', { name: /^Lãi vay/ }).first().click()
  const edit = page.getByRole('dialog')
  await expect(edit.getByText(/thuộc một nghiệp vụ nhiều phần/)).toBeVisible()
  await edit.getByRole('button', { name: 'Xóa' }).click()
  await edit.getByRole('button', { name: 'Xác nhận xóa' }).click()
  await expect(page.getByText('1.100.000.000 ₫').first()).toBeVisible()
  const left = await backend.rows(userId, `select count(*)::int as n from public.transactions where group_id is not null`)
  expect(left[0]!.n).toBe(2) // chỉ còn nhóm trả trước (gốc + phí)
})
