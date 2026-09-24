import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { FormDialog } from '../../components/ui/FormDialog'
import { Button, CheckboxField, MoneyField, SegmentedControl, SelectField, TextField } from '../../components/ui/form'
import { EmptyState, ErrorState, LoadingState, Money } from '../../components/ui/Money'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, useLedgerView, type LedgerView } from '../../data/queries'
import { positionAt, type HoldingValuation } from '../../domain/investment'
import { D, round } from '../../domain/money'
import { today } from '../../lib/clock'
import { formatDate, formatMoney, formatPercent, parseMoneyInput, parseQuantityInput } from '../../lib/format'
import { HOLDING_ASSET_TYPES, type Account, type Holding, type HoldingAssetType } from '../../schemas'
import { addHolding, deleteTrade, recordTrade, revalueAsset, sellOtherAsset, updatePrices } from '../../services/investments'
import { AccountOptions } from '../transactions/pickers'
import { TransactionList } from '../transactions/TransactionList'
import { useTransactionDialog } from '../transactions/transactionDialogContext'

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
      </div>

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

function TradeDialog({ account, view, holdings, initialHolding, onClose }: { account: Account; view: LedgerView; holdings: Holding[]; initialHolding: string; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const allHoldings = [...holdings, ...view.holdings.filter((h) => h.accountId === account.id && !holdings.some((x) => x.id === h.id))]
  const [holdingId, setHoldingId] = useState(initialHolding || allHoldings[0]?.id || '')
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [date, setDate] = useState(today())
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [fee, setFee] = useState('0')
  const [tax, setTax] = useState('0')
  const [cashAccountId, setCashAccountId] = useState(account.id)
  const [opening, setOpening] = useState(false)
  const holding = allHoldings.find((h) => h.id === holdingId)
  const q = parseQuantityInput(quantity)
  const p = parseMoneyInput(price)
  const gross = q && p !== null ? round(new D(q).times(p)) : null
  const position = holding ? positionAt(view.trades.filter((t) => t.holdingId === holding.id), '9999-12-31') : null

  return (
    <FormDialog
      title="Ghi lệnh"
      onClose={onClose}
      onSubmit={async () => {
        if (!holding) return 'Chọn mã'
        if (!q) return 'Số lượng không hợp lệ (VD 100 hoặc 0,5)'
        if (p === null) return 'Nhập giá'
        const f = parseMoneyInput(fee) ?? -1
        const t = parseMoneyInput(tax) ?? -1
        if (f < 0 || t < 0) return 'Phí / thuế không hợp lệ'
        if (date < account.openingDate) return `Ngày phải từ ${formatDate(account.openingDate)}`
        await recordTrade(getRepos(), { account, holding, side, date, quantity: q, price: p, fee: f, tax: t, cashAccountId, isOpening: side === 'buy' && opening }, view.trades)
        await invalidate('trades', 'transactions')
        toast({ message: `Đã ghi lệnh ${side === 'buy' ? 'mua' : 'bán'} ${holding.symbol}` })
        onClose()
      }}
    >
      <SegmentedControl label="Loại lệnh" value={side} onChange={setSide} options={[{ value: 'buy', label: 'Mua' }, { value: 'sell', label: 'Bán' }]} />
      <SelectField label="Mã" value={holdingId} onChange={(e) => setHoldingId(e.target.value)} hint={position ? `Đang có ${position.quantity.toNumber().toLocaleString('vi-VN')} ${holding?.unit}` : undefined}>
        {allHoldings.map((h) => (
          <option key={h.id} value={h.id}>
            {h.symbol}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Số lượng" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <MoneyField label={`Giá / ${holding?.unit ?? 'đơn vị'}`} value={price} rawValue={price} onChange={(e) => setPrice(e.target.value)} />
        <MoneyField label="Phí" value={fee} rawValue={fee} onChange={(e) => setFee(e.target.value)} />
        <MoneyField label="Thuế" value={tax} rawValue={tax} onChange={(e) => setTax(e.target.value)} />
      </div>
      <TextField label="Ngày" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <SelectField label={side === 'buy' ? 'Trả tiền từ' : 'Nhận tiền vào'} value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)}>
        <AccountOptions accounts={view.accounts} balances={view.balances} filter={(a) => a.id === account.id || ['cash', 'bank', 'ewallet'].includes(a.kind)} />
      </SelectField>
      {side === 'buy' && <CheckboxField label="Vị thế đã có từ trước (không trừ tiền)" checked={opening} onChange={(e) => setOpening(e.target.checked)} />}
      {gross !== null && (
        <p role="status" className="rounded-lg bg-canvas px-3 py-2 text-sm">
          Giá trị lệnh {formatMoney(gross)}
          {side === 'sell' && position && position.quantity.gt(0) && p !== null && q && (
            <> · lãi/lỗ thực hiện ước tính {formatMoney(round(new D(q).times(new D(p).minus(position.avgCost))), { sign: true })}</>
          )}
        </p>
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
      </div>
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
