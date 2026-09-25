// "Thêm vào Màn hình chính": iPhone cần apple-touch-icon PNG; Android / Chrome cần manifest có icon.
import { expect, test } from '@playwright/test'

test('trang có apple-touch-icon, manifest và tên ngắn; mọi icon tải được đúng kích thước', async ({ page, request }) => {
  await page.goto('/login')
  const head = page.locator('head')
  await expect(head.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png')
  await expect(head.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Tài Chính')
  await expect(head.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')

  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest).toMatchObject({ short_name: 'Tài Chính', display: 'standalone', start_url: '/' })

  const icons: { src: string; sizes: string }[] = [{ src: '/apple-touch-icon.png', sizes: '180x180' }, ...manifest.icons]
  for (const icon of icons) {
    const res = await request.get(icon.src)
    expect(res.status(), icon.src).toBe(200)
    const png = await res.body()
    expect(png.subarray(1, 4).toString(), icon.src).toBe('PNG')
    // Chiều rộng / cao nằm ở byte 16–23 của khối IHDR.
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.src).toBe(icon.sizes)
  }
})
