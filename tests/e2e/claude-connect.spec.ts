// Kết nối Claude (custom connector qua MCP): trang đồng ý OAuth và quản lý quyền trong Cài đặt.
// Backend giả đóng vai Supabase OAuth 2.1 server: tạo yêu cầu cấp quyền như khi Claude gọi /oauth/authorize.
import { expect, test, type Page } from '@playwright/test'
import type { FakeBackend } from './fake-backend'
import { goTo, login, startApp } from './helpers'

const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
let backend: FakeBackend

test.afterEach(async () => {
  await backend.close()
})

/** Chặn trang callback của claude.ai (không ra Internet thật) và ghi lại địa chỉ được chuyển tới. */
async function stubClaude(page: Page) {
  await page.route('https://claude.ai/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Claude callback</h1>' }))
}

test('Claude xin quyền → đăng nhập → Cho phép → quay về Claude kèm mã; Cài đặt thấy và thu hồi được', async ({ page, baseURL }) => {
  backend = await startApp(page)
  const userId = await backend.createUser('lan@example.com', 'matkhau123', { onboarded: true })
  await stubClaude(page)
  const { authorizationId, clientId } = backend.createAuthorizationRequest({ name: 'Claude' }, CLAUDE_CALLBACK)

  // Chưa đăng nhập: đường dẫn từ Supabase → trang đăng nhập → đăng nhập xong quay lại đúng yêu cầu.
  await page.goto(`/oauth/consent?authorization_id=${authorizationId}`)
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Email').fill('lan@example.com')
  await page.getByLabel('Mật khẩu').fill('matkhau123')
  await page.getByRole('button', { name: 'Đăng nhập' }).click()

  await expect(page.getByRole('heading', { name: 'Cho phép truy cập' })).toBeVisible()
  await expect(page.getByText('Claude muốn truy cập dữ liệu Tài Chính Cá Nhân của bạn.')).toBeVisible()
  await expect(page.getByText('Đang đăng nhập: lan@example.com')).toBeVisible()
  await expect(page.getByText('claude.ai', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0) // địa chỉ quay về đáng tin → không cảnh báo

  await page.getByRole('button', { name: 'Cho phép' }).click()
  await expect(page).toHaveURL(new RegExp(`^${CLAUDE_CALLBACK}\\?code=code-${authorizationId}&state=`))
  expect(backend.oauthGrants.get(userId)?.has(clientId)).toBe(true)

  // Cài đặt → Kết nối Claude: địa chỉ máy chủ + ứng dụng đang có quyền.
  await page.goto('/')
  await goTo(page, 'Cài đặt')
  const section = page.getByRole('region', { name: 'Kết nối Claude' })
  await expect(section.getByLabel('Địa chỉ máy chủ (dán vào Claude)')).toHaveValue(`${new URL(baseURL!).origin}/api/mcp`)
  const list = section.getByRole('list', { name: 'Ứng dụng đang có quyền' })
  await expect(list).toContainText('Claude')
  await list.getByRole('button', { name: 'Thu hồi' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Đã thu hồi quyền của "Claude"' })).toBeVisible()
  await expect(section.getByText('Chưa có ứng dụng nào.')).toBeVisible()
  expect(backend.oauthGrants.get(userId)?.has(clientId)).toBe(false)
})

test('Từ chối → quay về Claude với access_denied, không cấp quyền', async ({ page }) => {
  backend = await startApp(page)
  const userId = await backend.createUser('lan@example.com', 'matkhau123', { onboarded: true })
  await stubClaude(page)
  const { authorizationId } = backend.createAuthorizationRequest({ name: 'Claude' }, CLAUDE_CALLBACK)
  await login(page, 'lan@example.com', 'matkhau123')
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible()
  await page.goto(`/oauth/consent?authorization_id=${authorizationId}`)
  await page.getByRole('button', { name: 'Từ chối' }).click()
  await expect(page).toHaveURL(/auth_callback\?error=access_denied&state=/)
  expect(backend.oauthGrants.get(userId)?.size ?? 0).toBe(0)
})

test('ứng dụng lạ quay về địa chỉ không phải Claude → cảnh báo rõ; yêu cầu hỏng → báo lỗi dễ hiểu', async ({ page }) => {
  backend = await startApp(page)
  await backend.createUser('lan@example.com', 'matkhau123', { onboarded: true })
  const { authorizationId } = backend.createAuthorizationRequest({ name: 'Trợ lý Lạ' }, 'https://evil.example/callback')
  await login(page, 'lan@example.com', 'matkhau123')
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible()

  await page.goto(`/oauth/consent?authorization_id=${authorizationId}`)
  await expect(page.getByText('evil.example', { exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Đây không phải địa chỉ của Claude' })).toBeVisible()

  await page.goto('/oauth/consent?authorization_id=khong-ton-tai')
  await expect(page.getByRole('heading', { name: 'Không đọc được yêu cầu' })).toBeVisible()
  await page.goto('/oauth/consent')
  await expect(page.getByRole('heading', { name: 'Thiếu yêu cầu cấp quyền' })).toBeVisible()
})
