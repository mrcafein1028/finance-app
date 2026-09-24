import { useEffect, useId, useRef, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** Nút ở chân hộp thoại. */
  footer?: ReactNode
}

/**
 * Hộp thoại: bottom sheet trên điện thoại, căn giữa trên máy tính. Esc hoặc bấm nền để đóng,
 * focus vào ô nhập đầu tiên khi mở và trả focus về chỗ cũ khi đóng.
 */
export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // Giữ onClose mới nhất mà không chạy lại effect (tránh focus nhảy về ô đầu mỗi lần render).
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const first = panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button[role="radio"][aria-checked="true"]')
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previous?.focus?.()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 md:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface shadow-xl md:max-w-lg md:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-md px-2 py-1 text-xl leading-none text-muted hover:bg-canvas">
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}
