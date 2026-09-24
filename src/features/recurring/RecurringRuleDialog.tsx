import { useState } from 'react'
import { Button, FormAlert, MoneyField, SegmentedControl, SelectField, TextField } from '../../components/ui/form'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, type LedgerView } from '../../data/queries'
import { today } from '../../lib/clock'
import { parseMoneyInput } from '../../lib/format'
import type { RecurringRule, TransactionTemplate } from '../../schemas'
import { createRule, deleteRule, pauseRule, updateRule, type RuleDraft } from '../../services/recurring'
import { AccountOptions, CategoryOptions } from '../transactions/pickers'

type TemplateType = 'expense' | 'income' | 'transfer'

function Content({ view, rule, onClose }: { open: boolean; view: LedgerView; rule: RecurringRule | null; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const t = rule?.template
  const [name, setName] = useState(rule?.name ?? '')
  const [type, setType] = useState<TemplateType>(t?.type === 'income' || t?.type === 'transfer' ? t.type : 'expense')
  const [amount, setAmount] = useState(t ? String(t.amount) : '')
  const [accountId, setAccountId] = useState(t?.accountId ?? '')
  const [toAccountId, setToAccountId] = useState(t?.toAccountId ?? '')
  const [categoryId, setCategoryId] = useState(t?.categoryId ?? '')
  const [frequency, setFrequency] = useState<RecurringRule['frequency']>(rule?.frequency ?? 'monthly')
  const [intervalCount, setIntervalCount] = useState(rule?.intervalCount ?? 1)
  const [dayOfMonth, setDayOfMonth] = useState(rule?.dayOfMonth ?? Number(today().slice(8)))
  const [startDate, setStartDate] = useState(rule?.startDate ?? today())
  const [endDate, setEndDate] = useState(rule?.endDate ?? '')
  const [mode, setMode] = useState<RecurringRule['mode']>(rule?.mode ?? 'auto')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setError(null)
    const value = parseMoneyInput(amount)
    if (!name.trim()) return setError('Nhập tên (VD: Lương, Tiền nhà)')
    if (!value) return setError('Nhập số tiền lớn hơn 0')
    if (!accountId) return setError('Chọn tài khoản')
    if (type === 'transfer' ? !toAccountId || toAccountId === accountId : !categoryId) return setError(type === 'transfer' ? 'Chọn tài khoản nhận khác tài khoản nguồn' : 'Chọn danh mục')
    if (endDate && endDate <= startDate) return setError('Ngày kết thúc phải sau ngày bắt đầu')
    const template: TransactionTemplate =
      type === 'transfer'
        ? { type, amount: value, accountId, toAccountId, categoryId: null, direction: null, note: name.trim(), tags: [] }
        : { type, amount: value, accountId, categoryId, toAccountId: null, direction: null, note: name.trim(), tags: [] }
    const draft: RuleDraft = {
      name: name.trim(),
      template,
      frequency,
      intervalCount,
      dayOfMonth: frequency === 'weekly' ? null : dayOfMonth,
      startDate,
      endDate: endDate || null,
      mode,
    }
    setBusy(true)
    try {
      if (rule) await updateRule(getRepos(), rule, draft)
      else await createRule(getRepos(), draft)
      await invalidate('recurringRules')
      toast({ message: rule ? 'Đã cập nhật giao dịch định kỳ' : 'Đã tạo giao dịch định kỳ' })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được')
    } finally {
      setBusy(false)
    }
  }

  async function act(action: () => Promise<unknown>, message: string) {
    await action()
    await invalidate('recurringRules')
    toast({ message, tone: 'info' })
    onClose()
  }

  return (
    <Modal
      open
      title={rule ? 'Sửa giao dịch định kỳ' : 'Thêm giao dịch định kỳ'}
      onClose={onClose}
      footer={
        <>
          {rule && (
            <>
              <Button variant="ghost" className="mr-auto text-negative" onClick={() => act(() => deleteRule(getRepos(), rule), 'Đã xóa quy tắc (giao dịch đã ghi vẫn giữ)')}>
                Xóa
              </Button>
              <Button variant="secondary" onClick={() => act(() => pauseRule(getRepos(), rule, !rule.pausedAt), rule.pausedAt ? 'Đã tiếp tục' : 'Đã tạm dừng')}>
                {rule.pausedAt ? 'Tiếp tục' : 'Tạm dừng'}
              </Button>
            </>
          )}
          <Button onClick={save} disabled={busy}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <TextField label="Tên" placeholder="VD: Lương, Tiền nhà, Internet" value={name} onChange={(e) => setName(e.target.value)} />
        <SegmentedControl
          label="Loại"
          value={type}
          onChange={(v) => {
            setType(v)
            setCategoryId('')
          }}
          options={[
            { value: 'expense', label: 'Chi' },
            { value: 'income', label: 'Thu' },
            { value: 'transfer', label: 'Chuyển' },
          ]}
        />
        <MoneyField label="Số tiền" value={amount} rawValue={amount} onChange={(e) => setAmount(e.target.value)} />
        {type === 'transfer' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Từ tài khoản" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <AccountOptions accounts={view.accounts} balances={view.balances} />
            </SelectField>
            <SelectField label="Đến tài khoản" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              <AccountOptions accounts={view.accounts} balances={view.balances} />
            </SelectField>
          </div>
        ) : (
          <>
            <SelectField label="Danh mục" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <CategoryOptions categories={view.categories} type={type === 'income' ? 'income' : 'expense'} />
            </SelectField>
            <SelectField label="Tài khoản" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <AccountOptions accounts={view.accounts} balances={view.balances} filter={type === 'income' ? (a) => a.class === 'asset' : undefined} />
            </SelectField>
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField label="Lặp lại" value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringRule['frequency'])}>
            <option value="monthly">Hằng tháng</option>
            <option value="weekly">Hằng tuần</option>
            <option value="yearly">Hằng năm</option>
          </SelectField>
          <SelectField label="Mỗi" value={intervalCount} onChange={(e) => setIntervalCount(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {frequency === 'weekly' ? 'tuần' : frequency === 'monthly' ? 'tháng' : 'năm'}
              </option>
            ))}
          </SelectField>
          {frequency !== 'weekly' && (
            <SelectField label="Vào ngày" value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d === 31 ? 'Cuối tháng' : `Ngày ${d}`}
                </option>
              ))}
            </SelectField>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Bắt đầu từ" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <TextField label="Kết thúc (không bắt buộc)" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <SelectField label="Khi đến ngày" value={mode} onChange={(e) => setMode(e.target.value as RecurringRule['mode'])}>
          <option value="auto">Tự động ghi (VD lương cố định)</option>
          <option value="confirm">Hỏi tôi xác nhận số tiền (VD tiền điện)</option>
        </SelectField>
      </div>
    </Modal>
  )
}

export function RecurringRuleDialog(props: Parameters<typeof Content>[0]) {
  return props.open ? <Content {...props} /> : null
}
