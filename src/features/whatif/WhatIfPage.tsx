import { useMemo, useState } from 'react'
import { ChartCard } from '../../components/charts/ChartCard'
import { MoneyField, SelectField, TextField } from '../../components/ui/form'
import { ErrorState, LoadingState, Money } from '../../components/ui/Money'
import { bucketBreakdown } from '../../domain/budget'
import { loanTermsOf } from '../../domain/loan'
import { D, round } from '../../domain/money'
import { periodRange, previousMonth } from '../../domain/period'
import { projectNetWorth, type ProjectionInput, type ProjectionLoan } from '../../domain/whatif'
import { formatDate, formatMoney, parseMoneyInput, parsePercentInput } from '../../lib/format'
import { isLoan, upcomingSchedule } from '../../services/liabilities'
import { useOverview, type Overview } from '../overview/useOverview'
import { S } from '../reports/chartTheme'
import { ProjectionChart } from '../reports/charts'

/** Trang mô phỏng what-if (docs/01 §3.1-H): so sánh net worth tương lai giữa hiện tại và một kịch bản. */
export default function WhatIfPage() {
  const { data, isLoading, error } = useOverview()
  if (isLoading) return <LoadingState />
  if (error || !data) return <ErrorState error={error} />
  return <Simulator data={data} />
}

/** Thu nhập − chi tiêu sinh hoạt (không tính lãi vay) trung bình tối đa 3 kỳ đã kết thúc. */
function averageSurplus(data: Overview): number {
  const { view } = data
  const interestCats = new Set(view.categories.filter((c) => c.systemKey === 'loan_interest').map((c) => c.id))
  const earliest = view.accounts.reduce<string | null>((m, a) => (m === null || a.openingDate < m ? a.openingDate : m), null)
  const values: number[] = []
  for (let m = previousMonth(data.currentMonth), i = 0; i < 3; m = previousMonth(m), i++) {
    const r = periodRange(m, view.settings.periodStartDay)
    if (!earliest || r.end < earliest) break
    const b = bucketBreakdown(view.transactions, view.categories, r)
    const interest = view.transactions.filter((t) => t.type === 'expense' && interestCats.has(t.categoryId) && t.date >= r.start && t.date <= r.end).reduce((s, t) => s + t.amount, 0)
    values.push(b.savings + interest)
  }
  return values.length ? round(new D(values.reduce((s, v) => s + v, 0)).div(values.length)) : 0
}

function Simulator({ data }: { data: Overview }) {
  const { view, now, netWorth } = data
  const loans = view.accounts.filter(isLoan).filter((a) => !a.archivedAt && (view.balances.get(a.id) ?? 0) > 0)
  const baselineSurplus = useMemo(() => averageSurplus(data), [data])
  const [years, setYears] = useState(5)
  const [surplusDelta, setSurplusDelta] = useState('0')
  const [investShare, setInvestShare] = useState('50')
  const [investReturn, setInvestReturn] = useState('6')
  const [depositRate, setDepositRate] = useState(String(Math.round((data.insightContext.bestSavingsRate || 0.05) * 1000) / 10).replace('.', ','))
  const [extra, setExtra] = useState('0')
  const [lump, setLump] = useState('0')
  const [lumpLoan, setLumpLoan] = useState(loans[0]?.id ?? '')

  const kindValue = (kinds: string[]) => view.accounts.filter((a) => kinds.includes(a.kind) && !a.archivedAt && a.includeInNetWorth).reduce((s, a) => s + (view.balances.get(a.id) ?? 0), 0)
  const projectionLoans: ProjectionLoan[] = loans.map((l) => {
    const next = upcomingSchedule(l, view.transactions, now)[0]
    return { id: l.id, name: l.name, terms: loanTermsOf(l.details), outstanding: view.balances.get(l.id) ?? 0, scheduledPrincipal: next?.principal ?? 0, scheduledPayment: next?.payment ?? 0 }
  })
  const pct = (s: string, max: number) => parsePercentInput(s, max)
  const base: ProjectionInput = {
    start: now,
    months: years * 12,
    cash: kindValue(['cash', 'bank', 'ewallet', 'goal_fund']),
    investments: kindValue(['investment']),
    deposits: kindValue(['term_deposit']),
    otherAssets: kindValue(['other_asset']),
    otherDebt: kindValue(['credit_card']),
    loans: projectionLoans,
    monthlySurplus: baselineSurplus,
    investShare: (pct(investShare, 100) ?? 0.5),
    investmentReturn: pct(investReturn, 50) ?? 0.06,
    depositRate: pct(depositRate, 20) ?? 0.05,
    otherAssetGrowth: 0,
    extraDebtPayment: 0,
  }
  const baseline = projectNetWorth(base)
  const scenario = projectNetWorth({
    ...base,
    monthlySurplus: baselineSurplus + (parseMoneyInput(surplusDelta.replace('-', '')) ?? 0) * (surplusDelta.trim().startsWith('-') ? -1 : 1),
    extraDebtPayment: parseMoneyInput(extra) ?? 0,
    lumpSum: lumpLoan ? { loanId: lumpLoan, amount: parseMoneyInput(lump) ?? 0 } : null,
  })
  const series = baseline.points.map((p, i) => ({ date: p.date, baseline: p.netWorth, scenario: scenario.points[i]!.netWorth })).filter((_, i, all) => i % 3 === 0 || i === all.length - 1)
  const endBase = baseline.points.at(-1)!.netWorth
  const endScenario = scenario.points.at(-1)!.netWorth

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Mô phỏng</h1>
        <p className="text-sm text-muted">
          Net worth hôm nay <Money value={netWorth.netWorth} />. Thử thay đổi giả định để xem {years} năm tới khác đi thế nào. Kết quả chỉ để tham khảo, không phải tư vấn đầu tư.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <form className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5" onSubmit={(e) => e.preventDefault()} aria-label="Giả định">
          <SelectField label="Dự phóng trong" value={years} onChange={(e) => setYears(Number(e.target.value))}>
            {[1, 2, 3, 5, 7, 10].map((y) => (
              <option key={y} value={y}>
                {y} năm
              </option>
            ))}
          </SelectField>
          <p className="text-sm text-muted">
            Để dành trung bình hiện tại: <strong className="text-ink">{formatMoney(baselineSurplus)}/tháng</strong> (thu − chi sinh hoạt, 3 tháng gần nhất)
          </p>
          <MoneyField label="Để dành thêm mỗi tháng" hint="Gõ số âm (VD -2tr) nếu chi nhiều hơn" value={surplusDelta} rawValue={surplusDelta.replace('-', '')} onChange={(e) => setSurplusDelta(e.target.value)} />
          <TextField label="Tỉ lệ phần để dành đem đầu tư (%)" inputMode="decimal" value={investShare} onChange={(e) => setInvestShare(e.target.value)} />
          <TextField label="Lợi suất đầu tư kỳ vọng (%/năm)" inputMode="decimal" value={investReturn} onChange={(e) => setInvestReturn(e.target.value)} />
          <TextField label="Lãi tiết kiệm (%/năm)" inputMode="decimal" value={depositRate} onChange={(e) => setDepositRate(e.target.value)} />
          {loans.length > 0 && (
            <>
              <MoneyField label="Trả nợ thêm mỗi tháng" hint="Dồn vào khoản lãi cao nhất trước" value={extra} rawValue={extra} onChange={(e) => setExtra(e.target.value)} />
              <MoneyField label="Trả trước một lần ngay bây giờ" value={lump} rawValue={lump} onChange={(e) => setLump(e.target.value)} />
              {loans.length > 1 && (
                <SelectField label="Trả trước vào khoản" value={lumpLoan} onChange={(e) => setLumpLoan(e.target.value)}>
                  {loans.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </SelectField>
              )}
            </>
          )}
        </form>

        <div className="flex flex-col gap-5">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-surface p-4">
              <dt className="text-sm text-muted">Net worth sau {years} năm — hiện tại</dt>
              <dd className="text-xl font-semibold"><Money value={endBase} /></dd>
            </div>
            <div className="rounded-2xl border border-brand bg-surface p-4">
              <dt className="text-sm text-muted">Theo kịch bản</dt>
              <dd className="text-xl font-semibold"><Money value={endScenario} /></dd>
              <dd className={`text-sm font-medium ${endScenario - endBase >= 0 ? 'text-positive' : 'text-negative'}`}>{formatMoney(endScenario - endBase, { sign: true })}</dd>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4">
              <dt className="text-sm text-muted">Hết nợ</dt>
              {loans.length === 0 ? (
                <dd className="text-sm">Bạn không có khoản vay nào đang trả.</dd>
              ) : (
                <>
                  <dd className="text-sm">
                    Hiện tại: <strong>{baseline.debtFreeDate ? formatDate(baseline.debtFreeDate) : `sau ${years} năm`}</strong>
                  </dd>
                  <dd className="text-sm">
                    Kịch bản: <strong>{scenario.debtFreeDate ? formatDate(scenario.debtFreeDate) : `sau ${years} năm`}</strong>
                  </dd>
                </>
              )}
              {baseline.totalInterest !== scenario.totalInterest && <dd className="text-sm text-positive">Tiết kiệm lãi {formatMoney(baseline.totalInterest - scenario.totalInterest)}</dd>}
            </div>
          </dl>
          <ChartCard
            title="Net worth dự phóng"
            question="Kịch bản của tôi khác hiện tại bao nhiêu?"
            legend={[
              { label: 'Hiện tại', color: S.muted, dashed: true },
              { label: 'Kịch bản', color: S[1] },
            ]}
            rows={series}
            columns={[
              { label: 'Thời điểm', value: (r) => `${r.date.slice(5, 7)}/${r.date.slice(0, 4)}` },
              { label: 'Hiện tại', value: (r) => formatMoney(r.baseline), align: 'right' },
              { label: 'Kịch bản', value: (r) => formatMoney(r.scenario), align: 'right' },
            ]}
          >
            <ProjectionChart data={series} />
          </ChartCard>
          <p className="text-xs text-muted">
            Giả định: lợi suất và lãi suất cố định, lãi kép hằng tháng; khoản vay trả theo lịch hiện tại; thẻ tín dụng và tài sản khác giữ nguyên giá trị; không tính lạm phát và thuế.
          </p>
        </div>
      </div>
    </section>
  )
}
