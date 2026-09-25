// Ghi lệnh chứng chỉ quỹ kiểu người dùng thật: nhập TỔNG TIỀN thay vì giá/đơn vị, phí và thuế theo %.
import { expect, test } from '@playwright/test'
import { toReplacePayload } from '../../src/data/backup'
import { buildDemoBackup } from '../../src/data/demo'
import type { FakeBackend } from './fake-backend'
import { goTo, login, startApp } from './helpers'

let backend: FakeBackend
test.afterEach(async () => {
  await backend.close()
})

test('CCQ: mua theo tổng tiền, bán với phí 1,5% + thuế 0,1%; lần sau app nhớ mức phí', async ({ page }) => {
  backend = await startApp(page, { today: new Date('2026-09-25T10:00:00+07:00') })
  const userId = await backend.createUser('mai@example.com', 'matkhau123')
  await backend.asUser(userId, (tx) => tx.query('select public.replace_all_data($1::jsonb)', [JSON.stringify(toReplacePayload(buildDemoBackup('mai', '2026-09-25')))]))
  await login(page, 'mai@example.com', 'matkhau123')
  await expect(page.getByText('Net worth (tài sản − nợ)')).toBeVisible()
  await goTo(page, 'Đầu tư')
  await page.getByRole('main').getByRole('link').first().click()

  await page.getByRole('button', { name: 'Thêm mã' }).click()
  const h = page.getByRole('dialog', { name: 'Thêm mã' })
  await h.getByLabel('Mã', { exact: true }).fill('vesaf')
  await h.getByLabel('Loại').selectOption({ label: 'Chứng chỉ quỹ' })
  await h.getByRole('button', { name: 'Thêm và ghi lệnh' }).click()

  // Mua: sao kê ghi 196,5 CCQ, 5.000.000 ₫, không phí mua.
  let d = page.getByRole('dialog', { name: 'Ghi lệnh' })
  await d.getByLabel('Số lượng (CCQ)').fill('196,5')
  await d.getByLabel('Tổng giá trị lệnh (trước phí, thuế)').fill('5tr')
  const summary = d.getByRole('status', { name: 'Tóm tắt lệnh' })
  await expect(summary).toContainText('Giá / CCQ≈ 25.445 ₫')
  await expect(summary).toContainText('Tổng tiền phải trả4.999.943 ₫')
  await expect(summary).toContainText('lệch 57 ₫ so với tổng bạn nhập')
  await d.getByRole('button', { name: 'Lưu' }).click()
  await expect(d).toBeHidden()
  await expect(page.getByRole('row', { name: /VESAF/ })).toContainText('196,5 CCQ')

  // Bán 100 CCQ: 2.600.000 ₫, phí bán 1,5%, thuế 0,1% (điền sẵn).
  await page.getByRole('button', { name: 'Mua / Bán' }).click()
  d = page.getByRole('dialog', { name: 'Ghi lệnh' })
  await d.getByLabel('Mã').selectOption({ label: 'VESAF' })
  await d.getByRole('radio', { name: 'Bán' }).click()
  await expect(d.getByLabel(/^Thuế/)).toHaveValue('0,1')
  await d.getByLabel('Số lượng (CCQ)').fill('100')
  await d.getByLabel('Tổng giá trị lệnh (trước phí, thuế)').fill('2,6tr')
  await d.getByLabel(/^Phí/).fill('1,5')
  await expect(d.getByText('= 39.000 ₫')).toBeVisible()
  await expect(d.getByText('= 2.600 ₫')).toBeVisible()
  await expect(d.getByRole('status', { name: 'Tóm tắt lệnh' })).toContainText('Tiền thực nhận2.558.400 ₫')
  await d.getByRole('button', { name: 'Lưu' }).click()
  await expect(d).toBeHidden()
  await expect(page.getByRole('row', { name: /VESAF/ })).toContainText('96,5 CCQ')
  const [sell] = await backend.rows(userId, `select price, fee, tax, quantity from public.investment_trades where side = 'sell' and holding_id = (select id from public.holdings where symbol = 'VESAF')`)
  expect(sell).toEqual({ price: 26_000, fee: 39_000, tax: 2_600, quantity: '100' })

  // Lần bán sau: phí 1,5% được nhớ theo mã + loại lệnh.
  await page.getByRole('button', { name: 'Mua / Bán' }).click()
  d = page.getByRole('dialog', { name: 'Ghi lệnh' })
  await d.getByLabel('Mã').selectOption({ label: 'VESAF' })
  await d.getByRole('radio', { name: 'Bán' }).click()
  await expect(d.getByLabel(/^Phí/)).toHaveValue('1,5')
})
