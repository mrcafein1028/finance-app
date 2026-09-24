import { createContext, useContext } from 'react'
import type { Transaction } from '../../schemas'
import type { TransactionPreset } from './TransactionFormDialog'

export interface TransactionDialogApi {
  openNew: (preset?: TransactionPreset) => void
  openEdit: (tx: Transaction) => void
}

export const TransactionDialogContext = createContext<TransactionDialogApi | null>(null)

export function useTransactionDialog(): TransactionDialogApi {
  const ctx = useContext(TransactionDialogContext)
  if (!ctx) throw new Error('useTransactionDialog() phải nằm trong <TransactionDialogProvider>')
  return ctx
}
