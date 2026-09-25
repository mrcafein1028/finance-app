import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../components/ui/form'
import { EmptyState, ErrorState, LoadingState, Money } from '../../components/ui/Money'
import { ProgressBar } from '../../components/ui/MonthNav'
import { useRecurringRules } from '../../data/queries'
import { today } from '../../lib/clock'
import { addDays } from '../../domain/dates'
import { topInsights, type Indicator, type Insight, type Rating } from '../../domain/insights'
import { netWorthSeries, recentMonths } from '../../domain/reports'
import { formatDate, formatMoney, formatPercent, monthLabel } from '../../lib/format'
import { readPref, writePref } from '../../lib/prefs'
import { upcomingItems } from '../../services/overview'
import { pendingOccurrences } from '../../services/recurring'
import { describeTransaction } from '../transactions/describe'
import { useTransactionDialog } from '../transactions/transactionDialogContext'
import { useOverview, type Overview } from './useOverview'

const RATING_TEXT: Record<Rating, string> = { good: 'Tốt', fair: 'Trung bình', attention: 'Cần chú ý' }
const RATING_ICON: Record<Rating, string> = { good: '✓', fair: '•', attention: '!' }
const RATING_COLOR: Record<Rating, string> = { good: 'text-positive', fair: 'text-warning', attention: 'text-negative' }

/** Trang chủ (docs/07 §1): net worth, sức khỏe tài chính, ngân sách tháng, insight, việc sắp tới, giao dịch gần đây. */
export function DashboardPage() {
  const { data, isLoading, error } = useOverview()
  if (isLoading) return <LoadingState />
  if (error || !data) return <ErrorState error={error} />
  if (data.view.accounts.length === 0) {
    return (
      <section className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold">Tổng quan</h1>
        <EmptyState title="Chưa có tài khoản nào">
          <Link to="/accounts" className="text-brand">
            Thêm tài khoản đầu tiên
          </Link>{' '}
          để thấy net worth và các chỉ số.
        </EmptyState>
      </section>
    )
  }
  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">Tổng quan</h1>
      <BackupReminder lastBackupAt={data.view.settings.lastBackupAt} />
      <NetWorthCard data={data} />
      <HealthTiles data={data} />
      <div className="grid gap-5 lg:grid-cols-2">
        <BudgetCard data={data} />
        <InsightsCard data={data} />
        <UpcomingCard data={data} />
        <RecentCard data={data} />
      </div>
    </section>
  )
}

/** Nhắc sao lưu khi chưa từng sao lưu hoặc lần gần nhất đã quá 30 ngày (docs/05 W17). */
function BackupReminder({ lastBackupAt }: { lastBackupAt: string | null }) {
  const [hidden, setHidden] = useState(() => readPref('backup-reminder-hidden-until', '') > today())
  const due = !lastBackupAt || addDays(lastBackupAt.slice(0, 10), 30) < today()
  if (!due || hidden) return null
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/40 px-4 py-3 text-sm">
      <span>{lastBackupAt ? 'Đã hơn 30 ngày bạn chưa sao lưu dữ liệu.' : 'Bạn chưa sao lưu dữ liệu lần nào.'} Một file sao lưu giúp bạn yên tâm khi có sự cố.</span>
      <span className="flex gap-2">
        <Link to="/settings" className="font-medium text-brand">
          Sao lưu ngay
        </Link>
        <button
          type="button"
          className="text-muted hover:text-ink"
          onClick={() => {
            writePref('backup-reminder-hidden-until', addDays(today(), 7))
            setHidden(true)
          }}
        >
          Nhắc sau
        </button>
      </span>
    </div>
  )
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 26}`).join(' ')
  return (
    <svg viewBox="0 0 100 30" className="h-10 w-40" preserveAspectRatio="none" role="img" aria-label="Net worth 12 tháng gần nhất">
      <polyline points={points} fill="none" stroke="var(--color-series-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

function NetWorthCard({ data }: { data: Overview }) {
  const { view, netWorth, previousNetWorth, now } = data
  const series = useMemo(() => netWorthSeries(view.ledger, recentMonths(now, 12, view.settings.periodStartDay), view.settings.periodStartDay, now), [view, now])
  const delta = previousNetWorth === null ? null : netWorth.netWorth - previousNetWorth
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-border bg-surface p-5">
      <div>
        <p className="text-sm text-muted">Net worth (tài sản − nợ)</p>
        <p className="text-4xl font-semibold tracking-tight">
          <Money value={netWorth.netWorth} />
        </p>
        <p className="mt-1 text-sm text-muted">
          Tài sản <Money value={netWorth.totalAssets} /> · Nợ <Money value={netWorth.totalLiabilities} />
        </p>
        {delta !== null && (
          <p className={`mt-1 text-sm font-medium ${delta >= 0 ? 'text-positive' : 'text-negative'}`}>
            {delta >= 0 ? '▲' : '▼'} {formatMoney(delta, { sign: true })}
            {previousNetWorth ? ` (${formatPercent(delta / Math.abs(previousNetWorth), 1)})` : ''} so với cuối tháng trước
          </p>
        )}
      </div>
      <Link to="/reports" className="flex flex-col items-end gap-1 text-sm text-brand">
        <Sparkline values={series.map((p) => p.netWorth)} />
        Xem báo cáo ›
      </Link>
    </div>
  )
}

function Tile({ title, indicator, format, hint }: { title: string; indicator: Indicator; format: (v: number) => string; hint: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4">
      <p className="text-sm text-muted">{title}</p>
      <p className="text-2xl font-semibold">{indicator.value === null ? '—' : format(indicator.value)}</p>
      <p className={`text-sm font-medium ${indicator.rating ? RATING_COLOR[indicator.rating] : 'text-muted'}`}>
        {indicator.rating ? `${RATING_ICON[indicator.rating]} ${RATING_TEXT[indicator.rating]}` : 'Chưa đủ dữ liệu'}
      </p>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  )
}

function HealthTiles({ data }: { data: Overview }) {
  const h = data.health
  const pct = (v: number) => formatPercent(v, 1)
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Chỉ số sức khỏe tài chính">
      <Tile title="Tỉ lệ tiết kiệm" indicator={h.savingsRate} format={pct} hint={data.lastEnded ? monthLabel(data.lastEnded.month) : 'Tháng gần nhất đã kết thúc'} />
      <Tile title="Quỹ khẩn cấp" indicator={h.emergencyMonths} format={(v) => (v > 60 ? 'Trên 60 tháng' : `${v.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tháng`)} hint="Đủ trang trải chi tiêu thiết yếu" />
      <Tile title="Trả nợ / thu nhập" indicator={h.debtToIncome} format={pct} hint="Khoản phải trả hằng tháng (DTI)" />
      <Tile title="Nợ / tài sản" indicator={h.debtToAsset} format={pct} hint="Tổng nợ trên tổng tài sản" />
    </div>
  )
}

function BudgetCard({ data }: { data: Overview }) {
  const b = data.budget
  if (!b) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-semibold">Ngân sách {monthLabel(data.currentMonth).toLowerCase()}</h2>
        <p className="mt-2 text-sm text-muted">Chưa lập ngân sách cho tháng này.</p>
        <Link to="/budget" className="mt-3 inline-block text-sm font-medium text-brand">
          Lập ngân sách ›
        </Link>
      </div>
    )
  }
  const cat = b.lines.filter((l) => l.line.target.kind === 'category')
  const budget = cat.reduce((s, l) => s + l.budget, 0)
  const actual = cat.reduce((s, l) => s + l.actual, 0)
  const pace = cat.reduce((s, l) => s + l.pace, 0)
  const nearest = [...cat].filter((l) => l.budget > 0).sort((x, y) => (y.usage ?? 0) - (x.usage ?? 0)).slice(0, 5)
  const name = (id: string) => data.view.categoryById.get(id)?.name ?? '?'
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Ngân sách {monthLabel(data.currentMonth).toLowerCase()}</h2>
        <Link to="/budget" className="text-sm text-brand">
          Chi tiết ›
        </Link>
      </div>
      <p className="text-sm">
        Còn được tiêu <Money value={budget - actual} className="font-semibold" /> / <Money value={budget} />
      </p>
      <ProgressBar value={actual} max={budget} pace={pace} tone={actual > budget ? 'over' : actual >= budget * 0.8 ? 'warning' : 'ok'} label="Tổng chi tháng này so với ngân sách" />
      <ul className="mt-1 flex flex-col gap-2 text-sm">
        {nearest.map((l) => {
          const n = l.line.target.kind === 'category' ? name(l.line.target.categoryId) : ''
          return (
            <li key={l.line.id} className="flex items-center justify-between gap-2">
              <span>{n}</span>
              <span className={l.status === 'over' ? 'text-negative' : l.status === 'warning' ? 'text-warning' : 'text-muted'}>
                {Math.round((l.usage ?? 0) * 100)}% · {l.available < 0 ? `vượt ${formatMoney(-l.available)}` : `còn ${formatMoney(l.available)}`}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function InsightsCard({ data }: { data: Overview }) {
  const key = `dismissed-insights:${data.currentMonth}`
  const [dismissed, setDismissed] = useState<string[]>(() => readPref<string[]>(key, []))
  const insights: Insight[] = topInsights(data.insightContext, new Set(dismissed))
  const hide = (id: string) => {
    const next = [...dismissed, id]
    writePref(key, next)
    setDismissed(next)
  }
  const tone = { warning: 'border-l-negative', info: 'border-l-brand', positive: 'border-l-positive' }
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
      <h2 className="font-semibold">Cần chú ý</h2>
      {insights.length === 0 ? (
        <p className="text-sm text-muted">Không có gì đáng lo — mọi thứ đang ổn.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Insight">
          {insights.map((i) => (
            <li key={i.id} className={`flex items-start justify-between gap-3 rounded-lg border-l-4 bg-canvas px-3 py-2 text-sm ${tone[i.tone]}`}>
              <span>
                {i.message}
                {i.href && (
                  <Link to={i.href} className="ml-1 font-medium text-brand">
                    Xem ›
                  </Link>
                )}
              </span>
              <button type="button" className="shrink-0 text-xs text-muted hover:text-ink" onClick={() => hide(i.id)} aria-label={`Ẩn: ${i.message}`}>
                Ẩn
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function UpcomingCard({ data }: { data: Overview }) {
  const rules = useRecurringRules().data ?? []
  const items = upcomingItems(data, rules, 7)
  const pending = pendingOccurrences(rules, data.now)

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
      <h2 className="font-semibold">7 ngày tới</h2>
      {pending.length > 0 && (
        <Link to="/transactions/recurring" className="rounded-lg bg-canvas px-3 py-2 text-sm font-medium text-warning">
          {pending.length} giao dịch định kỳ chờ xác nhận ›
        </Link>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-muted">Không có khoản đến hạn nào.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {items.map((i) => (
            <li key={`${i.href}:${i.date}:${i.label}`}>
              <Link to={i.href} className="flex justify-between gap-3 py-2 hover:text-brand">
                <span>
                  <span className={i.overdue ? 'font-medium text-negative' : 'text-muted'}>{i.overdue ? 'Quá hạn · ' : ''}{formatDate(i.date)}</span> · {i.label}
                </span>
                <Money value={i.amount} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RecentCard({ data }: { data: Overview }) {
  const dialog = useTransactionDialog()
  const recent = data.view.transactions.filter((t) => t.date <= data.now).slice(0, 5)
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Giao dịch gần đây</h2>
        <Link to="/transactions" className="text-sm text-brand">
          Tất cả ›
        </Link>
      </div>
      {recent.length === 0 ? (
        <div className="text-sm text-muted">
          Chưa có giao dịch. <Button variant="ghost" className="px-1 py-0 text-brand" onClick={() => dialog.openNew()}>Ghi khoản đầu tiên</Button>
        </div>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {recent.map((t) => (
            <li key={t.id}>
              <button type="button" className="flex w-full justify-between gap-3 py-2 text-left hover:text-brand" onClick={() => dialog.openEdit(t)}>
                <span>
                  <span className="text-muted">{formatDate(t.date)}</span> · {describeTransaction(t, data.view)}
                </span>
                <Money value={t.type === 'expense' ? -t.amount : t.type === 'transfer' ? t.amount : t.type === 'adjustment' && t.direction === 'down' ? -t.amount : t.amount} sign={t.type !== 'transfer'} tone={t.type === 'transfer' ? 'none' : 'auto'} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
