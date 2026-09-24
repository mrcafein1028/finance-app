import { formatMoney } from '../../lib/format'

interface Item {
  name?: string | number
  value?: number | string | readonly (number | string)[]
  color?: string
  dataKey?: string | number
}

/** Tooltip chung: chữ dùng màu chữ (không dùng màu series), ô màu cạnh tên mang danh tính. */
export function ChartTooltip({
  active,
  label,
  payload,
  labelFormatter,
  valueFormatter = (v) => formatMoney(v),
}: {
  active?: boolean
  label?: string | number
  payload?: readonly Item[]
  labelFormatter?: (label: string) => string
  valueFormatter?: (value: number, key?: string) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-md">
      {label !== undefined && <p className="mb-1 font-medium text-ink">{labelFormatter ? labelFormatter(String(label)) : label}</p>}
      <ul className="space-y-0.5">
        {payload
          .filter((p) => typeof p.value === 'number')
          .map((p) => (
            <li key={String(p.dataKey ?? p.name)} className="flex items-center gap-2 text-muted">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
              <span>{p.name}</span>
              <span className="tabular ml-auto pl-3 font-medium text-ink">{valueFormatter(p.value as number, String(p.dataKey))}</span>
            </li>
          ))}
      </ul>
    </div>
  )
}
