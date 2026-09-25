import { expect, test, type Page } from '@playwright/test'
import type { FakeBackend } from './fake-backend'
import { goTo, startApp } from './helpers'

// W19 — đăng ký / đăng nhập / quên mật khẩu / đăng xuất, mô phỏng như người dùng thật.
// Backend giả đang BẬT xác nhận email (như cấu hình khuyến nghị trên Supabase).

let backend: FakeBackend

test.beforeEach(async ({ page }) => {
  backend = await startApp(page, { autoConfirm: false })
  await backend.createUser('lan@example.com', 'matkhau123', { onboarded: true })
})

test.afterEach(async () => {
  await backend.close()
})

async function login(page: Page, email = 'lan@example.com', password = 'matkhau123') {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(password)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
}

test('chưa đăng nhập: mọi trang trong app chuyển về /login', async ({ page }) => {
  for (const path of ['/', '/budget', '/settings']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeVisible()
  }
})

test('form đăng nhập báo lỗi rõ ràng bằng tiếng Việt', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page.getByText('Nhập email', { exact: true })).toBeVisible()
  await expect(page.getByText('Nhập mật khẩu', { exact: true })).toBeVisible()

  await login(page, 'lan@example.com', 'sai-mat-khau')
  await expect(page.getByRole('alert')).toHaveText('Email hoặc mật khẩu không đúng')
  await expect(page).toHaveURL(/\/login$/)
})

test('đăng nhập → quay lại đúng trang muốn vào → điều hướng → đăng xuất', async ({ page, isMobile }) => {
  await page.goto('/budget')
  await expect(page).toHaveURL(/\/login$/)
  await login(page)

  await expect(page).toHaveURL(/\/budget$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Ngân sách' })).toBeVisible()

  // Tải lại trang vẫn giữ phiên đăng nhập.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Ngân sách' })).toBeVisible()

  await goTo(page, 'Giao dịch')
  await expect(page.getByRole('heading', { level: 1, name: 'Giao dịch' })).toBeVisible()

  // Điện thoại: email và nút Đăng xuất nằm ở chân menu ☰.
  if (isMobile) await page.getByRole('button', { name: 'Mở menu' }).click()
  await expect(page.getByText('lan@example.com').filter({ visible: true })).toBeVisible()
  await page.getByRole('button', { name: 'Đăng xuất' }).click()
  await expect(page).toHaveURL(/\/login$/)

  // Đã đăng xuất: không vào lại được app.
  await page.goto('/transactions')
  await expect(page).toHaveURL(/\/login$/)
})

test('mọi trang trong sơ đồ mở được sau khi đăng nhập, không lỗi console', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await page.goto('/login')
  await login(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible()

  const pages = [
    ['/budget', 'Ngân sách'],
    ['/transactions', 'Giao dịch'],
    ['/accounts', 'Tài khoản & quỹ'],
    ['/savings', 'Tiết kiệm'],
    ['/investments', 'Đầu tư'],
    ['/liabilities', 'Khoản nợ'],
    ['/reports', 'Báo cáo'],
    ['/what-if', 'Mô phỏng'],
    ['/settings', 'Cài đặt'],
  ] as const
  for (const [path, title] of pages) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  }
  expect(errors).toEqual([])
})

test('đăng ký: kiểm tra mật khẩu, email đã tồn tại, rồi màn hình chờ xác nhận email', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: 'Đăng ký' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Tạo tài khoản' })).toBeVisible()

  await page.getByLabel('Email').fill('mai@example.com')
  await page.getByLabel('Mật khẩu', { exact: true }).fill('1234567')
  await page.getByLabel('Nhập lại mật khẩu').fill('7654321')
  await page.getByRole('button', { name: 'Đăng ký' }).click()
  await expect(page.getByText('Mật khẩu tối thiểu 8 ký tự')).toBeVisible()
  await expect(page.getByText('Mật khẩu nhập lại không khớp')).toBeVisible()

  await page.getByLabel('Email').fill('lan@example.com') // đã tồn tại
  await page.getByLabel('Mật khẩu', { exact: true }).fill('matkhau-moi-123')
  await page.getByLabel('Nhập lại mật khẩu').fill('matkhau-moi-123')
  await page.getByRole('button', { name: 'Đăng ký' }).click()
  await expect(page.getByRole('alert')).toHaveText('Email này đã được đăng ký')

  await page.getByLabel('Email').fill('mai@example.com')
  await page.getByRole('button', { name: 'Đăng ký' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Kiểm tra email của bạn' })).toBeVisible()
  await expect(page.getByText('mai@example.com')).toBeVisible()

  const signup = backend.calls.find((c) => c.path.startsWith('/auth/v1/signup') && (c.body as { email: string }).email === 'mai@example.com')
  expect(signup?.path).toContain(encodeURIComponent('http://localhost:5173/'))
})

test('quên mật khẩu: gửi đường dẫn về đúng trang /reset-password', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: 'Quên mật khẩu?' }).click()
  await page.getByLabel('Email').fill('lan@example.com')
  await page.getByRole('button', { name: 'Gửi đường dẫn' }).click()
  await expect(page.getByRole('status')).toContainText('Nếu email này đã đăng ký')

  const recover = backend.calls.find((c) => c.path.startsWith('/auth/v1/recover'))
  expect(recover?.path).toContain(encodeURIComponent('http://localhost:5173/reset-password'))
})

test('mở /reset-password khi không có phiên → báo đường dẫn hết hạn', async ({ page }) => {
  await page.goto('/reset-password')
  await expect(page.getByRole('heading', { level: 1, name: 'Đường dẫn không hợp lệ' })).toBeVisible()
})

test('người dùng mới đăng nhập lần đầu → vào onboarding, không vào thẳng app', async ({ page }) => {
  await backend.createUser('moi@example.com', 'matkhau123')
  await page.goto('/login')
  await login(page, 'moi@example.com', 'matkhau123')
  await expect(page).toHaveURL(/\/onboarding$/)
  await page.goto('/transactions')
  await expect(page).toHaveURL(/\/onboarding$/)
})
