import { useState } from 'react'
import { Link } from 'react-router'
import { FormDialog } from '../../components/ui/FormDialog'
import { Button, MoneyField, TextField } from '../../components/ui/form'
import { EmptyState, ErrorState, LoadingState, Money } from '../../components/ui/Money'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, useLedgerView, type LedgerView } from '../../data/queries'
import { today } from '../../lib/clock'
import { formatDate, formatPercent, parseMoneyInput } from '../../lib/format'
import type { Account } from '../../schemas'
import { createInvestmentAccount, createOtherAsset } from '../../services/investments'

export function InvestmentsPage() {
  const { data: view, isLoading, error } = useLedgerView()
  const [dialog, setDialog] = useState<'investment' | 'asset' | null>(null)
  if (isLoading) return <LoadingState />
  if (error || !view) return <ErrorState error={error} />

  const investments = view.accounts.filter((a) => a.kind === 'investment' && !a.archivedAt)
  const assets = view.accounts.filter((a) => a.kind === 'other_asset' && !a.archivedAt)
  const total = [...investments, ...assets].reduce((s, a) => s + (view.balances.get(a.id) ?? 0), 0)

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Đầu tư</h1>
          <p className="text-sm text-muted">
            Tổng giá trị: <Money value={total} className="font-semibold text-ink" />
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setDialog('asset')}>
            Thêm tài sản khác
          </Button>
          <Button onClick={() => setDialog('investment')}>Thêm tài khoản đầu tư</Button>
        </div>
      </div>

      <section aria-label="Tài khoản đầu tư">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">Tài khoản đầu tư</h2>
        {investments.length === 0 ? (
          <EmptyState title="Chưa có tài khoản đầu tư">Cổ phiếu, chứng chỉ quỹ, vàng, crypto… — mỗi nơi nắm giữ là một tài khoản.</EmptyState>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {investments.map((a) => (
              <InvestmentRow key={a.id} account={a} view={view} />
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Tài sản khác">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">Tài sản khác</h2>
        {assets.length === 0 ? (
          <EmptyState title="Chưa có tài sản khác">Nhà, xe, đồ giá trị — nhập giá trị ước tính và định giá lại khi cần.</EmptyState>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {assets.map((a) => {
              const last = view.valuations.filter((v) => v.accountId === a.id).sort((x, y) => y.date.localeCompare(x.date))[0]
              return (
                <li key={a.id}>
                  <Link to={`/investments/${a.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-canvas">
                    <span>
                      <span className="block font-medium">{a.name}</span>
                      <span className="block text-sm text-muted">Định giá {formatDate(last?.date ?? a.openingDate)}</span>
                    </span>
                    <Money value={view.balances.get(a.id) ?? 0} className="font-medium" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {dialog === 'investment' && <InvestmentAccountDialog view={view} onClose={() => setDialog(null)} />}
      {dialog === 'asset' && <OtherAssetDialog view={view} onClose={() => setDialog(null)} />}
    </section>
  )
}

function InvestmentRow({ account, view }: { account: Account; view: LedgerView }) {
  const valuations = view.ledger.holdingValuations(account, today())
  const cost = valuations.reduce((s, v) => s + v.position.costBasis, 0)
  const unrealized = valuations.reduce((s, v) => s + v.unrealized, 0)
  return (
    <li>
      <Link to={`/investments/${account.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-canvas">
        <span>
          <span className="block font-medium">{account.name}</span>
          <span className="block text-sm text-muted">
            {valuations.filter((v) => v.position.quantity.gt(0)).length} mã
            {cost > 0 && (
              <>
                {' · '}
                <span className={unrealized >= 0 ? 'text-positive' : 'text-negative'}>
                  {unrealized >= 0 ? '+' : '−'}
                  {formatPercent(Math.abs(unrealized / cost))}
                </span>
              </>
            )}
          </span>
        </span>
        <Money value={view.balances.get(account.id) ?? 0} className="font-medium" />
      </Link>
    </li>
  )
}

function InvestmentAccountDialog({ view, onClose }: { view: LedgerView; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState('')
  const [cash, setCash] = useState('0')
  const [date, setDate] = useState(today())
  return (
    <FormDialog
      title="Thêm tài khoản đầu tư"
      onClose={onClose}
      onSubmit={async () => {
        const c = parseMoneyInput(cash)
        if (!name.trim()) return 'Nhập tên'
        if (c === null) return 'Tiền mặt không hợp lệ'
        if (date > today()) return 'Ngày bắt đầu không được ở tương lai'
        await createInvestmentAccount(getRepos(), { name: name.trim(), platform, cash: c, openingDate: date }, view.accounts.length)
        await invalidate('accounts')
        toast({ message: `Đã thêm "${name.trim()}"` })
        onClose()
      }}
    >
      <TextField label="Tên" placeholder="VD: Chứng khoán SSI, Vàng tích trữ" value={name} onChange={(e) => setName(e.target.value)} />
      <TextField label="Nơi nắm giữ (không bắt buộc)" placeholder="SSI, VNDirect, Fmarket, tiệm vàng…" value={platform} onChange={(e) => setPlatform(e.target.value)} />
      <MoneyField label="Tiền mặt đang có trong tài khoản" value={cash} rawValue={cash} onChange={(e) => setCash(e.target.value)} hint="Mã đang nắm giữ sẵn sẽ thêm ở bước sau" />
      <TextField label="Tính từ ngày" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
    </FormDialog>
  )
}

function OtherAssetDialog({ view, onClose }: { view: LedgerView; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  return (
    <FormDialog
      title="Thêm tài sản khác"
      onClose={onClose}
      onSubmit={async () => {
        const v = parseMoneyInput(value)
        if (!name.trim()) return 'Nhập tên tài sản'
        if (v === null) return 'Nhập giá trị ước tính'
        await createOtherAsset(getRepos(), { name: name.trim(), value: v, date, note }, view.accounts.length)
        await invalidate('accounts')
        toast({ message: `Đã thêm "${name.trim()}"` })
        onClose()
      }}
    >
      <TextField label="Tên" placeholder="VD: Căn hộ Q7, Xe máy" value={name} onChange={(e) => setName(e.target.value)} />
      <MoneyField label="Giá trị ước tính" value={value} rawValue={value} onChange={(e) => setValue(e.target.value)} />
      <TextField label="Tại ngày" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <TextField label="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
    </FormDialog>
  )
}
