import { useMemo, useState } from 'react'
import { ChartCard } from '../../components/charts/ChartCard'
import { SegmentedControl, SelectField } from '../../components/ui/form'
import { ErrorState, LoadingState, Money } from '../../components/ui/Money'
import { MonthNav, ProgressBar } from '../../components/ui/MonthNav'
import { addDays, diffDays } from '../../domain/dates'
import { goalProgress } from '../../domain/goals'
import { explainNetWorthChange } from '../../domain/networth'
import { periodRange, previousMonth } from '../../domain/period'
import { cashflowSeries, dailySpending, monthsBetween, movingAverage, netWorthSeries, spendingByTopCategory } from '../../domain/reports'
import { formatDate, formatMoney, formatPercent, monthLabel } from '../../lib/format'
import type { AccountKind } from '../../schemas'
import { isLoan, upcomingSchedule } from '../../services/liabilities'
import { useOverview, type Overview } from '../overview/useOverview'
import { allocationColor, S } from './chartTheme'
import {
  AllocationChart,
  DebtPayoffChart,
  NetWorthChart,
  PlanVsActualChart,
  PrincipalInterestChart,
  ProfitLossChart,
  SavingsRateChart,
  SpendingTrendChart,
  WaterfallChart,
  type WaterfallStep,
} from './charts'

type Span = '6' | '12' | '36' | 'all'
const monthTick = (m: string) => `${m.slice(5)}/${m.slice(0, 4)}`

export default function ReportsPage() {
  const { data, isLoading, error } = useOverview()
  const [span, setSpan] = useState<Span>('12')
  const [month, setMonth] = useState<string | null>(null)
  if (isLoading) return <LoadingState />
  if (error || !data) return <ErrorState error={error} />
  const selected = month ?? data.lastEnded?.month ?? data.currentMonth
  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">Báo cáo</h1>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-72">
          <SegmentedControl
            label="Khoảng thời gian"
            value={span}
            onChange={setSpan}
            options={[
              { value: '6', label: '6 tháng' },
              { value: '12', label: '1 năm' },
              { value: '36', label: '3 năm' },
              { value: 'all', label: 'Tất cả' },
            ]}
          />
        </div>
      </div>
      <TimeSeries data={data} span={span} />

      <h2 className="mt-2 text-lg font-semibold">Chi tiết theo tháng</h2>
      <MonthNav month={selected} startDay={data.view.settings.periodStartDay} onChange={setMonth} />
      <MonthDetail data={data} month={selected} />

      <h2 className="mt-2 text-lg font-semibold">Tài sản & nợ</h2>
      <Holdings data={data} />
    </section>
  )
}

function TimeSeries({ data, span }: { data: Overview; span: Span }) {
  const { view, now } = data
  const startDay = view.settings.periodStartDay
  const earliest = view.accounts.reduce<string | null>((min, a) => (min === null || a.openingDate < min ? a.openingDate : min), null)
  const months = useMemo(() => {
    if (!earliest) return []
    const all = monthsBetween(earliest, now, startDay)
    return span === 'all' ? all : all.slice(-Number(span))
  }, [earliest, now, startDay, span])
  const nw = useMemo(() => netWorthSeries(view.ledger, months, startDay, now), [view.ledger, months, startDay, now])
  const flow = useMemo(() => cashflowSeries(view.transactions, view.categories, months, startDay), [view, months, startDay])
  const avg = movingAverage(flow.map((f) => f.expense))
  const trend = flow.map((f, i) => ({ month: f.month, needs: f.needs, wants: f.wants, avg: Math.round(avg[i]!) }))
  const rates = flow.map((f) => ({ month: f.month, rate: f.savingsRate }))

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <ChartCard
          title="Net worth theo thời gian"
          question="Tôi có đang giàu lên không?"
          legend={[
            { label: 'Tài sản', color: S[1] },
            { label: 'Nợ', color: S[2] },
            { label: 'Net worth', color: S.ink },
          ]}
          rows={nw}
          columns={[
            { label: 'Tháng', value: (r) => monthTick(r.month) },
            { label: 'Tài sản', value: (r) => formatMoney(r.assets), align: 'right' },
            { label: 'Nợ', value: (r) => formatMoney(-r.liabilities), align: 'right' },
            { label: 'Net worth', value: (r) => formatMoney(r.netWorth), align: 'right' },
          ]}
        >
          <NetWorthChart data={nw} />
        </ChartCard>
      </div>
      <ChartCard
        title="Xu hướng chi tiêu"
        question="Chi tiêu của tôi tăng hay giảm?"
        legend={[
          { label: 'Thiết yếu', color: S[1] },
          { label: 'Mong muốn', color: S[2] },
          { label: 'TB 3 tháng', color: S.ink, dashed: true },
        ]}
        rows={trend.filter((t) => t.needs + t.wants > 0)}
        columns={[
          { label: 'Tháng', value: (r) => monthTick(r.month) },
          { label: 'Thiết yếu', value: (r) => formatMoney(r.needs), align: 'right' },
          { label: 'Mong muốn', value: (r) => formatMoney(r.wants), align: 'right' },
          { label: 'TB 3 tháng', value: (r) => formatMoney(r.avg), align: 'right' },
        ]}
      >
        <SpendingTrendChart data={trend} />
      </ChartCard>
      <ChartCard
        title="Tỉ lệ tiết kiệm theo tháng"
        question="Tôi tiết kiệm có đều không? (mục tiêu 20%)"
        rows={rates.filter((r) => r.rate !== null)}
        columns={[
          { label: 'Tháng', value: (r) => monthTick(r.month) },
          { label: 'Tỉ lệ', value: (r) => (r.rate === null ? '—' : formatPercent(r.rate, 1)), align: 'right' },
        ]}
      >
        <SavingsRateChart data={rates} />
      </ChartCard>
    </div>
  )
}

function MonthDetail({ data, month }: { data: Overview; month: string }) {
  const { view, now } = data
  const startDay = view.settings.periodStartDay
  const range = periodRange(month, startDay)
  const end = range.end < now ? range.end : now
  const change = explainNetWorthChange(view.ledger, range.start, end)
  const steps: WaterfallStep[] = [
    { label: 'Đầu kỳ', value: change.startNetWorth, kind: 'total' },
    { label: 'Số dư ban đầu', value: change.openingBalances, kind: 'delta' },
    { label: 'Thu nhập', value: change.income, kind: 'delta' },
    { label: 'Chi tiêu', value: change.expense + change.refund, kind: 'delta' },
    { label: 'Thị trường', value: change.market, kind: 'delta' },
    { label: 'Định giá', value: change.revaluation, kind: 'delta' },
    { label: 'Lãi dồn tích', value: change.accruedInterest, kind: 'delta' },
    { label: 'Khác', value: change.adjustment + change.externalTransfer + change.other, kind: 'delta' },
    { label: 'Cuối kỳ', value: change.endNetWorth, kind: 'total' },
  ].filter((s) => s.kind === 'total' || s.value !== 0) as WaterfallStep[]

  const summary = data.chain.get(month) ?? null
  const flow = cashflowSeries(view.transactions, view.categories, [month], startDay)[0]!
  const top = spendingByTopCategory(view.transactions, view.categories, range)
  const name = (id: string) => view.categoryById.get(id)?.name ?? '?'
  const days = dailySpending(view.transactions, range)
  const maxDay = Math.max(1, ...days.map((d) => d.amount))
  // Kế hoạch vs thực tế: dùng ngân sách của tháng nếu có (tổng hợp chuỗi), không thì chỉ thực tế.
  const plan = (summary?.lines ?? [])
    .filter((l) => l.line.target.kind === 'category')
    .map((l) => ({ label: name((l.line.target as { categoryId: string }).categoryId), planned: l.budget, actual: l.actual }))
    .sort((a, b) => b.actual - b.planned - (a.actual - a.planned))
  const planRows = plan.length ? plan : top.slice(0, 8).map((t) => ({ label: name(t.categoryId), planned: 0, actual: t.amount }))

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <ChartCard
          title="Vì sao net worth thay đổi?"
          question={`Biến động ${monthLabel(month).toLowerCase()}: bắt đầu ${formatMoney(change.startNetWorth)}${change.openingBalances ? ` (${formatMoney(change.openingBalances, { sign: true })} số dư ban đầu của tài khoản mới)` : ''} → kết thúc ${formatMoney(change.endNetWorth)}`}
          rows={steps}
          columns={[
            { label: 'Mục', value: (r) => r.label },
            { label: 'Số tiền', value: (r) => (r.kind === 'total' ? formatMoney(r.value) : formatMoney(r.value, { sign: true })), align: 'right' },
          ]}
        >
          <WaterfallChart steps={steps} />
        </ChartCard>
      </div>
      <ChartCard
        title="Kế hoạch vs thực tế"
        question={plan.length ? 'Tôi vượt ngân sách ở đâu?' : 'Chi tiêu theo danh mục (tháng này chưa có ngân sách)'}
        legend={plan.length ? [{ label: 'Kế hoạch', color: S[1] }, { label: 'Thực tế', color: S[2] }] : undefined}
        rows={planRows}
        columns={[
          { label: 'Danh mục', value: (r) => r.label },
          { label: 'Kế hoạch', value: (r) => (r.planned ? formatMoney(r.planned) : '—'), align: 'right' },
          { label: 'Thực tế', value: (r) => formatMoney(r.actual), align: 'right' },
        ]}
      >
        <PlanVsActualChart data={planRows} />
      </ChartCard>

      <ChartCard
        title="Thu nhập đi đâu?"
        question="Cơ cấu 50/30/20 thực tế so với mục tiêu"
        rows={flow.income > 0 ? [{ k: 'Thiết yếu', v: flow.needs, t: 0.5 }, { k: 'Mong muốn', v: flow.wants, t: 0.3 }, { k: 'Tiết kiệm & trả nợ', v: flow.net, t: 0.2 }] : []}
        columns={[
          { label: 'Nhóm', value: (r) => r.k },
          { label: 'Số tiền', value: (r) => formatMoney(r.v), align: 'right' },
          { label: 'Tỉ trọng', value: (r) => formatPercent(r.v / flow.income, 1), align: 'right' },
          { label: 'Mục tiêu', value: (r) => formatPercent(r.t, 0), align: 'right' },
        ]}
        empty="Chưa có thu nhập trong tháng này."
      >
        <div className="flex h-full flex-col justify-center gap-5">
          <div className="flex h-8 overflow-hidden rounded-lg" role="img" aria-label="Tỉ trọng thiết yếu, mong muốn, tiết kiệm trên thu nhập">
            {[
              [flow.needs, S[1]],
              [flow.wants, S[2]],
              [Math.max(0, flow.net), S[3]],
            ].map(([v, c], i) => (
              <div key={i} style={{ width: `${(Math.max(0, v as number) / Math.max(flow.income, flow.needs + flow.wants)) * 100}%`, background: c as string }} className="border-r-2 border-surface last:border-r-0" />
            ))}
          </div>
          <ul className="grid gap-2 text-sm">
            {[
              ['Thiết yếu', flow.needs, 0.5, S[1]],
              ['Mong muốn', flow.wants, 0.3, S[2]],
              ['Tiết kiệm & trả nợ', flow.net, 0.2, S[3]],
            ].map(([k, v, t, c]) => (
              <li key={k as string} className="flex items-center gap-2">
                <span className="inline-block size-3 rounded-sm" style={{ background: c as string }} aria-hidden />
                <span className="flex-1">{k as string}</span>
                <span className="tabular font-medium">{formatPercent((v as number) / flow.income, 1)}</span>
                <span className="w-24 text-right text-muted">mục tiêu {formatPercent(t as number, 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      </ChartCard>

      <div className="lg:col-span-2">
        <ChartCard
          title="Chi tiêu theo ngày"
          question="Tôi hay tiêu nhiều vào ngày nào?"
          rows={days.filter((d) => d.amount > 0)}
          columns={[
            { label: 'Ngày', value: (r) => formatDate(r.date) },
            { label: 'Chi', value: (r) => formatMoney(r.amount), align: 'right' },
          ]}
          empty="Không có khoản chi nào trong tháng."
        >
          <Heatmap days={days} max={maxDay} start={range.start} />
        </ChartCard>
      </div>
    </div>
  )
}

const HEAT = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95']

function Heatmap({ days, max, start }: { days: { date: string; amount: number }[]; max: number; start: string }) {
  const offset = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7 // Thứ Hai đầu tuần
  const labels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 gap-1">
        {Array.from({ length: offset }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {days.map((d) => {
          const step = d.amount <= 0 ? -1 : Math.min(HEAT.length - 1, Math.floor((d.amount / max) * HEAT.length))
          return (
            <span
              key={d.date}
              title={`${formatDate(d.date)}: ${formatMoney(d.amount)}`}
              className="flex items-start justify-end rounded-md p-1 text-[10px]"
              style={{ background: step < 0 ? 'var(--color-canvas)' : HEAT[step], color: step >= 3 ? '#fff' : 'var(--color-muted)' }}
            >
              {Number(d.date.slice(8))}
            </span>
          )
        })}
      </div>
    </div>
  )
}

const KIND_GROUP: Record<AccountKind, string> = {
  cash: 'Tiền mặt & ngân hàng',
  bank: 'Tiền mặt & ngân hàng',
  ewallet: 'Tiền mặt & ngân hàng',
  goal_fund: 'Quỹ mục tiêu',
  term_deposit: 'Tiết kiệm',
  investment: 'Đầu tư',
  other_asset: 'Tài sản khác',
  loan: '',
  credit_card: '',
  bnpl: '',
  personal_debt: '',
}

function Holdings({ data }: { data: Overview }) {
  const { view, now, netWorth } = data
  const groups = new Map<string, number>()
  for (const [kind, value] of Object.entries(netWorth.byKind) as [AccountKind, number][]) {
    const g = KIND_GROUP[kind]
    if (g && value > 0) groups.set(g, (groups.get(g) ?? 0) + value)
  }
  const allocation = [...groups].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  const total = allocation.reduce((s, a) => s + a.value, 0)

  const loans = view.accounts.filter(isLoan).filter((a) => !a.archivedAt)
  const schedules = loans.map((l) => ({ loan: l, rows: upcomingSchedule(l, view.transactions, now) }))
  const payoffMonths = new Map<string, Record<string, number | string>>()
  for (const { loan, rows } of schedules) {
    for (const r of rows) {
      const m = r.dueDate.slice(0, 7)
      const point = payoffMonths.get(m) ?? { month: m }
      point[loan.id] = r.closingBalance
      payoffMonths.set(m, point)
    }
  }
  const payoff = [...payoffMonths.values()].sort((a, b) => String(a.month).localeCompare(String(b.month)))
  for (const p of payoff) for (const l of loans) p[l.id] ??= 0
  const [loanId, setLoanId] = useState(loans[0]?.id ?? '')
  const pi = (schedules.find((s) => s.loan.id === loanId)?.rows ?? []).slice(0, 24).map((r) => ({ seq: String(r.seq), principal: r.principal, interest: r.interest }))

  const holdings = data.insightContext.holdings ?? []
  const pl = holdings.filter((h) => h.position.quantity.gt(0)).map((h) => ({ label: h.holding.symbol, value: h.unrealized, pct: h.returnPct }))
  const goals = view.accounts.filter((a) => a.goal && !a.archivedAt)
  const deposits = [...(data.insightContext.deposits ?? [])].sort((a, b) => a.maturityDate.localeCompare(b.maturityDate))

  // Tốc độ góp TB 3 tháng vào mỗi quỹ → ngày dự kiến đạt mục tiêu (R12).
  const contribution = (accountId: string) => {
    const from = periodRange(previousMonth(previousMonth(previousMonth(data.currentMonth))), view.settings.periodStartDay).start
    const net = view.transactions.filter((t) => t.date >= from && t.date <= now && t.type === 'transfer').reduce((s, t) => s + (t.toAccountId === accountId ? t.amount : t.accountId === accountId ? -t.amount : 0), 0)
    return net / Math.max(1, diffDays(from, now) / 30.4375)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <ChartCard
        title="Phân bổ tài sản"
        question="Tiền của tôi nằm ở đâu?"
        legend={allocation.map((a, i) => ({ label: `${a.label} ${formatPercent(a.value / total, 0)}`, color: allocationColor(i) }))}
        rows={allocation}
        columns={[
          { label: 'Nhóm', value: (r) => r.label },
          { label: 'Giá trị', value: (r) => formatMoney(r.value), align: 'right' },
          { label: 'Tỉ trọng', value: (r) => formatPercent(r.value / total, 1), align: 'right' },
        ]}
      >
        <AllocationChart data={allocation} />
      </ChartCard>

      <ChartCard
        title="Hiệu quả đầu tư"
        question="Khoản đầu tư nào đang lãi / lỗ?"
        rows={pl}
        columns={[
          { label: 'Mã', value: (r) => r.label },
          { label: 'Lãi/lỗ chưa thực hiện', value: (r) => formatMoney(r.value, { sign: true }), align: 'right' },
          { label: '%', value: (r) => (r.pct === null ? '—' : formatPercent(r.pct, 1)), align: 'right' },
        ]}
        empty="Chưa có khoản đầu tư nào."
      >
        <ProfitLossChart data={pl} />
      </ChartCard>

      <ChartCard
        title="Lộ trình trả nợ"
        question={schedules.length ? `Bao giờ hết nợ? Dự kiến ${formatDate(schedules.map((s) => s.rows.at(-1)?.dueDate ?? now).sort().at(-1)!)}` : 'Bao giờ hết nợ?'}
        legend={loans.map((l, i) => ({ label: l.name, color: allocationColor(i) }))}
        rows={payoff.filter((_, i) => i % 12 === 0)}
        columns={[{ label: 'Tháng', value: (r) => monthTick(String(r.month)) }, ...loans.map((l) => ({ label: l.name, value: (r: Record<string, number | string>) => formatMoney(Number(r[l.id] ?? 0)), align: 'right' as const }))]}
        empty="Không có khoản vay nào."
      >
        <DebtPayoffChart data={payoff} loans={loans} />
      </ChartCard>

      <ChartCard
        title="Gốc và lãi mỗi kỳ"
        question="Mỗi khoản trả bao nhiêu là lãi? (24 kỳ tới)"
        legend={[
          { label: 'Gốc', color: S[1] },
          { label: 'Lãi', color: S[2] },
        ]}
        rows={pi}
        columns={[
          { label: 'Kỳ', value: (r) => r.seq },
          { label: 'Gốc', value: (r) => formatMoney(r.principal), align: 'right' },
          { label: 'Lãi', value: (r) => formatMoney(r.interest), align: 'right' },
        ]}
        empty="Không có khoản vay nào."
      >
        <div className="flex h-full flex-col gap-2">
          {loans.length > 1 && (
            <SelectField label="Khoản vay" value={loanId} onChange={(e) => setLoanId(e.target.value)}>
              {loans.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </SelectField>
          )}
          <div className="min-h-0 flex-1">
            <PrincipalInterestChart data={pi} />
          </div>
        </div>
      </ChartCard>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5" aria-label="Tiến độ quỹ mục tiêu">
        <h2 className="font-semibold">Tiến độ quỹ mục tiêu</h2>
        <p className="text-sm text-muted">Bao giờ đạt mục tiêu? (theo tốc độ góp trung bình 3 tháng)</p>
        {goals.length === 0 ? (
          <p className="text-sm text-muted">Chưa có quỹ nào đặt mục tiêu.</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {goals.map((g) => {
              const balance = view.balances.get(g.id) ?? 0
              const target = g.goal!.targetAmount
              const rate = contribution(g.id)
              const eta = balance >= target ? 'Đã đạt' : rate > 0 ? `Dự kiến ${formatDate(addDays(now, Math.ceil(((target - balance) / rate) * 30.4375)))}` : 'Chưa góp đều — chưa dự báo được'
              return (
                <li key={g.id} className="flex flex-col gap-1">
                  <span className="flex justify-between">
                    <span className="font-medium">{g.name}</span>
                    <span>
                      <Money value={balance} /> / <Money value={target} />
                    </span>
                  </span>
                  <ProgressBar value={balance} max={target} tone="ok" label={`${g.name}: ${goalProgress(balance, target)}%`} />
                  <span className="text-muted">
                    {goalProgress(balance, target)}% · {eta}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5" aria-label="Lịch đáo hạn tiết kiệm">
        <h2 className="font-semibold">Lịch đáo hạn tiết kiệm</h2>
        <p className="text-sm text-muted">Tiền nào sắp về?</p>
        {deposits.length === 0 ? (
          <p className="text-sm text-muted">Chưa có sổ tiết kiệm nào.</p>
        ) : (
          <ol className="relative ml-2 flex flex-col gap-3 border-l-2 border-border pl-4 text-sm">
            {deposits.map((d) => (
              <li key={d.accountId}>
                <span className={`absolute -left-[7px] mt-1 size-3 rounded-full ${d.maturityDate <= now ? 'bg-warning' : 'bg-brand'}`} aria-hidden />
                <span className="font-medium">{formatDate(d.maturityDate)}</span> · {d.bankName} · <Money value={d.principal} /> + lãi <Money value={d.expectedInterest} />
                {d.maturityDate <= now && <span className="text-warning"> · đã đến hạn</span>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

