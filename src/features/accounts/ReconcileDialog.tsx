import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Button, FormAlert, MoneyField, SelectField } from '../../components/ui/form'
import { Modal } from '../../components/ui/Modal'
import { Money } from '../../components/ui/Money'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, useLedgerView } from '../../data/queries'
import { today } from '../../lib/clock'
import { parseMoneyInput } from '../../lib/format'
import type { Account } from '../../schemas'
import { reconcileFormSchema, type ReconcileFormInput, type ReconcileFormValues } from '../../schemas/forms'
import { planReconcile, reconcileAccount } from '../../services/accounts'
import { CategoryOptions } from '../transactions/pickers'

/** W4 — nhập số dư thực tế (trên app ngân hàng / trong ví) → ghi phần chênh lệch. */
function ReconcileDialogContent({ open, account, onClose }: { open: boolean; account: Account; onClose: () => void }) {
  const { data: view } = useLedgerView()
  const invalidate = useInvalidate()
  const toast = useToast()
  const [formError, setFormError] = useState<string | null>(null)
  const current = view?.balances.get(account.id) ?? 0
  const form = useForm<ReconcileFormInput, unknown, ReconcileFormValues>({
    resolver: zodResolver(reconcileFormSchema),
    defaultValues: { actual: '', mode: 'adjustment', categoryId: '' },
  })
  const { register, handleSubmit, control, formState } = form


  const actualRaw = useWatch({ control, name: 'actual' })
  const actual = parseMoneyInput(actualRaw ?? '')
  const plan = actual === null ? null : planReconcile(current, actual)
  const mode = useWatch({ control, name: 'mode' })

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      const tx = await reconcileAccount(getRepos(), account, current, values.actual, values.mode, values.categoryId, today())
      await invalidate('transactions')
      toast({ message: tx ? 'Đã cập nhật số dư theo thực tế' : 'Số dư đã khớp', tone: tx ? 'success' : 'info' })
      onClose()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Không lưu được, vui lòng thử lại')
    }
  })

  return (
    <Modal
      open={open}
      title={`Đối soát ${account.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" form="reconcile-form" disabled={formState.isSubmitting}>
            Cập nhật
          </Button>
        </>
      }
    >
      <form id="reconcile-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {formError && <FormAlert tone="error">{formError}</FormAlert>}
        <p className="text-sm">
          Số dư trong app: <Money value={current} className="font-semibold" />
        </p>
        <MoneyField label="Số dư thực tế" rawValue={actualRaw} error={formState.errors.actual?.message} {...register('actual')} />
        {plan && (
          <p role="status" className="text-sm text-muted">
            {plan.description}
          </p>
        )}
        {plan && plan.difference < 0 && (
          <>
            <SelectField label="Ghi phần chênh lệch là" {...register('mode')}>
              <option value="adjustment">Điều chỉnh số dư (không tính vào chi tiêu)</option>
              <option value="expense">Chi tiêu quên ghi</option>
            </SelectField>
            {mode === 'expense' && (
              <SelectField label="Danh mục chi" error={formState.errors.categoryId?.message} {...register('categoryId')}>
                {view && <CategoryOptions categories={view.categories} type="expense" />}
              </SelectField>
            )}
          </>
        )}
      </form>
    </Modal>
  )
}

/** Chỉ mount nội dung khi mở → mỗi lần mở là một form mới, không cần reset thủ công. */
export function ReconcileDialog(props: Parameters<typeof ReconcileDialogContent>[0]) {
  return props.open ? <ReconcileDialogContent {...props} /> : null
}
