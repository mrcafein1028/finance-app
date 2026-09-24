import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { ROUTES } from '../../app/routes'
import { useSettings } from '../../data/queries'
import { useAuth } from '../../features/auth/authContext'
import { applyTheme } from '../../lib/theme'
import { useStartupTasks } from '../../features/startup/useStartupTasks'
import { useTransactionDialog } from '../../features/transactions/transactionDialogContext'

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

/** Mobile: các trang không nằm trên thanh dưới (tiết kiệm, đầu tư, nợ, báo cáo, mô phỏng, cài đặt). */
function MoreMenu() {
  const { pathname } = useLocation()
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === pathname // chuyển trang → menu tự đóng
  const others = ROUTES.filter((r) => !r.mobile)
  const active = others.some((r) => pathname.startsWith(r.path))
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="more-menu"
        onClick={() => setOpenAt(open ? null : pathname)}
        className={`px-1 py-3 text-center text-xs font-medium ${active || open ? 'text-brand' : 'text-muted'}`}
      >
        Thêm
      </button>
      {open && (
        <div id="more-menu" className="absolute inset-x-0 bottom-full border-t border-border bg-surface p-2 shadow-lg">
          <ul aria-label="Trang khác" className="grid grid-cols-3 gap-1">
            {others.map((r) => (
              <li key={r.path}>
                <NavLink
                  to={r.path}
                  className={({ isActive }) => `block rounded-lg px-2 py-3 text-center text-sm font-medium ${isActive ? 'bg-brand text-brand-ink' : 'text-ink hover:bg-canvas'}`}
                >
                  {r.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
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

      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
        <p className="font-semibold">Tài Chính Cá Nhân</p>
        <SignOutButton />
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-24 md:px-8 md:pb-8">
        <Outlet />
      </main>

      {/* Nút "+" nổi: ghi giao dịch từ mọi trang — thao tác phổ biến nhất ≤ 3 chạm (docs/02 §5). */}
      <button
        type="button"
        onClick={() => dialog.openNew()}
        aria-label="Thêm giao dịch nhanh"
        className="fixed right-4 bottom-20 z-30 grid size-14 place-items-center rounded-full bg-brand text-3xl text-brand-ink shadow-lg hover:opacity-90 md:right-8 md:bottom-8"
      >
        +
      </button>

      <nav
        aria-label="Điều hướng nhanh"
        className="fixed inset-x-0 bottom-0 grid grid-cols-5 border-t border-border bg-surface md:hidden"
      >
        {ROUTES.filter((r) => r.mobile).map((r) => (
          <NavLink
            key={r.path}
            to={r.path}
            end={r.path === '/'}
            className={({ isActive }) =>
              `px-1 py-3 text-center text-xs font-medium ${isActive ? 'text-brand' : 'text-muted'}`
            }
          >
            {r.label}
          </NavLink>
        ))}
        <MoreMenu />
      </nav>
    </div>
  )
}
