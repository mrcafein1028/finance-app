import { useId, useState, type ReactNode } from 'react'

export interface TableColumn<T> {
  label: string
  value: (row: T) => ReactNode
  align?: 'left' | 'right'
}

/**
 * Khung một biểu đồ (docs/07): tiêu đề, câu hỏi nó trả lời, chú thích, và bảng số liệu thay thế
 * (bắt buộc — vài màu biểu đồ dưới 3:1 trên nền sáng, và người dùng trình đọc màn hình cần bảng).
 */
export function ChartCard<T>({
  title,
  question,
  legend,
  rows,
  columns,
  empty,
  children,
}: {
  title: string
  question: string
  legend?: { label: string; color: string; dashed?: boolean }[]
  rows: readonly T[]
  columns: TableColumn<T>[]
  empty?: ReactNode
  children: ReactNode
}) {
  const [table, setTable] = useState(false)
  const id = useId()
  const hasData = rows.length > 0
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={id} className="font-semibold">
            {title}
          </h2>
          <p className="text-sm text-muted">{question}</p>
        </div>
        {hasData && (
          <button type="button" className="text-sm font-medium text-brand" onClick={() => setTable((v) => !v)} aria-pressed={table}>
            {table ? 'Xem biểu đồ' : 'Xem bảng số liệu'}
          </button>
        )}
      </div>
      {legend && legend.length > 1 && hasData && !table && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted" aria-label="Chú thích">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span className={`inline-block h-2.5 w-4 rounded-sm ${l.dashed ? 'border-t-2 border-dashed bg-transparent' : ''}`} style={l.dashed ? { borderColor: l.color } : { background: l.color }} aria-hidden />
              {l.label}
            </li>
          ))}
        </ul>
      )}
      {!hasData ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">{empty ?? 'Chưa đủ dữ liệu để vẽ biểu đồ này.'}</div>
      ) : table ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted">
              <tr>
                {columns.map((c) => (
                  <th key={c.label} className={`px-2 py-1.5 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.label} className={`px-2 py-1.5 ${c.align === 'right' ? 'text-right' : ''}`}>
                      {c.value(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-64 w-full">{children}</div>
      )}
    </section>
  )
}
