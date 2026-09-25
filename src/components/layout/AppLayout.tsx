import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router'
import { ROUTES } from '../../app/routes'
import { useSettings } from '../../data/queries'
import { useAuth } from '../../features/auth/authContext'
import { applyTheme } from '../../lib/theme'
import { useStartupTasks } from '../../features/startup/useStartupTasks'
import { useTransactionDialog } from '../../features/transactions/transactionDialogContext'
import { MobileNav } from './MobileNav'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-canvas hover:text-ink'
  }`

function SignOutButton({ className = '' }: { className?: string }) {
  const { signOut } = useAuth()
  return (
    <button type="button" onClick={() => void signOut()} className={`text-sm font-medium text-muted hover:text-ink ${className}`}>
      Đăng xuất
    </button>
  )
}

export function AppLayout() {
  const { user } = useAuth()
  const dialog = useTransactionDialog()
  useStartupTasks()
  const theme = useSettings().data?.theme
  useEffect(() => {
    if (theme) applyTheme(theme)
  }, [theme])

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]">
      <aside className="hidden border-r border-border bg-surface p-4 md:flex md:flex-col">
        <p className="mb-6 px-3 text-lg font-semibold">Tài Chính Cá Nhân</p>
        <nav aria-label="Điều hướng chính" className="flex flex-col gap-1">
          {ROUTES.map((r) => (
            <NavLink key={r.path} to={r.path} end={r.path === '/'} className={linkClass}>
              {r.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-border px-3 pt-4">
          <p className="truncate text-sm" title={user?.email}>
            {user?.email}
          </p>
          <SignOutButton className="mt-1" />
        </div>
      </aside>

      <MobileNav />

      <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-28 md:px-8 md:pb-8">
        <Outlet />
      </main>

      {/* Nút "+" nổi: ghi giao dịch từ mọi trang — thao tác phổ biến nhất ≤ 3 chạm (docs/02 §5). */}
      <button
        type="button"
        onClick={() => dialog.openNew()}
        aria-label="Thêm giao dịch nhanh"
        className="fixed right-4 bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] z-30 grid size-14 place-items-center rounded-full bg-brand text-3xl text-brand-ink shadow-lg hover:opacity-90 md:right-8 md:bottom-8"
      >
        +
      </button>

    </div>
  )
}
