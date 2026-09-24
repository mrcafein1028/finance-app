// Giai đoạn 4 — ngân sách (W5–W7) và giao dịch định kỳ (W14, W18) trên dữ liệu tháng 8 của Lan (docs/08 §2).
import { expect, test, type Page } from '@playwright/test'
import { lan } from '../../src/test/personas'
import type { FakeBackend } from './fake-backend'
import { login, seedData, selectByText, startApp, goTo } from './helpers'

let backend: FakeBackend
let userId: string

async function setup(page: Page, today: string, withBudget = true) {
  backend = await startApp(page, { today: new Date(`${today}T10:00:00+07:00`) })
  userId = await backend.createUser('lan@example.com', 'matkhau123')
  const p1 = lan()
  await seedData(backend, userId, {
    accounts: p1.accounts,
    categories: p1.categories,
    transactions: p1.transactions,
    ...(withBudget ? { budgetMonths: [p1.augustBudget], budgetLines: p1.augustLines } : {}),
  })
  await login(page, 'lan@example.com', 'matkhau123')
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible()
}

test.afterEach(async () => {
  await backend.close()
})

const line = (page: Page, name: string) => page.getByRole('button', { name: `Dòng ngân sách ${name}` })

test('W6: ngân sách tháng 8 — trạng thái từng dòng khớp docs/08', async ({ page }) => {
  await setup(page, '2026-08-31')
  await goTo(page, 'Ngân sách')
  await expect(page.getByText('Tháng 08/2026')).toBeVisible()
  await expect(page.getByText('Chưa phân bổ')).toBeVisible()
  await expect(page.getByText('2.500.000 ₫').first()).toBeVisible()
  await expect(line(page, 'Ăn uống')).toContainText('Vượt')
  await expect(line(page, 'Ăn uống')).toContainText('Vượt 350.000 ₫')
  await expect(line(page, 'Giải trí')).toContainText('Vượt 100.000 ₫')
  await expect(line(page, 'Hóa đơn & tiện ích')).toContainText('Vừa hết')
  await expect(line(page, 'Mua sắm')).toContainText('Đã chi 1.000.000 ₫ / 1.500.000 ₫')
  await expect(line(page, 'Quỹ khẩn cấp')).toContainText('Đã hoàn thành')
  await expect(page.getByText('+5.750.000 ₫').first()).toBeVisible()
})

test('W5 + W7: đóng tháng 8 → tạo tháng 9 bằng sao chép → Ăn uống còn 3.150.000', async ({ page }) => {
  await setup(page, '2026-09-02')
  await goTo(page, 'Ngân sách')
  // Đang ở tháng 9 (chưa có ngân sách) → quay lại tháng 8 để đóng.
  await expect(page.getByText('Chưa có ngân sách cho tháng 09/2026')).toBeVisible()
  await page.getByRole('button', { name: 'Tháng trước' }).click()
  await page.getByRole('button', { name: 'Đóng tháng' }).click()
  const review = page.getByRole('dialog', { name: 'Tổng kết tháng 08/2026' })
  await expect(review).toContainText('12.250.000 ₫')
  await expect(review).toContainText('31,9%')
  await expect(review).toContainText('vượt 350.000 ₫')
  await expect(review).toContainText('43.250.000 ₫') // net worth cuối kỳ
  await review.getByRole('button', { name: 'Đóng tháng' }).click()
  await expect(review).toBeHidden()
  await expect(page.getByText('Tháng đã đóng — ngân sách được khóa.')).toBeVisible()

  const [snap] = await backend.rows(userId, `select month, net_worth from public.net_worth_snapshots where month = '2026-08'`)
  expect(snap).toEqual({ month: '2026-08', net_worth: 43_250_000 })

  await page.getByRole('button', { name: 'Tháng sau' }).click()
  await expect(line(page, 'Ăn uống')).toContainText('Đã chi 0 ₫ / 3.150.000 ₫')
  await expect(line(page, 'Ăn uống')).toContainText('gồm −350.000 ₫ từ tháng trước')
})

test('I10: tháng đã đóng không sửa được ngân sách; mở lại thì sửa được', async ({ page }) => {
  await setup(page, '2026-09-02')
  await backend.asUser(userId, (tx) => tx.query(`update public.budget_months set status = 'closed', closed_at = now() where month = '2026-08'`))
  await page.reload() // sửa DB sau lưng app → tải lại để bỏ cache
  await goTo(page, 'Ngân sách')
  await page.getByRole('button', { name: 'Tháng trước' }).click()
  await expect(line(page, 'Ăn uống')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Thêm dòng' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Mở lại tháng' }).click()
  await expect(line(page, 'Ăn uống')).toBeEnabled()
})

test('W5: tạo ngân sách theo 50/30/20 và thêm/sửa dòng', async ({ page }) => {
  await setup(page, '2026-09-02', false)
  await goTo(page, 'Ngân sách')
  await page.getByLabel('Thu nhập dự kiến').fill('20tr')
  await page.getByRole('radio', { name: /Theo quy tắc 50\/30\/20/ }).check()
  await page.getByRole('button', { name: 'Tạo ngân sách' }).click()
  await expect(page.getByText('Mọi đồng đã được giao việc ✓')).toBeVisible()
  await expect(line(page, 'Quỹ khẩn cấp')).toContainText('4.000.000 ₫') // 20%

  // Sửa một dòng → phần chưa phân bổ thay đổi đúng
  await line(page, 'Quỹ khẩn cấp').click()
  const dialog = page.getByRole('dialog', { name: 'Sửa dòng ngân sách' })
  await dialog.getByLabel('Kế hoạch tháng này').fill('3tr')
  await dialog.getByRole('button', { name: 'Lưu' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Hãy giao việc cho số tiền này')).toBeVisible()
  await expect(page.getByText('1.000.000 ₫').first()).toBeVisible()

  // Không cho đặt đồng thời cha và con — thêm nhóm "Tài chính" khi đã có con "Lãi vay"
  await page.getByRole('button', { name: 'Thêm dòng' }).click()
  const add = page.getByRole('dialog', { name: 'Thêm dòng ngân sách' })
  await selectByText(add.getByLabel('Danh mục'), 'Lãi vay')
  await add.getByLabel('Kế hoạch tháng này').fill('0')
  await add.getByRole('button', { name: 'Lưu' }).click()
  await expect(add).toBeHidden()
  await page.getByRole('button', { name: 'Thêm dòng' }).click()
  await selectByText(add.getByLabel('Danh mục'), 'Tài chính (cả nhóm)')
  await add.getByLabel('Kế hoạch tháng này').fill('100k')
  await add.getByRole('button', { name: 'Lưu' }).click()
  await expect(add.getByRole('alert')).toContainText('chỉ đặt ở một cấp')
})

test('W14 + W18 (E3): lương tự động hằng tháng — lỡ 3 kỳ vẫn đủ, mở lại không tạo trùng', async ({ page }) => {
  await setup(page, '2026-11-20')
  await goTo(page, 'Giao dịch')
  await page.getByRole('link', { name: 'Định kỳ' }).click()
  await page.getByRole('button', { name: 'Thêm định kỳ' }).click()
  const dialog = page.getByRole('dialog', { name: 'Thêm giao dịch định kỳ' })
  await dialog.getByLabel('Tên').fill('Lương')
  await dialog.getByRole('radio', { name: 'Thu' }).click()
  await dialog.getByLabel('Số tiền').fill('18tr')
  await selectByText(dialog.getByLabel('Danh mục'), 'Lương')
  await selectByText(dialog.getByLabel('Tài khoản'), 'Vietcombank')
  await dialog.getByLabel('Vào ngày').selectOption({ label: 'Ngày 5' })
  await dialog.getByLabel('Bắt đầu từ').fill('2026-09-01')
  await dialog.getByRole('button', { name: 'Lưu' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Quy tắc Lương' })).toContainText('Hằng tháng, ngày 5')

  // Mở lại app (tác vụ khởi động chạy): 05/09, 05/10, 05/11 được ghi.
  const salaries = async () =>
    (await backend.rows(userId, `select date from public.transactions where origin = 'recurring' order by date`)).map((r) => r.date)
  await page.reload()
  await expect.poll(salaries).toEqual(['2026-09-05', '2026-10-05', '2026-11-05'])
  await expect(page.getByRole('button', { name: 'Quy tắc Lương' })).toContainText('Lần tới: 05/12/2026')

  await page.reload()
  await page.waitForTimeout(1500)
  expect(await salaries()).toHaveLength(3)

  // Snapshot các tháng đã kết thúc đã có lương tương ứng.
  const snaps = await backend.rows(userId, `select month, net_worth from public.net_worth_snapshots order by month`)
  expect(snaps.map((s) => s.month)).toEqual(['2026-08', '2026-09', '2026-10'])
  expect(snaps[0]!.net_worth).toBe(43_250_000)
  expect(snaps[1]!.net_worth).toBe(43_250_000 + 18_000_000)
})

test('W14: quy tắc "cần xác nhận" — xác nhận một lần, bỏ qua một lần', async ({ page }) => {
  await setup(page, '2026-10-20')
  await backend.asUser(userId, async (tx) => {
    const [{ id: vcb }] = (await tx.query<{ id: string }>(`select id from public.accounts where name = 'Vietcombank'`)).rows as [{ id: string }]
    const [{ id: cat }] = (await tx.query<{ id: string }>(`select id from public.categories where name = 'Hóa đơn & tiện ích'`)).rows as [{ id: string }]
    const template = { type: 'expense', amount: 700_000, accountId: vcb, categoryId: cat, toAccountId: null, direction: null, note: 'Tiền điện', tags: [] }
    await tx.query(
      `insert into public.recurring_rules (name, template, frequency, interval_count, day_of_month, start_date, next_date, mode)
       values ('Tiền điện', $1::jsonb, 'monthly', 1, 15, '2026-09-15', '2026-09-15', 'confirm')`,
      [JSON.stringify(template)],
    )
  })
  await page.goto('/transactions/recurring')
  const pending = page.getByRole('region', { name: 'Chờ xác nhận' })
  await expect(pending.getByRole('listitem')).toHaveCount(2)
  await pending.getByRole('listitem').first().getByRole('button', { name: 'Xác nhận' }).click()
  await expect(pending.getByRole('listitem')).toHaveCount(1)
  await pending.getByRole('button', { name: 'Bỏ qua' }).click()
  await expect(pending).toHaveCount(0)
  const rows = await backend.rows(userId, `select date, amount from public.transactions where origin = 'recurring'`)
  expect(rows).toEqual([{ date: '2026-09-15', amount: 700_000 }])
})
