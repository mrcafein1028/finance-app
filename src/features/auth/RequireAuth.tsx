import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from './authContext'

/** Chỉ hiển thị nội dung khi đã đăng nhập; chưa đăng nhập → /login (nhớ trang đang muốn vào). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, isPasswordRecovery } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div role="status" className="grid min-h-dvh place-items-center text-muted">
        Đang tải…
      </div>
    )
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  // Mở đường dẫn đặt lại mật khẩu → phải đặt mật khẩu mới trước khi dùng app.
  if (isPasswordRecovery) return <Navigate to="/reset-password" replace />
  return children
}

/** Trang đăng nhập/đăng ký: đã đăng nhập rồi thì chuyển thẳng vào app. */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return null
  if (session) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />
  }
  return children
}
