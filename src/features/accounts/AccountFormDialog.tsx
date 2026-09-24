import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Button, CheckboxField, FormAlert, MoneyField, SelectField, TextField } from '../../components/ui/form'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, useLedgerView } from '../../data/queries'
import { today } from '../../lib/clock'
import { KIND_META, type Account } from '../../schemas'
import { accountFormSchema, CASH_LIKE_KINDS, type AccountFormInput, type AccountFormValues, type CashLikeKind } from '../../schemas/forms'
import { createAccount, updateAccount } from '../../services/accounts'

function defaults(editing: Account | null, kind: CashLikeKind): AccountFormInput {
  if (editing) {
    return {
      name: editing.name,
      kind: editing.kind as CashLikeKind,
      openingBalance: String(editing.openingBalance),
      openingDate: editing.openingDate,
      isEmergencyFund: editing.isEmergencyFund,
      goalTarget: editing.goal ? String(editing.goal.targetAmount) : '',
      goalDate: editing.goal?.targetDate ?? '',
      note: editing.note ?? '',
    }
  }
  return { name: '', kind, openingBalance: '', openingDate: today(), isEmergencyFund: false, goalTarget: '', goalDate: '', note: '' }
}

/** Form F2 — tài khoản tiền mặt / ngân hàng / ví / quỹ mục tiêu. */
function AccountFormDialogContent({
  open,
  editing,
  initialKind = 'bank',
  kinds = CASH_LIKE_KINDS,
  onClose,
  onSaved,
}: {
  open: boolean
  editing: Account | null
  initialKind?: CashLikeKind
  kinds?: readonly CashLikeKind[]
  onClose: () => void
  onSaved?: (account: Account) => void
}) {
  const { data: view } = useLedgerView()
  const invalidate = useInvalidate()
  const toast = useToast()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<AccountFormInput, unknown, AccountFormValues>({
    resolver: zodResolver(accountFormSchema(today())),
    defaultValues: defaults(editing, initialKind),
  })
  const { register, handleSubmit, control, formState } = form


  const kind = useWatch({ control, name: 'kind' })
  const openingBalanceRaw = useWatch({ control, name: 'openingBalance' })
  const goalTargetRaw = useWatch({ control, name: 'goalTarget' })
  const hasGoal = kind === 'goal_fund'

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      const saved = editing
        ? await updateAccount(getRepos(), editing, values, view?.transactions ?? [])
        : await createAccount(getRepos(), values, view?.accounts.length ?? 0)
      await invalidate('accounts')
      toast({ message: editing ? `Đã cập nhật "${saved.name}"` : `Đã thêm "${saved.name}"` })
      onSaved?.(saved)
      onClose()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Không lưu được, vui lòng thử lại')
    }
  })

  return (
    <Modal
      open={open}
      title={editing ? 'Sửa tài khoản' : 'Thêm tài khoản'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" form="account-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </>
      }
    >
      <form id="account-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {formError && <FormAlert tone="error">{formError}</FormAlert>}
        <SelectField label="Loại tài khoản" hint={editing ? 'Không đổi được loại sau khi tạo' : undefined} {...register('kind')}>
          {(editing ? [editing.kind as CashLikeKind] : kinds).map((k) => (
            <option key={k} value={k}>
              {KIND_META[k].label}
            </option>
          ))}
        </SelectField>
        <TextField label="Tên" placeholder={hasGoal ? 'VD: Quỹ khẩn cấp, Quỹ du lịch' : 'VD: Vietcombank, Ví MoMo'} error={formState.errors.name?.message} {...register('name')} />
        <MoneyField
          label={hasGoal ? 'Số tiền hiện có trong quỹ' : 'Số dư hiện tại'}
          rawValue={openingBalanceRaw}
          error={formState.errors.openingBalance?.message}
          {...register('openingBalance')}
        />
        <TextField
          label="Tính từ ngày"
          type="date"
          hint="Số dư trên là số dư đầu ngày này; giao dịch từ ngày này trở đi sẽ được cộng/trừ vào."
          error={formState.errors.openingDate?.message}
          {...register('openingDate')}
        />
        {hasGoal && (
          <div className="grid gap-4 sm:grid-cols-2">
            <MoneyField label="Mục tiêu" rawValue={goalTargetRaw} error={formState.errors.goalTarget?.message} {...register('goalTarget')} />
            <TextField label="Hạn (không bắt buộc)" type="date" error={formState.errors.goalDate?.message} {...register('goalDate')} />
          </div>
        )}
        <CheckboxField
          label="Đây là quỹ khẩn cấp"
          hint="Dùng để tính số tháng quỹ khẩn cấp đủ trang trải chi tiêu thiết yếu."
          {...register('isEmergencyFund')}
        />
        <TextField label="Ghi chú" placeholder="Không bắt buộc" error={formState.errors.note?.message} {...register('note')} />
      </form>
    </Modal>
  )
}

/** Chỉ mount nội dung khi mở → mỗi lần mở là một form mới, không cần reset thủ công. */
export function AccountFormDialog(props: Parameters<typeof AccountFormDialogContent>[0]) {
  return props.open ? <AccountFormDialogContent {...props} /> : null
}
