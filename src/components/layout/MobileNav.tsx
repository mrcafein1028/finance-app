import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { ROUTE_GROUPS, ROUTES, routeOf, type AppRoute } from '../../app/routes'
import { useAuth } from '../../features/auth/authContext'

// Điều hướng trên điện thoại: thanh tiêu đề dính đầu trang + nút ☰ ở góc trái (cùng phía với thanh bên
// của bản máy tính, để ngăn menu chính là "thanh bên trượt ra"). Ngăn menu trượt từ trái, NẰM DƯỚI
// thanh tiêu đề → nút ☰ biến thành ✕ ngay tại chỗ, người dùng bấm lại đúng chỗ đó để đóng.
//
// Chuyển động: mở 320 ms theo đường cong giảm tốc kiểu iOS (nhanh lúc đầu, êm lúc dừng); các mục hiện
// lần lượt cách nhau 25 ms; đóng nhanh hơn (200 ms, không xếp tầng) vì người dùng đã chọn xong.
// prefers-reduced-motion → không chuyển động (motion-reduce:*).

const EASE_OUT = 'ease-[cubic-bezier(0.32,0.72,0,1)]'

function HamburgerIcon({ open }: { open: boolean }) {
  const bar = `absolute left-0 h-0.5 w-5 rounded-full bg-current transition-all duration-300 ${EASE_OUT} motion-reduce:transition-none`
  return (
    <span aria-hidden className="relative block h-3.5 w-5">
      <span className={`${bar} ${open ? 'top-1.5 rotate-45' : 'top-0'}`} />
      <span className={`${bar} top-1.5 ${open ? 'scale-x-0 opacity-0' : ''}`} />
      <span className={`${bar} ${open ? 'top-1.5 -rotate-45' : 'top-3'}`} />
    </span>
  )
}

export function MobileNav() {
  const { pathname } = useLocation()
  const { user, signOut } = useAuth()
  // Ghi lại trang lúc mở: chuyển sang trang khác thì menu tự đóng (không cần effect đặt state).
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === pathname
  const toggleRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const current = routeOf(pathname)

  const close = (returnFocus = true) => {
    setOpenAt(null)
    if (returnFocus) toggleRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    // Khóa cuộn trang phía sau, đưa con trỏ bàn phím vào menu, Esc để đóng.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.querySelector<HTMLElement>('a[aria-current="page"], a')?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenAt(null)
        toggleRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Xếp tầng: mỗi mục (và tiêu đề nhóm, cùng nhịp với mục đầu của nhóm) hiện sau mục trước 25 ms.
  let order = 0
  const reveal = (delay: number) => ({
    style: { transitionDelay: `${open ? delay : 0}ms` },
    className: `transition-all duration-300 ${EASE_OUT} motion-reduce:transition-none ${open ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0'}`,
  })
  const nextDelay = () => 70 + order++ * 25
  const item = (r: AppRoute) => {
    const { style, className } = reveal(nextDelay())
    return (
      <li key={r.path} style={style} className={className}>
        <NavLink
          to={r.path}
          end={r.path === '/'}
          onClick={() => close(false)}
          className={({ isActive }) =>
            `flex min-h-12 items-center rounded-xl px-4 text-base font-medium transition-colors ${isActive ? 'bg-brand text-brand-ink' : 'text-ink active:bg-canvas'}`
          }
        >
          {r.label}
        </NavLink>
      </li>
    )
  }

  return (
    <div className="sticky top-0 z-50 md:hidden">
      <header className="flex h-[calc(3.5rem+env(safe-area-inset-top,0px))] items-center gap-2 border-b border-border bg-surface/95 px-2 pt-[env(safe-area-inset-top,0px)] backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <button
          ref={toggleRef}
          type="button"
          aria-label={open ? 'Đóng menu' : 'Mở menu'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => (open ? close() : setOpenAt(pathname))}
          className="grid size-11 place-items-center rounded-xl text-ink transition-colors active:bg-canvas"
        >
          <HamburgerIcon open={open} />
        </button>
        <p className="min-w-0 flex-1 truncate">
          <span className="font-semibold">{current?.label ?? 'Tài Chính Cá Nhân'}</span>
        </p>
      </header>

      {/* Nền tối phía sau — bấm để đóng. Nằm dưới thanh tiêu đề để nút ✕ luôn bấm được. */}
      <div
        aria-hidden
        onClick={() => close()}
        className={`fixed inset-x-0 bottom-0 top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-40 bg-black/40 transition-opacity motion-reduce:transition-none ${open ? 'opacity-100 duration-300' : 'pointer-events-none opacity-0 duration-200'}`}
      />

      <div
        ref={panelRef}
        id="mobile-menu"
        inert={!open}
        aria-hidden={!open}
        className={`fixed bottom-0 left-0 top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-40 flex w-[min(20rem,85vw)] flex-col border-r border-border bg-surface shadow-2xl transition-transform motion-reduce:transition-none ${
          open ? `translate-x-0 duration-300 ${EASE_OUT}` : '-translate-x-full duration-200 ease-in'
        }`}
      >
        <nav aria-label="Menu điều hướng" className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
          {ROUTE_GROUPS.map((group) => (
            <section key={group} className="mb-4">
              <h2 style={reveal(70 + order * 25).style} className={`mb-1 px-4 text-xs font-semibold tracking-wide text-muted uppercase ${reveal(0).className}`}>
                {group}
              </h2>
              <ul className="flex flex-col gap-0.5">{ROUTES.filter((r) => r.group === group).map(item)}</ul>
            </section>
          ))}
          <ul className="flex flex-col gap-0.5 border-t border-border pt-3">{ROUTES.filter((r) => !r.group).map(item)}</ul>
        </nav>
        <div className="flex items-center justify-between gap-3 border-t border-border px-7 py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <p className="min-w-0 truncate text-sm text-muted" title={user?.email}>
            {user?.email}
          </p>
          <button type="button" onClick={() => void signOut()} className="shrink-0 text-sm font-medium text-negative">
            Đăng xuất
          </button>
        </div>
      </div>
    </div>
  )
}
