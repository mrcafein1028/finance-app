import { createContext, useContext } from 'react'

export interface ToastOptions {
  message: string
  tone?: 'success' | 'warning' | 'error' | 'info'
  /** Nút hành động, VD "Hoàn tác". */
  action?: { label: string; onClick: () => void | Promise<void> }
  /** Mặc định 5 giây (đủ để bấm Hoàn tác — docs/05 W1). */
  durationMs?: number
}

export const ToastContext = createContext<((options: ToastOptions) => void) | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast() phải nằm trong <ToastProvider>')
  return ctx
}
