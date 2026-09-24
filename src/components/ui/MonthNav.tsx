import { nextMonth, periodRange, previousMonth } from '../../domain/period'
import { formatDate, monthLabel } from '../../lib/format'
import { Button } from './form'

/** Chọn kỳ ngân sách: ‹ Tháng 08/2026 ›, kèm khoảng ngày nếu kỳ không bắt đầu ngày 1. */
export function MonthNav({ month, startDay, onChange }: { month: string; startDay: number; onChange: (month: string) => void }) {
  const range = periodRange(month, startDay)
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-2 py-1">
      <Button variant="ghost" aria-label="Tháng trước" onClick={() => onChange(previousMonth(month))}>
        ‹
      </Button>
      <p className="text-center">
        <span className="font-medium">{monthLabel(month)}</span>
        {startDay !== 1 && (
          <span className="block text-xs text-muted">
            {formatDate(range.start)} – {formatDate(range.end)}
          </span>
        )}
      </p>
      <Button variant="ghost" aria-label="Tháng sau" onClick={() => onChange(nextMonth(month))}>
        ›
      </Button>
    </div>
  )
}

/**
 * Thanh tiến độ: phần đã dùng + vạch "đáng lẽ chỉ nên tiêu đến" (pace). Trạng thái luôn có chữ đi kèm,
 * không chỉ dựa vào màu (docs/07 §4).
 */
export function ProgressBar({ value, max, pace, tone, label }: { value: number; max: number; pace?: number; tone: 'ok' | 'warning' | 'over'; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : value > 0 ? 100 : 0
  const pacePct = max > 0 && pace !== undefined ? Math.min(100, (pace / max) * 100) : null
  const color = tone === 'over' ? 'bg-negative' : tone === 'warning' ? 'bg-warning' : 'bg-brand'
  return (
    <div className="relative h-2 rounded-full bg-canvas" role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      {pacePct !== null && pacePct > 0 && pacePct < 100 && (
        <div className="absolute -top-1 h-4 w-0.5 bg-ink/60" style={{ left: `${pacePct}%` }} title="Mức nên tiêu đến hôm nay" />
      )}
    </div>
  )
}
