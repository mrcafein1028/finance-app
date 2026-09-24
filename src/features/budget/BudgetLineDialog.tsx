import { useState } from 'react'
import { Button, CheckboxField, FormAlert, MoneyField, SegmentedControl, SelectField } from '../../components/ui/form'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, type BudgetLine, type LedgerView } from '../../data/queries'
import { averageSpending, withDescendants } from '../../domain/budget'
import type { PeriodRange } from '../../domain/period'
import { formatMoney, parseMoneyInput } from '../../lib/format'
import type { BudgetTarget } from '../../schemas'
import { removeLine, saveLine } from '../../services/budget'
import { AccountOptions } from '../transactions/pickers'

export interface LineDialogState {
  line: BudgetLine | null
  preset?: BudgetTarget
}

function Content({
  month,
  view,
  state,
  monthLines,
  historyRanges,
  onClose,
}: {
  open: boolean
  month: string
  view: LedgerView
  state: LineDialogState
  monthLines: readonly BudgetLine[]
  historyRanges: readonly PeriodRange[]
  onClose: () => void
}) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const initial = state.line?.target ?? state.preset
  const [kind, setKind] = useState<'category' | 'account'>(initial?.kind ?? 'category')
  const [categoryId, setCategoryId] = useState(initial?.kind === 'category' ? initial.categoryId : '')
  const [accountId, setAccountId] = useState(initial?.kind === 'account' ? initial.accountId : '')
  const [planned, setPlanned] = useState(state.line ? String(state.line.planned) : '')
  const [rollover, setRollover] = useState(state.line?.rollover ?? false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const expenseCats = view.categories.filter((c) => c.type === 'expense' && !c.archivedAt)
  const parents = expenseCats.filter((c) => c.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder)
  const avg = kind === 'category' && categoryId ? averageSpending(categoryId, view.categories, view.transactions, historyRanges) : 0

  async function save() {
    setError(null)
    const amount = parseMoneyInput(planned)
    if (amount === null) return setError('Nhập số tiền kế hoạch (có thể là 0)')
    const target: BudgetTarget | null = kind === 'category' ? (categoryId ? { kind, categoryId } : null) : accountId ? { kind, accountId } : null
    if (!target) return setError(kind === 'category' ? 'Chọn danh mục' : 'Chọn quỹ / tài khoản')
    if (target.kind === 'category') {
      // Không đặt ngân sách đồng thời cho nhóm cha và danh mục con của nó (docs/03 §3.9).
      const family = withDescendants(target.categoryId, view.categories)
      const parentId = view.categoryById.get(target.categoryId)?.parentId
      const clash = monthLines.find(
        (l) => l.id !== state.line?.id && l.target.kind === 'category' && (family.has(l.target.categoryId) || l.target.categoryId === parentId) && l.target.categoryId !== target.categoryId,
      )
      if (clash) return setError('Đã có ngân sách cho nhóm cha hoặc danh mục con của mục này — chỉ đặt ở một cấp')
    }
    setBusy(true)
    try {
      if (state.line && state.line.targetKey !== (target.kind === 'category' ? `c:${target.categoryId}` : `a:${target.accountId}`)) await removeLine(getRepos(), state.line)
      await saveLine(getRepos(), month, target, amount, rollover)
      await invalidate('budgetLines')
      toast({ message: 'Đã lưu dòng ngân sách' })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!state.line) return
    await removeLine(getRepos(), state.line)
    await invalidate('budgetLines')
    toast({ message: 'Đã xóa dòng ngân sách', tone: 'info' })
    onClose()
  }

  return (
    <Modal
      open
      title={state.line ? 'Sửa dòng ngân sách' : 'Thêm dòng ngân sách'}
      onClose={onClose}
      footer={
        <>
          {state.line && (
            <Button variant="ghost" className="mr-auto text-negative" onClick={remove}>
              Xóa dòng
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={save} disabled={busy}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <SegmentedControl
          label="Loại dòng"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'category', label: 'Chi tiêu' },
            { value: 'account', label: 'Tiết kiệm / trả nợ' },
          ]}
        />
        {kind === 'category' ? (
          <SelectField label="Danh mục" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} hint="Chọn nhóm cha để gom cả các danh mục con">
            <option value="">— Chọn danh mục —</option>
            {parents.map((p) => {
              const children = expenseCats.filter((c) => c.parentId === p.id)
              return children.length === 0 ? (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ) : (
                <optgroup key={p.id} label={p.name}>
                  <option value={p.id}>{p.name} (cả nhóm)</option>
                  {children.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )
            })}
          </SelectField>
        ) : (
          <SelectField label="Quỹ / tài khoản" value={accountId} onChange={(e) => setAccountId(e.target.value)} hint="Tiền chuyển vào đây từ tài khoản tiền trong tháng sẽ được tính là đã làm">
            <AccountOptions accounts={view.accounts} balances={view.balances} filter={(a) => a.kind !== 'cash' && a.kind !== 'bank' && a.kind !== 'ewallet'} />
          </SelectField>
        )}
        <MoneyField
          label="Kế hoạch tháng này"
          value={planned}
          rawValue={planned}
          onChange={(e) => setPlanned(e.target.value)}
          hint={avg > 0 ? `Trung bình ${historyRanges.length} tháng trước bạn chi ${formatMoney(avg)}` : undefined}
        />
        <CheckboxField
          label="Chuyển phần dư / thiếu sang tháng sau"
          hint="Tháng này tiêu ít hơn → tháng sau được thêm; tiêu vượt → tháng sau bị trừ."
          checked={rollover}
          onChange={(e) => setRollover(e.target.checked)}
        />
      </div>
    </Modal>
  )
}

export function BudgetLineDialog(props: Parameters<typeof Content>[0]) {
  return props.open ? <Content {...props} /> : null
}
