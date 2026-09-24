import { addMonths } from './dates'
import { rateAt, type LoanTerms } from './loan'
import { D, round } from './money'
import type { IsoDate, Money } from './types'

// Mô phỏng "what-if" (docs/01 §3.1-H): dự phóng net worth theo tháng với giả định đơn giản, minh bạch.
// Không phải tư vấn đầu tư — chỉ giúp so sánh các kịch bản với cùng một bộ giả định.

export interface ProjectionLoan {
  id: string
  name: string
  terms: LoanTerms
  outstanding: Money
  /** Khoản trả cố định mỗi tháng theo lịch hiện tại (gốc với gốc đều / phẳng / 0%, tổng trả với trả đều). */
  scheduledPrincipal: Money
  scheduledPayment: Money
}

export interface ProjectionInput {
  start: IsoDate
  months: number
  /** Tiền mặt, ngân hàng, quỹ… (không sinh lời). */
  cash: Money
  investments: Money
  deposits: Money
  otherAssets: Money
  /** Nợ không theo lịch (thẻ tín dụng…) — giữ nguyên trong mô phỏng. */
  otherDebt: Money
  loans: readonly ProjectionLoan[]
  /** Thu nhập − chi tiêu sinh hoạt mỗi tháng, CHƯA trừ lãi vay (lãi được mô phỏng riêng). */
  monthlySurplus: Money
  /** Tỉ lệ phần dư dương mỗi tháng được đem đầu tư (0–1); phần còn lại để tiền mặt. */
  investShare: number
  investmentReturn: number
  depositRate: number
  otherAssetGrowth: number
  /** Trả thêm mỗi tháng — dồn vào khoản vay lãi cao nhất (avalanche). */
  extraDebtPayment: Money
  /** Trả trước một lần ở tháng đầu. */
  lumpSum?: { loanId: string; amount: Money } | null
}

export interface ProjectionPoint {
  date: IsoDate
  cash: Money
  investments: Money
  deposits: Money
  otherAssets: Money
  debt: Money
  netWorth: Money
}

export interface ProjectionResult {
  points: ProjectionPoint[]
  totalInterest: Money
  /** Ngày dư nợ các khoản vay về 0; null nếu chưa hết trong khoảng mô phỏng. */
  debtFreeDate: IsoDate | null
}

const monthlyRate = (annual: number) => new D(1).plus(annual).pow(new D(1).div(12)).minus(1)

export function projectNetWorth(input: ProjectionInput): ProjectionResult {
  let cash = input.cash
  let investments = input.investments
  let deposits = input.deposits
  let otherAssets = input.otherAssets
  const balances = new Map(input.loans.map((l) => [l.id, l.outstanding]))
  let totalInterest = 0
  let debtFreeDate: IsoDate | null = input.loans.every((l) => l.outstanding <= 0) ? input.start : null

  const invR = monthlyRate(input.investmentReturn)
  const depR = monthlyRate(input.depositRate)
  const assetR = monthlyRate(input.otherAssetGrowth)
  const byRate = [...input.loans].sort((a, b) => rateAt(b.terms.ratePeriods, input.start) - rateAt(a.terms.ratePeriods, input.start))

  if (input.lumpSum && input.lumpSum.amount > 0) {
    const bal = balances.get(input.lumpSum.loanId) ?? 0
    const pay = Math.min(bal, input.lumpSum.amount)
    balances.set(input.lumpSum.loanId, bal - pay)
    cash -= pay
  }

  const debt = () => [...balances.values()].reduce((s, b) => s + b, 0) + input.otherDebt
  const point = (date: IsoDate): ProjectionPoint => {
    const d = debt()
    return { date, cash, investments, deposits, otherAssets, debt: d, netWorth: cash + investments + deposits + otherAssets - d }
  }
  const points: ProjectionPoint[] = [point(input.start)]

  for (let m = 1; m <= input.months; m++) {
    const date = addMonths(input.start, m)
    investments = round(new D(investments).times(invR.plus(1)))
    deposits = round(new D(deposits).times(depR.plus(1)))
    otherAssets = round(new D(otherAssets).times(assetR.plus(1)))

    let extra = input.extraDebtPayment
    for (const loan of byRate) {
      const bal = balances.get(loan.id) ?? 0
      if (bal <= 0) continue
      const r = rateAt(loan.terms.ratePeriods, date)
      const interest = loan.terms.rateType === 'zero' ? 0 : loan.terms.rateType === 'flat' ? round(new D(loan.terms.originalPrincipal).times(r).div(12)) : round(new D(bal).times(r).div(12))
      let principal = loan.terms.rateType === 'annuity' ? Math.max(0, loan.scheduledPayment - interest) : loan.scheduledPrincipal
      principal = Math.min(bal, principal)
      const addl = Math.min(bal - principal, extra)
      extra -= addl
      balances.set(loan.id, bal - principal - addl)
      totalInterest += interest
      cash -= principal + addl + interest
    }
    // Khoản trả thêm đã trừ vào tiền mặt ngay trong vòng lặp trên (phần chưa dùng hết vì đã hết nợ
    // thì không bị trừ) — phần dư của tháng cộng vào nguyên vẹn, không trừ lần hai.
    const surplus = input.monthlySurplus
    if (surplus > 0) {
      const invest = round(new D(surplus).times(input.investShare))
      investments += invest
      cash += surplus - invest
    } else {
      cash += surplus
    }
    if (debtFreeDate === null && [...balances.values()].every((b) => b <= 0)) debtFreeDate = date
    points.push(point(date))
  }
  return { points, totalInterest, debtFreeDate }
}
