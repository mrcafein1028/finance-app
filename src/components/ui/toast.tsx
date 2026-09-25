import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastOptions } from './toastContext'

interface ToastItem extends ToastOptions {
  id: number
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), [])
  const show = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++
      setItems((list) => [...list.slice(-2), { ...options, id }])
      window.setTimeout(() => dismiss(id), options.durationMs ?? 5000)
    },
    [dismiss],
  )

  const colors = { success: 'border-positive/50', warning: 'border-warning/60', error: 'border-negative/60', info: 'border-border' }
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border-l-4 bg-ink px-4 py-3 text-sm text-canvas shadow-lg ${colors[t.tone ?? 'success']}`}
          >
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="font-semibold text-brand underline-offset-2 hover:underline"
                onClick={async () => {
                  dismiss(t.id)
                  await t.action!.onClick()
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
