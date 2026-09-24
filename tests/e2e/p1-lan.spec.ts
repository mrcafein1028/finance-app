// Kịch bản P1 — Lan (docs/08 §2): một người dùng thật đi từ đăng ký → onboarding → ghi toàn bộ
// giao dịch tháng 8 qua giao diện → số dư và tổng kết khớp từng đồng với bảng kỳ vọng.
import { expect, test } from '@playwright/test'
import { accountRow, addTransaction, fillTransaction, startApp, type TxInput, goTo } from './helpers'

const AUGUST: TxInput[] = [
  { type: 'Thu', amount: '18tr', category: 'Lương', account: 'Vietcombank', date: '2026-08-05', note: 'Lương tháng 8' },
  { amount: '5tr', category: 'Nhà ở', account: 'Vietcombank', date: '2026-08-05' },
  { type: 'Chuyển', amount: '3tr', account: 'Vietcombank', to: 'Quỹ khẩn cấp', date: '2026-08-06' },
  { type: 'Chuyển', amount: '2tr', account: 'Vietcombank', to: 'Tiền mặt', date: '2026-08-07' },
  { type: 'Chuyển', amount: '1tr', account: 'Vietcombank', to: 'MoMo', date: '2026-08-07' },
  { amount: '900k', category: 'Ăn uống', account: 'Tiền mặt', date: '2026-08-08' },
  { amount: '300k', category: 'Đi lại', account: 'MoMo', date: '2026-08-09' },
  { amount: '800.000', category: 'Ăn uống', account: 'Tiền mặt', date: '2026-08-15' },
  { amount: '1,2tr', category: 'Mua sắm', account: 'Vietcombank', date: '2026-08-15' },
  { amount: '600k', category: 'Giải trí', account: 'Vietcombank', date: '2026-08-16' },
  { type: 'Hoàn tiền', amount: '200k', category: 'Mua sắm', account: 'Vietcombank', date: '2026-08-18' },
  { amount: '700k', category: 'Hóa đơn & tiện ích', account: 'Vietcombank', date: '2026-08-20' },
  { amount: '900000', category: 'Ăn uống', account: 'Tiền mặt', date: '2026-08-22' },
  { amount: '300k', category: 'Đi lại', account: 'MoMo', date: '2026-08-23' },
  { amount: '1.250.000', category: 'Ăn uống', account: 'Vietcombank', date: '2026-08-28' },
  { amount: '500k', category: 'Giải trí', account: 'Vietcombank', date: '2026-08-30' },
]

async function addAccount(page: import('@playwright/test').Page, kind: string, name: string, balance: string, extra: { goal?: string; emergency?: boolean } = {}) {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Loại tài khoản').selectOption({ label: kind })
  await dialog.getByLabel('Tên').fill(name)
  await dialog.getByLabel(/Số dư hiện tại|Số tiền hiện có/).fill(balance)
  await dialog.getByLabel('Tính từ ngày').fill('2026-08-01')
  if (extra.goal) await dialog.getByLabel('Mục tiêu').fill(extra.goal)
  if (extra.emergency) await dialog.getByLabel('Đây là quỹ khẩn cấp').check()
  await dialog.getByRole('button', { name: 'Lưu' }).click()
  await expect(dialog).toBeHidden()
}

test('P1 Lan: đăng ký → onboarding → ghi tháng 8 → số liệu khớp docs/08', async ({ page }) => {
  test.setTimeout(180_000)
  const backend = await startApp(page)

  // --- W19 đăng ký (backend tự xác nhận email) ---
  await page.goto('/signup')
  await page.getByLabel('Email').fill('lan@example.com')
  await page.getByLabel('Mật khẩu', { exact: true }).fill('matkhau123')
  await page.getByLabel('Nhập lại mật khẩu').fill('matkhau123')
  await page.getByRole('button', { name: 'Đăng ký' }).click()

  // --- W0 onboarding ---
  await expect(page).toHaveURL(/\/onboarding$/)
  await page.getByRole('button', { name: 'Bắt đầu' }).click()
  await expect(page.getByRole('heading', { name: 'Cài đặt cơ bản' })).toBeVisible()
  await expect(page.getByRole('radio', { name: /Zero-based/ })).toBeChecked() // mặc định G6
  await page.getByRole('button', { name: 'Tiếp tục' }).click()
  await expect(page.getByRole('heading', { name: 'Danh mục thu chi' })).toBeVisible()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()

  await expect(page.getByRole('heading', { name: 'Tài khoản tiền' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled() // cần ít nhất 1 tài khoản
  await page.getByRole('button', { name: '+ Thêm tài khoản' }).click()
  await addAccount(page, 'Tài khoản ngân hàng', 'Vietcombank', '25tr')
  await page.getByRole('button', { name: '+ Thêm tài khoản' }).click()
  await addAccount(page, 'Tiền mặt', 'Tiền mặt', '2.000.000')
  await page.getByRole('button', { name: '+ Thêm tài khoản' }).click()
  await addAccount(page, 'Ví điện tử', 'MoMo', '500k')
  const added = page.getByRole('list', { name: 'Tài khoản đã thêm' })
  await expect(added.getByRole('listitem')).toHaveCount(3)
  await page.getByRole('button', { name: 'Tiếp tục' }).click()

  await expect(page.getByRole('heading', { name: 'Quỹ khẩn cấp' })).toBeVisible()
  await page.getByRole('button', { name: '+ Thêm quỹ' }).click()
  await addAccount(page, 'Quỹ mục tiêu', 'Quỹ khẩn cấp', '10tr', { goal: '60tr', emergency: true })
  await page.getByRole('button', { name: 'Tiếp tục' }).click()

  await expect(page.getByRole('heading', { name: 'Thu nhập hằng tháng' })).toBeVisible()
  await page.getByLabel('Thu nhập dự kiến mỗi tháng').fill('18tr')
  await expect(page.getByText('9.000.000 ₫')).toBeVisible() // gợi ý 50%
  await page.getByRole('button', { name: 'Tiếp tục' }).click()
  await page.getByRole('button', { name: 'Vào ứng dụng' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible()

  // Dữ liệu onboarding đã nằm đúng trong Postgres.
  const [user] = await backend.db.query<{ id: string }>(`select id from auth.users where email = 'lan@example.com'`).then((r) => r.rows)
  const [settings] = await backend.rows(user!.id, 'select default_budget_mode, onboarding_completed from public.settings')
  expect(settings).toEqual({ default_budget_mode: 'zero_based', onboarding_completed: true })
  const [budget] = await backend.rows(user!.id, 'select month, expected_income from public.budget_months')
  expect(budget).toEqual({ month: '2026-08', expected_income: 18_000_000 })

  // --- Thiết lập: net worth 37.500.000 ---
  await goTo(page, 'Tài khoản & quỹ')
  await expect(page.getByText('Tổng tiền đang có: 37.500.000 ₫')).toBeVisible()

  // --- W1/W2: ghi 16 giao dịch tháng 8 qua nút "+" ---
  for (const tx of AUGUST) await addTransaction(page, tx)

  // --- Kỳ vọng cuối tháng 8 ---
  await goTo(page, 'Tài khoản & quỹ')
  await expect(accountRow(page, 'Vietcombank')).toContainText('27.950.000 ₫')
  await expect(accountRow(page, 'Tiền mặt')).toContainText('1.400.000 ₫')
  await expect(accountRow(page, 'MoMo')).toContainText('900.000 ₫')
  await expect(accountRow(page, 'Quỹ khẩn cấp')).toContainText('13.000.000 ₫')
  await expect(accountRow(page, 'Quỹ khẩn cấp')).toContainText('22% mục tiêu')
  await expect(page.getByText('Tổng tiền đang có: 43.250.000 ₫')).toBeVisible()

  await goTo(page, 'Giao dịch')
  await expect(page.getByText('Tháng 08/2026')).toBeVisible()
  const summary = page.locator('dl')
  await expect(summary).toContainText('18.000.000 ₫')
  await expect(summary).toContainText('12.250.000 ₫')
  await expect(summary).toContainText('+5.750.000 ₫')

  // Postgres cũng có đúng 16 giao dịch.
  const [count] = await backend.rows(user!.id, 'select count(*)::int as n from public.transactions')
  expect(count!.n).toBe(16)

  // --- "Tiếp tục tháng 9" (docs/08 §2): các lỗi phải bị chặn với thông báo rõ ràng ---
  let dialog = await fillTransaction(page, { amount: '150k', category: 'Ăn uống', account: 'Tiền mặt', date: '2026-07-31' })
  await expect(dialog.getByText('Ngày phải từ 01/08/2026 (ngày bắt đầu theo dõi "Tiền mặt")')).toBeVisible()
  await dialog.getByRole('button', { name: 'Hủy' }).click()

  dialog = await fillTransaction(page, { amount: '20tr', category: 'Ăn uống', account: 'Tiền mặt', date: '2026-08-31' })
  await expect(dialog.getByText('Tiền mặt "Tiền mặt" sẽ bị âm 18.600.000 ₫')).toBeVisible()
  await dialog.getByRole('button', { name: 'Hủy' }).click()
  expect((await backend.rows(user!.id, 'select count(*)::int as n from public.transactions'))[0]!.n).toBe(16)
})
