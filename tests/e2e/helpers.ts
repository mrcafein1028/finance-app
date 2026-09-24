import { expect, type Locator, type Page } from '@playwright/test'
import { buildBackup, toReplacePayload } from '../../src/data/backup'
import { DEFAULT_SETTINGS } from '../../src/data/repositories'
import { budgetTargetKey, TABLE_NAMES, type BudgetTarget, type TableName } from '../../src/schemas'
import { FakeBackend } from './fake-backend'

/** Ngày "hôm nay" trong kịch bản P1: cuối tháng 8/2026, giờ Việt Nam. */
export const P1_TODAY = new Date('2026-08-31T10:00:00+07:00')

export async function startApp(page: Page, { today = P1_TODAY, autoConfirm = true } = {}) {
  const backend = await FakeBackend.create({ autoConfirm })
  await page.clock.setFixedTime(today)
  await backend.install(page)
  return backend
}

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(password)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
}

/** Chọn option theo phần đầu nhãn (nhãn tài khoản kèm số dư thay đổi theo thời gian). */
export async function selectByText(select: Locator, text: string) {
  const options = select.locator('option')
  const count = await options.count()
  for (let i = 0; i < count; i++) {
    const option = options.nth(i)
    const label = ((await option.textContent()) ?? '').trim()
    if (label === text || label.startsWith(`${text} ·`)) {
      await select.selectOption(await option.getAttribute('value'))
      return
    }
  }
  throw new Error(`Không có lựa chọn "${text}"`)
}

export interface TxInput {
  type?: 'Chi' | 'Thu' | 'Chuyển' | 'Hoàn tiền'
  amount: string
  category?: string
  account: string
  to?: string
  date: string
  note?: string
}

/** Người dùng bấm nút "+" và ghi một giao dịch (W1/W2). Trả về hộp thoại để kiểm tra lỗi nếu có. */
export async function fillTransaction(page: Page, tx: TxInput) {
  await page.getByRole('button', { name: 'Thêm giao dịch nhanh' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  if (tx.type && tx.type !== 'Chi') await dialog.getByRole('radio', { name: tx.type }).click()
  await dialog.getByLabel('Số tiền').fill(tx.amount)
  if (tx.type === 'Chuyển') {
    await selectByText(dialog.getByLabel('Từ tài khoản'), tx.account)
    await selectByText(dialog.getByLabel('Đến tài khoản'), tx.to!)
  } else {
    await selectByText(dialog.getByLabel('Danh mục'), tx.category!)
    await selectByText(dialog.getByLabel('Tài khoản', { exact: true }), tx.account)
  }
  await dialog.getByLabel('Ngày').fill(tx.date)
  if (tx.note) await dialog.getByLabel('Ghi chú').fill(tx.note)
  await dialog.getByRole('button', { name: 'Lưu' }).click()
  return dialog
}

export async function addTransaction(page: Page, tx: TxInput) {
  const dialog = await fillTransaction(page, tx)
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: 'Đã lưu' }).last()).toBeVisible()
}

/** Số dư hiển thị của một tài khoản trên trang Tài khoản & quỹ. */
export function accountRow(page: Page, name: string) {
  return page.getByRole('link').filter({ hasText: name })
}

/**
 * Nạp sẵn dữ liệu một persona (docs/08) qua đúng đường khôi phục sao lưu (hàm SQL replace_all_data).
 * Id dạng chữ trong fixture ('vcb', 'tx-0001') được đổi sang uuid.
 */
export async function seedData(backend: FakeBackend, userId: string, data: Partial<Record<TableName, object[]>>) {
  const ids = new Map<string, string>()
  const uuid = /^[0-9a-f-]{36}$/
  const mapId = (v: unknown) => (typeof v === 'string' && v && !uuid.test(v) ? (ids.get(v) ?? (ids.set(v, crypto.randomUUID()), ids.get(v)!)) : v)
  const ID_FIELDS = ['id', 'accountId', 'toAccountId', 'categoryId', 'groupId', 'holdingId', 'cashAccountId', 'payoutAccountId']
  const remap = (row: object): object =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, ID_FIELDS.includes(k) ? mapId(v) : v && typeof v === 'object' && !Array.isArray(v) ? remap(v) : v]),
    )
  const full = Object.fromEntries(TABLE_NAMES.map((t) => [t, (data[t] ?? []).map(remap)])) as Record<TableName, object[]>
  // targetKey suy ra từ target — tính lại sau khi đổi id.
  full.budgetLines = full.budgetLines.map((l) => ({ ...l, targetKey: budgetTargetKey((l as { target: BudgetTarget }).target) }))
  if (full.settings.length === 0) full.settings = [{ ...DEFAULT_SETTINGS, onboardingCompleted: true }]
  const backup = buildBackup(full as never)
  await backend.asUser(userId, (tx) => tx.query('select public.replace_all_data($1::jsonb)', [JSON.stringify(toReplacePayload(backup))]))
  return ids
}

/** Mở một trang qua thanh điều hướng như người dùng thật: thanh bên (desktop) hoặc thanh dưới + "Thêm" (mobile). */
export async function goTo(page: Page, label: string) {
  if ((page.viewportSize()?.width ?? 1280) >= 768) {
    return page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: label, exact: true }).click()
  }
  const quick = page.getByRole('navigation', { name: 'Điều hướng nhanh' })
  await expect(quick).toBeVisible() // vừa tải lại trang: đợi khung app hiện rồi mới xét
  const direct = quick.getByRole('link', { name: label, exact: true })
  if (await direct.count()) return direct.click()
  await quick.getByRole('button', { name: 'Thêm' }).click()
  await quick.getByRole('list', { name: 'Trang khác' }).getByRole('link', { name: label, exact: true }).click()
}
