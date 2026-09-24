import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChartTooltip } from '../../components/charts/ChartTooltip'
import { formatMoney, formatMoneyCompact, formatPercent } from '../../lib/format'
import { PIE_COLORS, S } from './chartTheme'

// Biểu đồ Recharts dùng chung cho trang Báo cáo. Quy ước (skill dataviz): một trục duy nhất, nét mảnh,
// đầu cột bo 4px, khe 2px màu nền giữa các khối, lưới mờ, màu series theo thứ tự cố định.


const monthTick = (m: string) => `${m.slice(5)}/${m.slice(2, 4)}`
const axis = { tick: { fill: S.muted, fontSize: 12 }, tickLine: false, axisLine: false } as const
const grid = <CartesianGrid stroke={S.grid} strokeDasharray="0" vertical={false} />

export function NetWorthChart({ data }: { data: { month: string; assets: number; liabilities: number; netWorth: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} stackOffset="sign" margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        {grid}
        <XAxis dataKey="month" tickFormatter={monthTick} {...axis} />
        <YAxis tickFormatter={formatMoneyCompact} width={64} {...axis} />
        <ReferenceLine y={0} stroke={S.muted} />
        <Tooltip content={<ChartTooltip labelFormatter={(m) => `Tháng ${monthTick(m)}`} valueFormatter={(v) => formatMoney(v)} />} cursor={{ fill: S.grid, opacity: 0.5 }} />
        <Bar dataKey="assets" name="Tài sản" stackId="nw" fill={S[1]} radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="liabilities" name="Nợ" stackId="nw" fill={S[2]} radius={[0, 0, 4, 4]} maxBarSize={28} />
        <Line dataKey="netWorth" name="Net worth" stroke={S.ink} strokeWidth={2} dot={{ r: 4, fill: S.ink, stroke: S.surface, strokeWidth: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export interface WaterfallStep {
  label: string
  value: number
  kind: 'total' | 'delta'
}

export function WaterfallChart({ steps }: { steps: WaterfallStep[] }) {
  // Mỗi cột "delta" nổi từ mức cộng dồn trước đó; cột "total" đứng từ 0.
  const data: { label: string; range: [number, number]; value: number; kind: WaterfallStep['kind']; level: number }[] = []
  for (const s of steps) {
    const prev = data.at(-1)?.level ?? 0
    const level = s.kind === 'total' ? s.value : prev + s.value
    const from = s.kind === 'total' ? 0 : prev
    data.push({ label: s.label, range: [Math.min(from, level), Math.max(from, level)], value: s.value, kind: s.kind, level })
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        {grid}
        <XAxis dataKey="label" interval={0} {...axis} tick={{ fill: S.muted, fontSize: 11 }} />
        <YAxis tickFormatter={formatMoneyCompact} width={64} {...axis} />
        <Tooltip
          content={({ active, payload }) => {
            const p = payload?.[0]?.payload as (typeof data)[number] | undefined
            if (!active || !p) return null
            return (
              <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-md">
                <p className="font-medium">{p.label}</p>
                <p className="tabular">{p.kind === 'total' ? formatMoney(p.value) : formatMoney(p.value, { sign: true })}</p>
              </div>
            )
          }}
          cursor={{ fill: S.grid, opacity: 0.5 }}
        />
        <Bar dataKey="range" name="Biến động" radius={4} maxBarSize={40}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.kind === 'total' ? S[1] : d.value >= 0 ? S[3] : S[2]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function AllocationChart({ data }: { data: { label: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Tooltip content={<ChartTooltip valueFormatter={(v) => `${formatMoney(v)} (${formatPercent(v / total, 1)})`} />} />
        <Pie data={data} dataKey="value" nameKey="label" innerRadius="55%" outerRadius="85%" stroke={S.surface} strokeWidth={2} paddingAngle={1}>
          {data.map((d, i) => (
            <Cell key={d.label} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  )
}

export function PlanVsActualChart({ data }: { data: { label: string; planned: number; actual: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke={S.grid} horizontal={false} />
        <XAxis type="number" tickFormatter={formatMoneyCompact} {...axis} />
        <YAxis type="category" dataKey="label" width={110} {...axis} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: S.grid, opacity: 0.5 }} />
        <Bar dataKey="planned" name="Kế hoạch" fill={S[1]} radius={[0, 4, 4, 0]} maxBarSize={12} />
        <Bar dataKey="actual" name="Thực tế" fill={S[2]} radius={[0, 4, 4, 0]} maxBarSize={12} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function SpendingTrendChart({ data }: { data: { month: string; needs: number; wants: number; avg: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        {grid}
        <XAxis dataKey="month" tickFormatter={monthTick} {...axis} />
        <YAxis tickFormatter={formatMoneyCompact} width={64} {...axis} />
        <Tooltip content={<ChartTooltip labelFormatter={(m) => `Tháng ${monthTick(m)}`} />} cursor={{ fill: S.grid, opacity: 0.5 }} />
        <Bar dataKey="needs" name="Thiết yếu" stackId="s" fill={S[1]} stroke={S.surface} strokeWidth={2} maxBarSize={28} />
        <Bar dataKey="wants" name="Mong muốn" stackId="s" fill={S[2]} stroke={S.surface} strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Line dataKey="avg" name="TB 3 tháng" stroke={S.ink} strokeWidth={2} strokeDasharray="4 3" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function SavingsRateChart({ data }: { data: { month: string; rate: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        {grid}
        <XAxis dataKey="month" tickFormatter={monthTick} {...axis} />
        <YAxis tickFormatter={(v: number) => formatPercent(v, 0)} width={48} {...axis} />
        <ReferenceLine y={0.2} stroke={S[3]} strokeDasharray="4 3" label={{ value: 'Mục tiêu 20%', fill: S.muted, fontSize: 12, position: 'insideTopRight' }} />
        <Tooltip content={<ChartTooltip labelFormatter={(m) => `Tháng ${monthTick(m)}`} valueFormatter={(v) => formatPercent(v, 1)} />} />
        <Line dataKey="rate" name="Tỉ lệ tiết kiệm" stroke={S[1]} strokeWidth={2} connectNulls={false} dot={{ r: 4, fill: S[1], stroke: S.surface, strokeWidth: 2 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function DebtPayoffChart({ data, loans }: { data: Record<string, number | string>[]; loans: { id: string; name: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        {grid}
        <XAxis dataKey="month" tickFormatter={monthTick} minTickGap={24} {...axis} />
        <YAxis tickFormatter={formatMoneyCompact} width={64} {...axis} />
        <Tooltip content={<ChartTooltip labelFormatter={(m) => `Tháng ${monthTick(m)}`} />} />
        {loans.map((l, i) => (
          <Area key={l.id} dataKey={l.id} name={l.name} stackId="d" type="stepAfter" stroke={PIE_COLORS[i % 5]} strokeWidth={2} fill={PIE_COLORS[i % 5]} fillOpacity={0.25} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function PrincipalInterestChart({ data }: { data: { seq: string; principal: number; interest: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        {grid}
        <XAxis dataKey="seq" {...axis} />
        <YAxis tickFormatter={formatMoneyCompact} width={64} {...axis} />
        <Tooltip content={<ChartTooltip labelFormatter={(s) => `Kỳ ${s}`} />} cursor={{ fill: S.grid, opacity: 0.5 }} />
        <Bar dataKey="principal" name="Gốc" stackId="p" fill={S[1]} stroke={S.surface} strokeWidth={2} maxBarSize={24} />
        <Bar dataKey="interest" name="Lãi" stackId="p" fill={S[2]} stroke={S.surface} strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ProfitLossChart({ data }: { data: { label: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        {grid}
        <XAxis dataKey="label" {...axis} />
        <YAxis tickFormatter={formatMoneyCompact} width={64} {...axis} />
        <ReferenceLine y={0} stroke={S.muted} />
        <Tooltip content={<ChartTooltip valueFormatter={(v) => formatMoney(v, { sign: true })} />} cursor={{ fill: S.grid, opacity: 0.5 }} />
        <Bar dataKey="value" name="Lãi/lỗ" radius={4} maxBarSize={40}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.value >= 0 ? S[3] : S[2]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ProjectionChart({ data }: { data: { date: string; baseline: number; scenario: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        {grid}
        {/* Chỉ đánh dấu điểm đầu mỗi năm → không lặp nhãn năm. */}
        <XAxis dataKey="date" ticks={data.filter((p, i) => i === 0 || p.date.slice(0, 4) !== data[i - 1]!.date.slice(0, 4)).map((p) => p.date)} tickFormatter={(d: string) => d.slice(0, 4)} interval={0} {...axis} />
        <YAxis tickFormatter={formatMoneyCompact} width={64} {...axis} />
        <ReferenceLine y={0} stroke={S.muted} />
        <Tooltip content={<ChartTooltip labelFormatter={(d) => `${d.slice(5, 7)}/${d.slice(0, 4)}`} />} />
        <Line dataKey="baseline" name="Hiện tại" stroke={S.muted} strokeWidth={2} strokeDasharray="4 3" dot={false} />
        <Line dataKey="scenario" name="Kịch bản" stroke={S[1]} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
