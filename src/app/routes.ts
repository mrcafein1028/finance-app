/** Sơ đồ trang (docs/02 §5). `phase` = giai đoạn trong docs/09 đã hiện thực trang này. */
export interface AppRoute {
  path: string
  label: string
  phase: number
  /** Nhóm trong menu điện thoại; không có nhóm → nằm ở chân menu (Cài đặt). */
  group?: RouteGroup
}

export const ROUTE_GROUPS = ['Hằng ngày', 'Tài sản & nợ', 'Phân tích'] as const
export type RouteGroup = (typeof ROUTE_GROUPS)[number]

export const ROUTES: AppRoute[] = [
  { path: '/', label: 'Tổng quan', phase: 6, group: 'Hằng ngày' },
  { path: '/budget', label: 'Ngân sách', phase: 4, group: 'Hằng ngày' },
  { path: '/transactions', label: 'Giao dịch', phase: 3, group: 'Hằng ngày' },
  { path: '/accounts', label: 'Tài khoản & quỹ', phase: 3, group: 'Hằng ngày' },
  { path: '/savings', label: 'Tiết kiệm', phase: 5, group: 'Tài sản & nợ' },
  { path: '/investments', label: 'Đầu tư', phase: 5, group: 'Tài sản & nợ' },
  { path: '/liabilities', label: 'Khoản nợ', phase: 5, group: 'Tài sản & nợ' },
  { path: '/reports', label: 'Báo cáo', phase: 6, group: 'Phân tích' },
  { path: '/what-if', label: 'Mô phỏng', phase: 6, group: 'Phân tích' },
  { path: '/settings', label: 'Cài đặt', phase: 7 },
]

/** Trang đang mở (kể cả trang con như /accounts/:id, /transactions/recurring). */
export function routeOf(pathname: string): AppRoute | undefined {
  if (pathname === '/') return ROUTES[0]
  return ROUTES.filter((r) => r.path !== '/' && (pathname === r.path || pathname.startsWith(`${r.path}/`))).sort((a, b) => b.path.length - a.path.length)[0]
}
