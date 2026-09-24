import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { Transaction } from '../../schemas'
import { TransactionDialogContext } from './transactionDialogContext'
import { TransactionFormDialog, type TransactionPreset } from './TransactionFormDialog'

/** Một hộp thoại giao dịch dùng chung cho cả app: nút "+", danh sách giao dịch, trang tài khoản. */
export function TransactionDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; editing: Transaction | null; preset: TransactionPreset }>({
    open: false,
    editing: null,
    preset: {},
  })
  const openNew = useCallback((preset: TransactionPreset = {}) => setState({ open: true, editing: null, preset }), [])
  const openEdit = useCallback((tx: Transaction) => setState({ open: true, editing: tx, preset: {} }), [])
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), [])
  const value = useMemo(() => ({ openNew, openEdit }), [openNew, openEdit])

  return (
    <TransactionDialogContext.Provider value={value}>
      {children}
      <TransactionFormDialog open={state.open} editing={state.editing} preset={state.preset} onClose={close} />
    </TransactionDialogContext.Provider>
  )
}
