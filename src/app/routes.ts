/** Sơ đồ trang (docs/02 §5). `phase` = giai đoạn trong docs/09 sẽ hiện thực trang này. */
export interface AppRoute {
  path: string
  label: string
  phase: number
  /** Hiện trên thanh điều hướng dưới của mobile (4 mục + nút "Thêm" chứa các trang còn lại). */
  mobile?: boolean
}

export const ROUTES: AppRoute[] = [
  { path: '/', label: 'Tổng quan', phase: 6, mobile: true },
  { path: '/budget', label: 'Ngân sách', phase: 4, mobile: true },
  { path: '/transactions', label: 'Giao dịch', phase: 3, mobile: true },
  { path: '/accounts', label: 'Tài khoản & quỹ', phase: 3, mobile: true },
  { path: '/savings', label: 'Tiết kiệm', phase: 5 },
  { path: '/investments', label: 'Đầu tư', phase: 5 },
  { path: '/liabilities', label: 'Khoản nợ', phase: 5 },
  { path: '/reports', label: 'Báo cáo', phase: 6 },
  { path: '/what-if', label: 'Mô phỏng', phase: 6 },
  { path: '/settings', label: 'Cài đặt', phase: 7 },
]
