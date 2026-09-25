import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { FormDialog } from '../../components/ui/FormDialog'
import { Button, CheckboxField, MoneyField, SegmentedControl, SelectField, TextField } from '../../components/ui/form'
import { EmptyState, ErrorState, LoadingState, Money } from '../../components/ui/Money'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, useLedgerView, type LedgerView } from '../../data/queries'
import { positionAt, tradeAmounts, type CostInput, type HoldingValuation } from '../../domain/investment'
import { D, round } from '../../domain/money'
import { today } from '../../lib/clock'
import { formatDate, formatMoney, formatPercent, parseMoneyInput, parsePercentInput, parseQuantityInput } from '../../lib/format'
import { readPref, writePref } from '../../lib/prefs'
import { HOLDING_ASSET_TYPES, type Account, type Holding, type HoldingAssetType } from '../../schemas'
import { addHolding, deleteTrade, recordTrade, revalueAsset, sellOtherAsset, updatePrices } from '../../services/investments'
import { AccountOptions } from '../transactions/pickers'
import { TransactionList } from '../transactions/TransactionList'
import { useTransactionDialog } from '../transactions/transactionDialogContext'
import { AccountAdmin } from '../accounts/AccountAdmin'
import { EditInvestmentDialog, EditOtherAssetDialog } from './EditAssetDialogs'

const ASSET_LABEL: Record<HoldingAssetType, string> = { stock: 'Cổ phiếu', fund: 'Chứng chỉ quỹ', gold: 'Vàng', crypto: 'Tiền mã hóa', bond: 'Trái phiếu', other: 'Khác' }
const qty = (v: HoldingValuation) => v.position.quantity.toNumber().toLocaleString('vi-VN', { maximumFractionDigits: 8 })

export function InvestmentDetailPage() {
  const { id } = useParams()
  const { data: view, isLoading, error } = useLedgerView()
  if (isLoading) return <LoadingState />
  if (error || !view) return <ErrorState error={error} />
  const account = view.accountById.get(id ?? '')
  if (!account || (account.kind !== 'investment' && account.kind !== 'other_asset')) return <EmptyState title="Không tìm thấy tài khoản đầu tư" />
  return account.kind === 'investment' ? <Investment account={account} view={view} /> : <OtherAsset account={account} view={view} />
}

function Investment({ account, view }: { account: Account; view: LedgerView }) {
  const txDialog = useTransactionDialog()
  const invalidate = useInvalidate()
  const toast = useToast()
  const [dialog, setDialog] = useState<'holding' | 'trade' | 'prices' | null>(null)
  const [editing, setEditing] = useState(false)
  const [tradeHolding, setTradeHolding] = useState<string>('')
  const valuations = view.ledger.holdingValuations(account, today())
  const holdingsValue = valuations.reduce((s, v) => s + v.marketValue, 0)
  const total = view.balances.get(account.id) ?? 0
  const trades = view.trades.filter((t) => valuations.some((v) => v.holding.id === t.holdingId)).sort((a, b) => b.date.localeCompare(a.date))
  const transactions = view.transactions.filter((t) => (t.accountId === account.id || t.toAccountId === account.id) && !t.groupId)

  return (
    <section className="flex flex-col gap-5">
      <Link to="/investments" className="text-sm text-brand">
        ‹ Đầu tư
      </Link>
      <div className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-sm text-muted">{account.kind === 'investment' && account.details.platform}</p>
        <h1 className="text-2xl font-semibold">{account.name}</h1>
        <p className="mt-2 text-3xl font-semibold">
          <Money value={total} />
        </p>
        <p className="mt-1 text-sm text-muted">
          Chứng khoán/tài sản <Money value={holdingsValue} /> · Tiền mặt <Money value={total - holdingsValue} />
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => setDialog('trade')} disabled={valuations.length === 0}>
            Mua / Bán
          </Button>
          <Button variant="secondary" onClick={() => setDialog('holding')}>
            Thêm mã
          </Button>
          <Button variant="secondary" onClick={() => setDialog('prices')} disabled={valuations.length === 0}>
            Cập nhật giá
          </Button>
          <Button variant="secondary" onClick={() => txDialog.openNew({ type: 'transfer', toAccountId: account.id })}>
            Nạp tiền
          </Button>
          <Button variant="secondary" onClick={() => txDialog.openNew({ type: 'income', accountId: account.id })}>
            Ghi cổ tức
          </Button>
        </div>
        <AccountAdmin account={account} view={view} onEdit={() => setEditing(true)} backTo="/investments" />
      </div>
      {editing && account.kind === 'investment' && <EditInvestmentDialog account={account} view={view} onClose={() => setEditing(false)} />}

      <section aria-label="Danh mục nắm giữ">
        <h2 className="mb-2 text-lg font-semibold">Đang nắm giữ</h2>
        {valuations.length === 0 ? (
          <EmptyState title="Chưa có mã nào">Bấm “Thêm mã” (VD: FPT, VESAF, SJC).</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Mã</th>
                  <th className="px-4 py-2 text-right font-medium">Số lượng</th>
                  <th className="px-4 py-2 text-right font-medium">Giá vốn TB</th>
                  <th className="px-4 py-2 text-right font-medium">Giá hiện tại</th>
                  <th className="px-4 py-2 text-right font-medium">Giá trị</th>
                  <th className="px-4 py-2 text-right font-medium">Lãi/lỗ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {valuations.map((v) => (
                  <tr key={v.holding.id}>
                    <td className="px-4 py-2">
                      <span className="font-medium">{v.holding.symbol}</span>
                      <span className="block text-xs text-muted">{ASSET_LABEL[v.holding.assetType]}</span>
                    </td>
                    <td className="tabular px-4 py-2 text-right">
                      {qty(v)} {v.holding.unit}
                    </td>
                    <td className="tabular px-4 py-2 text-right">{formatMoney(round(v.position.avgCost))}</td>
                    <td className="tabular px-4 py-2 text-right">
                      {formatMoney(v.price)}
                      <span className="block text-xs text-muted">{v.priceDate ? formatDate(v.priceDate) : 'chưa có giá'}</span>
                    </td>
                    <td className="tabular px-4 py-2 text-right">{formatMoney(v.marketValue)}</td>
                    <td className={`tabular px-4 py-2 text-right ${v.unrealized < 0 ? 'text-negative' : 'text-positive'}`}>
                      {formatMoney(v.unrealized, { sign: true })}
                      {v.returnPct !== null && <span className="block text-xs">{formatPercent(v.returnPct)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {trades.length > 0 && (
        <section aria-label="Lịch sử lệnh">
          <h2 className="mb-2 text-lg font-semibold">Lịch sử lệnh</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-sm">
            {trades.map((t) => {
              const h = valuations.find((v) => v.holding.id === t.holdingId)!.holding
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span>
                    {formatDate(t.date)} · <strong>{t.side === 'buy' ? 'Mua' : 'Bán'}</strong> {Number(t.quantity).toLocaleString('vi-VN', { maximumFractionDigits: 8 })} {h.symbol} × {formatMoney(t.price)}
                    {t.isOpening && ' (vị thế đầu kỳ)'}
                    {t.fee + t.tax > 0 && <span className="text-muted"> · phí/thuế {formatMoney(t.fee + t.tax)}</span>}
                  </span>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-sm text-negative"
                    onClick={async () => {
                      try {
                        await deleteTrade(getRepos(), t, view.trades)
                        await invalidate('trades', 'transactions')
                        toast({ message: 'Đã xóa lệnh', tone: 'info' })
                      } catch (e) {
                        toast({ message: e instanceof Error ? e.message : 'Không xóa được', tone: 'error' })
                      }
                    }}
                  >
                    Xóa
                  </Button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <h2 className="text-lg font-semibold">Nạp / rút / cổ tức</h2>
      {transactions.length === 0 ? <EmptyState title="Chưa có giao dịch tiền" /> : <TransactionList transactions={transactions} ctx={view} accountId={account.id} onSelect={txDialog.openEdit} />}

      {dialog === 'holding' && (
        <HoldingDialog
          account={account}
          view={view}
          onClose={(created) => {
            setDialog(created ? 'trade' : null)
            if (created) setTradeHolding(created)
          }}
        />
      )}
      {dialog === 'trade' && <TradeDialog account={account} view={view} holdings={valuations.map((v) => v.holding)} initialHolding={tradeHolding} onClose={() => setDialog(null)} />}
      {dialog === 'prices' && <PricesDialog valuations={valuations} onClose={() => setDialog(null)} />}
    </section>
  )
}

function HoldingDialog({ account, view, onClose }: { account: Account; view: LedgerView; onClose: (createdId?: string) => void }) {
  const invalidate = useInvalidate()
  const [symbol, setSymbol] = useState('')
  const [name, setName] = useState('')
  const [assetType, setAssetType] = useState<HoldingAssetType>('stock')
  const [unit, setUnit] = useState('cp')
  return (
    <FormDialog
      title="Thêm mã"
      submitLabel="Thêm và ghi lệnh"
      onClose={() => onClose()}
      onSubmit={async () => {
        const s = symbol.trim().toUpperCase()
        if (!/^[A-Z0-9._-]{1,20}$/.test(s)) return 'Mã chỉ gồm chữ, số và . _ - (VD FPT, SJC, BTC)'
        if (view.holdings.some((h) => h.accountId === account.id && h.symbol === s)) return 'Mã này đã có trong tài khoản'
        const h = await addHolding(getRepos(), { accountId: account.id, symbol: s, name: name.trim() || s, assetType, unit: unit.trim() || 'đơn vị', quantityDecimals: assetType === 'stock' ? 0 : 8 })
        await invalidate('holdings')
        onClose(h.id)
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Mã" placeholder="FPT, VESAF, SJC, BTC" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        <TextField label="Tên (không bắt buộc)" value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField
          label="Loại"
          value={assetType}
          onChange={(e) => {
            const t = e.target.value as HoldingAssetType
            setAssetType(t)
            setUnit(t === 'stock' ? 'cp' : t === 'fund' ? 'CCQ' : t === 'gold' ? 'chỉ' : t === 'crypto' ? 'coin' : 'đơn vị')
          }}
        >
          {HOLDING_ASSET_TYPES.map((t) => (
            <option key={t} value={t}>
              {ASSET_LABEL[t]}
            </option>
          ))}
        </SelectField>
        <TextField label="Đơn vị" value={unit} onChange={(e) => setUnit(e.target.value)} />
      </div>
    </FormDialog>
  )
}

type CostMode = 'percent' | 'amount'
interface RememberedCosts {
  feeMode: CostMode
  fee: string
  taxMode: CostMode
  tax: string
}

/** Mức phí / thuế dùng lần trước cho mã + loại lệnh này (VD CCQ bán: 1,5% và 0,1%) — tiện nhập lại. */
const costKey = (holdingId: string, side: 'buy' | 'sell') => `trade-costs:${holdingId}:${side}`
function rememberedCosts(holdingId: string, side: 'buy' | 'sell'): RememberedCosts {
  // Mặc định: phí theo %, thuế TNCN 0,1% trên giá trị bán (cổ phiếu, chứng chỉ quỹ tại Việt Nam).
  return readPref<RememberedCosts>(costKey(holdingId, side), { feeMode: 'percent', fee: '0', taxMode: 'percent', tax: side === 'sell' ? '0,1' : '0' })
}

/** Ô phí / thuế: nhập theo % giá trị lệnh hoặc số tiền. */
function CostField({ label, mode, onMode, value, onChange, computed }: { label: string; mode: CostMode; onMode: (m: CostMode) => void; value: string; onChange: (v: string) => void; computed: number | null }) {
  const id = `cost-${label}`
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label} {mode === 'percent' ? '(% giá trị lệnh)' : '(số tiền)'}
        </label>
        <div role="radiogroup" aria-label={`Cách nhập ${label.toLowerCase()}`} className="flex rounded-md bg-canvas p-0.5 text-xs font-medium">
          {(['percent', 'amount'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => onMode(m)} className={`rounded px-2 py-1 ${mode === m ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>
              {m === 'percent' ? '%' : '₫'}
            </button>
          ))}
        </div>
      </div>
      <input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-brand"
      />
      <p className="text-sm text-muted">{mode === 'percent' ? (computed === null ? '—' : `= ${formatMoney(computed)}`) : parseMoneyInput(value) !== null ? `= ${formatMoney(parseMoneyInput(value)!)}` : ''}</p>
    </div>
  )
}

function TradeDialog({ account, view, holdings, initialHolding, onClose }: { account: Account; view: LedgerView; holdings: Holding[]; initialHolding: string; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const allHoldings = [...holdings, ...view.holdings.filter((h) => h.accountId === account.id && !holdings.some((x) => x.id === h.id))]
  const firstHolding = initialHolding || allHoldings[0]?.id || ''
  const [holdingId, setHoldingId] = useState(firstHolding)
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [date, setDate] = useState(today())
  const [quantity, setQuantity] = useState('')
  const [priceMode, setPriceMode] = useState<'unit' | 'total'>(() => readPref<'unit' | 'total'>('trade-price-mode', 'total'))
  const [price, setPrice] = useState('')
  const [total, setTotal] = useState('')
  const [costs, setCosts] = useState<RememberedCosts>(() => rememberedCosts(firstHolding, 'buy'))
  const [cashAccountId, setCashAccountId] = useState(account.id)
  const [opening, setOpening] = useState(false)
  const holding = allHoldings.find((h) => h.id === holdingId)
  const position = holding ? positionAt(view.trades.filter((t) => t.holdingId === holding.id), '9999-12-31') : null
  const unit = holding?.unit ?? 'đơn vị'

  // Đổi mã / loại lệnh → nạp mức phí, thuế đã dùng lần trước cho đúng mã + loại lệnh đó.
  const choose = (nextHolding: string, nextSide: 'buy' | 'sell') => {
    setHoldingId(nextHolding)
    setSide(nextSide)
    setCosts(rememberedCosts(nextHolding, nextSide))
  }

  const q = parseQuantityInput(quantity)
  const unitPrice = parseMoneyInput(price)
  const totalValue = parseMoneyInput(total)
  const feeRate = parsePercentInput(costs.fee, 20)
  const taxRate = parsePercentInput(costs.tax, 20)
  const cost = (mode: CostMode, raw: string, rate: number | null): CostInput | null =>
    mode === 'percent' ? (rate === null ? null : { mode, rate }) : parseMoneyInput(raw) === null ? null : { mode, amount: parseMoneyInput(raw)! }
  const fee = cost(costs.feeMode, costs.fee, feeRate)
  const tax = cost(costs.taxMode, costs.tax, taxRate)
  const priceInput = priceMode === 'unit' ? (unitPrice === null ? null : { mode: 'unit' as const, unitPrice }) : totalValue === null ? null : { mode: 'total' as const, total: totalValue }
  const amounts = q && priceInput && fee && tax ? tradeAmounts({ side, quantity: q, price: priceInput, fee, tax }) : null

  return (
    <FormDialog
      title="Ghi lệnh"
      onClose={onClose}
      onSubmit={async () => {
        if (!holding) return 'Chọn mã'
        if (!q) return 'Số lượng không hợp lệ (VD 100 hoặc 196,5)'
        if (!priceInput) return priceMode === 'unit' ? `Nhập giá / ${unit}` : 'Nhập tổng giá trị lệnh'
        if (!fee || !tax) return 'Phí / thuế không hợp lệ (VD 1,5 cho 1,5% hoặc 20k)'
        if (date < account.openingDate) return `Ngày phải từ ${formatDate(account.openingDate)}`
        const a = tradeAmounts({ side, quantity: q, price: priceInput, fee, tax })
        const isOpening = side === 'buy' && opening
        await recordTrade(getRepos(), { account, holding, side, date, quantity: q, price: a.unitPrice, fee: isOpening ? 0 : a.fee, tax: isOpening ? 0 : a.tax, cashAccountId, isOpening }, view.trades)
        writePref(costKey(holding.id, side), costs)
        writePref('trade-price-mode', priceMode)
        await invalidate('trades', 'transactions')
        toast({ message: `Đã ghi lệnh ${side === 'buy' ? 'mua' : 'bán'} ${holding.symbol}` })
        onClose()
      }}
    >
      <SegmentedControl label="Loại lệnh" value={side} onChange={(s) => choose(holdingId, s)} options={[{ value: 'buy', label: 'Mua' }, { value: 'sell', label: 'Bán' }]} />
      <SelectField label="Mã" value={holdingId} onChange={(e) => choose(e.target.value, side)} hint={position ? `Đang có ${position.quantity.toNumber().toLocaleString('vi-VN', { maximumFractionDigits: 8 })} ${unit}` : undefined}>
        {allHoldings.map((h) => (
          <option key={h.id} value={h.id}>
            {h.symbol}
          </option>
        ))}
      </SelectField>
      <TextField label={`Số lượng (${unit})`} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} hint="Có thể nhập số lẻ, VD 196,52" />
      <SegmentedControl
        label="Nhập giá theo"
        value={priceMode}
        onChange={setPriceMode}
        options={[
          { value: 'total', label: 'Tổng tiền' },
          { value: 'unit', label: `Giá / ${unit}` },
        ]}
      />
      {priceMode === 'total' ? (
        <MoneyField label="Tổng giá trị lệnh (trước phí, thuế)" value={total} rawValue={total} onChange={(e) => setTotal(e.target.value)} hint="Số tiền mua / bán theo sao kê, chưa gồm phí và thuế" />
      ) : (
        <MoneyField label={`Giá / ${unit}`} value={price} rawValue={price} onChange={(e) => setPrice(e.target.value)} />
      )}
      {!(side === 'buy' && opening) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <CostField label="Phí" mode={costs.feeMode} onMode={(m) => setCosts((c) => ({ ...c, feeMode: m }))} value={costs.fee} onChange={(v) => setCosts((c) => ({ ...c, fee: v }))} computed={amounts?.fee ?? null} />
          <CostField label="Thuế" mode={costs.taxMode} onMode={(m) => setCosts((c) => ({ ...c, taxMode: m }))} value={costs.tax} onChange={(v) => setCosts((c) => ({ ...c, tax: v }))} computed={amounts?.tax ?? null} />
        </div>
      )}
      <TextField label="Ngày" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <SelectField label={side === 'buy' ? 'Trả tiền từ' : 'Nhận tiền vào'} value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)}>
        <AccountOptions accounts={view.accounts} balances={view.balances} filter={(a) => a.id === account.id || ['cash', 'bank', 'ewallet'].includes(a.kind)} />
      </SelectField>
      {side === 'buy' && <CheckboxField label="Vị thế đã có từ trước (không trừ tiền)" checked={opening} onChange={(e) => setOpening(e.target.checked)} />}
      {amounts && (
        <dl role="status" aria-label="Tóm tắt lệnh" className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-canvas px-3 py-2 text-sm">
          {priceMode === 'total' && (
            <>
              <dt className="text-muted">Giá / {unit}</dt>
              <dd className="text-right">≈ {formatMoney(amounts.unitPrice)}</dd>
            </>
          )}
          <dt className="text-muted">Giá trị lệnh</dt>
          <dd className="text-right">{formatMoney(amounts.gross)}</dd>
          {!(side === 'buy' && opening) && (
            <>
              <dt className="text-muted">Phí + thuế</dt>
              <dd className="text-right">{formatMoney(amounts.fee + amounts.tax)}</dd>
              <dt className="font-medium">{side === 'buy' ? 'Tổng tiền phải trả' : 'Tiền thực nhận'}</dt>
              <dd className="text-right font-semibold">{formatMoney(amounts.cash)}</dd>
            </>
          )}
          {side === 'sell' && position && position.quantity.gt(0) && q && (
            <>
              <dt className="text-muted">Lãi/lỗ thực hiện (trước phí, thuế)</dt>
              <dd className="text-right">{formatMoney(round(new D(q).times(new D(amounts.unitPrice).minus(position.avgCost))), { sign: true })}</dd>
            </>
          )}
          {amounts.roundingDifference !== 0 && (
            <dd className="col-span-2 mt-1 text-xs text-muted">
              Giá / {unit} được làm tròn tới đồng nên giá trị lệnh lệch {formatMoney(Math.abs(amounts.roundingDifference))} so với tổng bạn nhập. Nếu cần khớp từng đồng với ngân hàng, dùng Đối soát số dư.
            </dd>
          )}
        </dl>
      )}
    </FormDialog>
  )
}

function PricesDialog({ valuations, onClose }: { valuations: HoldingValuation[]; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [date, setDate] = useState(today())
  const [prices, setPrices] = useState<Record<string, string>>({})
  const symbols = [...new Map(valuations.map((v) => [v.holding.symbol, v])).values()]
  return (
    <FormDialog
      title="Cập nhật giá"
      onClose={onClose}
      onSubmit={async () => {
        const entries: { symbol: string; price: number }[] = []
        for (const v of symbols) {
          const raw = prices[v.holding.symbol]
          if (!raw) continue
          const p = parseMoneyInput(raw)
          if (p === null) return `Giá ${v.holding.symbol} không hợp lệ`
          entries.push({ symbol: v.holding.symbol, price: p })
        }
        if (entries.length === 0) return 'Nhập giá mới cho ít nhất một mã'
        await updatePrices(getRepos(), date, entries)
        await invalidate('priceQuotes')
        toast({ message: `Đã cập nhật giá ${entries.length} mã` })
        onClose()
      }}
    >
      <TextField label="Giá tại ngày" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      {symbols.map((v) => {
        const p = parseMoneyInput(prices[v.holding.symbol] ?? '')
        const jump = p && v.price > 0 && Math.abs(p / v.price - 1) > 0.5
        return (
          <MoneyField
            key={v.holding.symbol}
            label={`${v.holding.symbol} (giá cũ ${formatMoney(v.price)}${v.priceDate ? `, ${formatDate(v.priceDate)}` : ''})`}
            value={prices[v.holding.symbol] ?? ''}
            rawValue={prices[v.holding.symbol] ?? ''}
            onChange={(e) => setPrices((s) => ({ ...s, [v.holding.symbol]: e.target.value }))}
            hint={jump ? '⚠ Lệch hơn 50% so với giá cũ — kiểm tra lại' : undefined}
          />
        )
      })}
    </FormDialog>
  )
}

function OtherAsset({ account, view }: { account: Account; view: LedgerView }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [dialog, setDialog] = useState<'revalue' | 'sell' | null>(null)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const valuations = view.valuations.filter((v) => v.accountId === account.id).sort((a, b) => b.date.localeCompare(a.date))
  const current = view.balances.get(account.id) ?? 0

  return (
    <section className="flex flex-col gap-5">
      <Link to="/investments" className="text-sm text-brand">
        ‹ Đầu tư
      </Link>
      <div className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-sm text-muted">Tài sản khác{account.archivedAt && ' · đã bán'}</p>
        <h1 className="text-2xl font-semibold">{account.name}</h1>
        <p className="mt-2 text-3xl font-semibold">
          <Money value={current} />
        </p>
        {!account.archivedAt && (
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => setDialog('revalue')}>Định giá lại</Button>
            <Button variant="secondary" onClick={() => setDialog('sell')}>
              Bán tài sản
            </Button>
          </div>
        )}
        <AccountAdmin account={account} view={view} onEdit={() => setEditing(true)} backTo="/investments" />
      </div>
      {editing && account.kind === 'other_asset' && <EditOtherAssetDialog account={account} view={view} onClose={() => setEditing(false)} />}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Lịch sử định giá</h2>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-sm">
          {valuations.map((v) => (
            <li key={v.id} className="flex justify-between px-4 py-3">
              <span>
                {formatDate(v.date)}
                {v.note && <span className="text-muted"> · {v.note}</span>}
              </span>
              <Money value={v.value} />
            </li>
          ))}
          <li className="flex justify-between px-4 py-3 text-muted">
            <span>{formatDate(account.openingDate)} · giá trị ban đầu</span>
            <Money value={account.openingBalance} />
          </li>
        </ul>
      </section>
      {dialog === 'revalue' && (
        <FormDialog
          title="Định giá lại"
          onClose={() => setDialog(null)}
          onSubmit={async () => {
            const v = parseMoneyInput(value)
            if (v === null) return 'Nhập giá trị'
            if (date < account.openingDate) return `Ngày phải từ ${formatDate(account.openingDate)}`
            await revalueAsset(getRepos(), account, date, v, note)
            await invalidate('valuations')
            toast({ message: 'Đã cập nhật giá trị' })
            setDialog(null)
          }}
        >
          <MoneyField label="Giá trị mới" value={value} rawValue={value} onChange={(e) => setValue(e.target.value)} />
          <TextField label="Tại ngày" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Ghi chú" placeholder="VD: theo giá thị trường khu vực" value={note} onChange={(e) => setNote(e.target.value)} />
        </FormDialog>
      )}
      {dialog === 'sell' && (
        <FormDialog
          title={`Bán ${account.name}`}
          submitLabel="Xác nhận bán"
          onClose={() => setDialog(null)}
          onSubmit={async () => {
            const v = parseMoneyInput(value)
            if (v === null) return 'Nhập giá bán'
            if (!toAccountId) return 'Chọn tài khoản nhận tiền'
            const to = view.accountById.get(toAccountId)!
            if (date < to.openingDate || date < account.openingDate) return 'Ngày bán phải sau ngày bắt đầu theo dõi của cả hai tài khoản'
            await sellOtherAsset(getRepos(), account, { date, price: v, toAccountId })
            await invalidate('valuations', 'transactions', 'accounts')
            toast({ message: `Đã bán ${account.name}` })
            setDialog(null)
          }}
        >
          <MoneyField label="Giá bán" value={value} rawValue={value} onChange={(e) => setValue(e.target.value)} hint={`Giá trị hiện tại ${formatMoney(current)}`} />
          <TextField label="Ngày bán" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <SelectField label="Nhận tiền vào" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
            <AccountOptions accounts={view.accounts} balances={view.balances} filter={(a) => ['cash', 'bank', 'ewallet', 'goal_fund'].includes(a.kind)} />
          </SelectField>
        </FormDialog>
      )}
    </section>
  )
}
