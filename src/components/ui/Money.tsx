import { formatMoney } from '../../lib/format'

/**
 * Số tiền hiển thị: thẳng cột, có dấu +/− khi cần, màu chỉ là phụ (không dùng màu làm tín hiệu duy nhất — docs/07 §4).
 * `tone="auto"`: dương xanh, âm cam.
 */
export function Money({ value, sign = false, tone = 'none', className = '' }: { value: number; sign?: boolean; tone?: 'none' | 'auto' | 'income' | 'expense'; className?: string }) {
  const color =
    tone === 'income' ? 'text-positive' : tone === 'expense' ? 'text-negative' : tone === 'auto' ? (value < 0 ? 'text-negative' : value > 0 ? 'text-positive' : '') : ''
  return <span className={`tabular whitespace-nowrap ${color} ${className}`}>{formatMoney(value, { sign })}</span>
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  )
}

export function LoadingState() {
  return (
    <p role="status" className="py-10 text-center text-muted">
      Đang tải…
    </p>
  )
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div role="alert" className="rounded-xl border border-negative/40 px-4 py-3 text-sm text-negative">
      Không tải được dữ liệu: {error instanceof Error ? error.message : 'lỗi không xác định'}
    </div>
  )
}
