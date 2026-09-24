import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Button, FormAlert, MoneyField, SegmentedControl, SelectField, TextField } from '../../components/ui/form'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useBudgetMonths, useInvalidate, useLedgerView, useSettings } from '../../data/queries'
import { ledgerBalance } from '../../domain/balance'
import type { CheckWarning } from '../../domain/validation'
import { today } from '../../lib/clock'
import { formatMoney } from '../../lib/format'
import { pushRecent, readPref, writePref } from '../../lib/prefs'
import type { Account, Transaction } from '../../schemas'
import { transactionFormSchema, type TransactionFormInput, type TransactionFormType, type TransactionFormValues } from '../../schemas/forms'
import { deleteTransaction, saveTransaction, transactionFromForm } from '../../services/transactions'
import { AccountOptions, CategoryOptions } from './pickers'

export interface TransactionPreset {
  type?: TransactionFormType
  accountId?: string
  toAccountId?: string
}

const TYPE_OPTIONS = [
  { value: 'expense', label: 'Chi' },
  { value: 'income', label: 'Thu' },
  { value: 'transfer', label: 'Chuyển' },
  { value: 'refund', label: 'Hoàn tiền' },
] as const

const TYPE_TITLES: Record<TransactionFormType, string> = { expense: 'khoản chi', income: 'khoản thu', transfer: 'chuyển khoản', refund: 'hoàn tiền' }

function defaults(editing: Transaction | null, preset: TransactionPreset, accounts: readonly Account[] | undefined): TransactionFormInput {
  if (editing && editing.type !== 'adjustment') {
    return {
      type: editing.type,
      amount: String(editing.amount),
      date: editing.date,
      accountId: editing.accountId,
      toAccountId: editing.toAccountId ?? '',
      categoryId: editing.categoryId ?? '',
      note: editing.note ?? '',
    }
  }
  // Tài khoản nhớ lần trước có thể đã bị lưu trữ/xóa.
  const remembered = readPref<string>('last-account', '')
  const usable = accounts?.some((a) => a.id === remembered && !a.archivedAt) ? remembered : ''
  return {
    type: preset.type ?? 'expense',
    amount: '',
    date: today(),
    accountId: preset.accountId ?? usable,
    toAccountId: preset.toAccountId ?? '',
    categoryId: '',
    note: '',
  }
}

function TransactionFormDialogContent({
  open,
  editing,
  preset,
  onClose,
}: {
  open: boolean
  editing: Transaction | null
  preset: TransactionPreset
  onClose: () => void
}) {
  const { data: view } = useLedgerView()
  const settings = useSettings().data
  const budgetMonths = useBudgetMonths().data
  const invalidate = useInvalidate()
  const toast = useToast()
  const [warnings, setWarnings] = useState<CheckWarning[] | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const form = useForm<TransactionFormInput, unknown, TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: defaults(editing, preset, view?.accounts),
  })
  const { register, handleSubmit, control, setValue, setError, formState } = form


  const type = useWatch({ control, name: 'type' })
  const amountRaw = useWatch({ control, name: 'amount' })
  const date = useWatch({ control, name: 'date' })
  const recent = useMemo(() => (open ? readPref<string[]>(`recent-categories:${type === 'income' ? 'income' : 'expense'}`, []) : []), [open, type])
  const closedMonths = useMemo(() => new Set((budgetMonths ?? []).filter((m) => m.status === 'closed').map((m) => m.month)), [budgetMonths])

  const readOnlyReason =
    editing?.type === 'adjustment'
      ? 'Đây là điều chỉnh số dư từ đối soát — chỉ có thể xóa.'
      : editing?.groupId
        ? 'Giao dịch thuộc một nghiệp vụ nhiều phần (VD trả nợ gốc + lãi) — sửa ở màn hình nghiệp vụ đó; xóa sẽ xóa cả nhóm.'
        : null

  async function submit(values: TransactionFormValues, confirmed: boolean) {
    if (!view) return
    setFormError(null)
    const tx = transactionFromForm(values, editing)
    try {
      const outcome = await saveTransaction(
        getRepos(),
        tx,
        {
          accounts: view.accounts,
          categories: view.categories,
          transactions: view.transactions,
          today: today(),
          periodStartDay: settings?.periodStartDay ?? 1,
          closedMonths,
          editing,
        },
        { confirmed },
      )
      if (outcome.status === 'invalid') {
        for (const e of outcome.errors) {
          if (e.path in values) setError(e.path as keyof TransactionFormInput, { message: e.message })
          else setFormError(e.message)
        }
        return
      }
      if (outcome.status === 'needs_confirmation') {
        setWarnings(outcome.warnings)
        return
      }
      await invalidate('transactions')
      if (values.type !== 'transfer') pushRecent(`recent-categories:${values.type === 'income' ? 'income' : 'expense'}`, values.categoryId)
      writePref('last-account', values.accountId)

      const account = view.accountById.get(values.accountId)
      const others = view.transactions.filter((t) => t.id !== outcome.transaction.id)
      const balance = account ? ledgerBalance(account, [...others, outcome.transaction], today()) : null
      toast({
        message: `Đã lưu${account && balance !== null ? ` · ${account.name} ${account.class === 'liability' ? 'còn nợ' : 'còn'} ${formatMoney(balance)}` : ''}`,
        action: {
          label: 'Hoàn tác',
          onClick: async () => {
            await outcome.undo()
            await invalidate('transactions')
            toast({ message: 'Đã hoàn tác', tone: 'info', durationMs: 2500 })
          },
        },
      })
      onClose()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Không lưu được, vui lòng thử lại')
    }
  }

  async function remove() {
    if (!editing || !view) return
    try {
      const undo = await deleteTransaction(getRepos(), editing, view.transactions)
      await invalidate('transactions')
      toast({
        message: editing.groupId ? 'Đã xóa cả nhóm giao dịch' : 'Đã xóa giao dịch',
        action: {
          label: 'Hoàn tác',
          onClick: async () => {
            await undo()
            await invalidate('transactions')
            toast({ message: 'Đã khôi phục giao dịch', tone: 'info', durationMs: 2500 })
          },
        },
      })
      onClose()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Không xóa được, vui lòng thử lại')
    }
  }

  const accountFilter = type === 'income' ? (a: { class: string }) => a.class === 'asset' : undefined
  const needsConfirm = warnings?.some((w) => w.confirm)
  const title = editing ? 'Sửa giao dịch' : `Thêm ${TYPE_TITLES[type]}`

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          {editing &&
            (confirmDelete ? (
              <Button variant="danger" onClick={remove} className="mr-auto">
                Xác nhận xóa
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="mr-auto text-negative">
                Xóa
              </Button>
            ))}
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          {!readOnlyReason &&
            (needsConfirm ? (
              <Button onClick={handleSubmit((v) => submit(v, true))} disabled={formState.isSubmitting}>
                Vẫn lưu
              </Button>
            ) : (
              <Button type="submit" form="transaction-form" disabled={formState.isSubmitting || !view}>
                {formState.isSubmitting ? 'Đang lưu…' : 'Lưu'}
              </Button>
            ))}
        </>
      }
    >
      {readOnlyReason ? (
        <FormAlert tone="warning">{readOnlyReason}</FormAlert>
      ) : (
        <form id="transaction-form" noValidate onSubmit={handleSubmit((v) => submit(v, false))} className="flex flex-col gap-4">
          <SegmentedControl
            label="Loại giao dịch"
            options={TYPE_OPTIONS}
            value={type}
            onChange={(v) => {
              setValue('type', v)
              setValue('categoryId', '')
              setWarnings(null)
            }}
          />
          {formError && <FormAlert tone="error">{formError}</FormAlert>}
          {warnings && warnings.length > 0 && (
            <FormAlert tone="warning">
              <ul className="list-disc space-y-1 pl-4">
                {warnings.map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
              </ul>
              {needsConfirm && <p className="mt-2">Kiểm tra lại, hoặc bấm “Vẫn lưu”.</p>}
            </FormAlert>
          )}

          <MoneyField label="Số tiền" rawValue={amountRaw} error={formState.errors.amount?.message} {...register('amount', { onChange: () => setWarnings(null) })} />

          {type === 'transfer' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Từ tài khoản" error={formState.errors.accountId?.message} {...register('accountId', { onChange: () => setWarnings(null) })}>
                {view && <AccountOptions accounts={view.accounts} balances={view.balances} keep={editing?.accountId} />}
              </SelectField>
              <SelectField label="Đến tài khoản" error={formState.errors.toAccountId?.message} {...register('toAccountId', { onChange: () => setWarnings(null) })}>
                {view && <AccountOptions accounts={view.accounts} balances={view.balances} keep={editing?.toAccountId} />}
              </SelectField>
            </div>
          ) : (
            <>
              <SelectField label="Danh mục" error={formState.errors.categoryId?.message} {...register('categoryId', { onChange: () => setWarnings(null) })}>
                {view && <CategoryOptions categories={view.categories} type={type === 'income' ? 'income' : 'expense'} recent={recent} />}
              </SelectField>
              <SelectField label="Tài khoản" error={formState.errors.accountId?.message} {...register('accountId', { onChange: () => setWarnings(null) })}>
                {view && <AccountOptions accounts={view.accounts} balances={view.balances} keep={editing?.accountId} filter={accountFilter} />}
              </SelectField>
            </>
          )}

          <TextField
            label="Ngày"
            type="date"
            error={formState.errors.date?.message}
            hint={date > today() ? 'Giao dịch dự kiến — chưa tính vào số dư hôm nay' : undefined}
            {...register('date', { onChange: () => setWarnings(null) })}
          />
          <TextField label="Ghi chú" placeholder="Không bắt buộc" maxLength={200} error={formState.errors.note?.message} {...register('note')} />
        </form>
      )}
    </Modal>
  )
}

/** Chỉ mount nội dung khi mở → mỗi lần mở là một form mới, không cần reset thủ công. */
export function TransactionFormDialog(props: Parameters<typeof TransactionFormDialogContent>[0]) {
  return props.open ? <TransactionFormDialogContent {...props} /> : null
}
