import { useState } from 'react'
import { FormDialog } from '../../components/ui/FormDialog'
import { MoneyField, TextField } from '../../components/ui/form'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useInvalidate, type LedgerView } from '../../data/queries'
import { today } from '../../lib/clock'
import { parseMoneyInput } from '../../lib/format'
import type { AccountOf } from '../../schemas'
import { updateInvestmentAccount, updateOtherAsset } from '../../services/accountEdit'

export function EditInvestmentDialog({ account, view, onClose }: { account: AccountOf<'investment'>; view: LedgerView; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [name, setName] = useState(account.name)
  const [platform, setPlatform] = useState(account.details.platform ?? '')
  const [cash, setCash] = useState(String(account.openingBalance))
  const [date, setDate] = useState(account.openingDate)
  return (
    <FormDialog
      title="Sửa tài khoản đầu tư"
      onClose={onClose}
      onSubmit={async () => {
        const c = parseMoneyInput(cash)
        if (!name.trim()) return 'Nhập tên'
        if (c === null) return 'Nhập tiền mặt lúc bắt đầu theo dõi (0 nếu không có)'
        if (date > today()) return 'Ngày bắt đầu theo dõi không được ở tương lai'
        await updateInvestmentAccount(getRepos(), account, { name: name.trim(), platform: platform.trim() || null, openingBalance: c, openingDate: date }, view.transactions, view.trades)
        await invalidate('accounts', 'snapshots')
        toast({ message: `Đã lưu "${name.trim()}"` })
        onClose()
      }}
    >
      <TextField label="Tên" value={name} onChange={(e) => setName(e.target.value)} />
      <TextField label="Nơi nắm giữ (không bắt buộc)" value={platform} onChange={(e) => setPlatform(e.target.value)} />
      <MoneyField
        label="Tiền mặt lúc bắt đầu theo dõi"
        value={cash}
        rawValue={cash}
        onChange={(e) => setCash(e.target.value)}
        hint="Chỉ phần tiền chưa đầu tư. Mã nắm giữ sẵn nhập ở “Thêm mã” (vị thế đã có từ trước); lệnh sai thì xóa lệnh trong Lịch sử lệnh."
      />
      <TextField label="Ngày bắt đầu theo dõi" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
    </FormDialog>
  )
}

export function EditOtherAssetDialog({ account, view, onClose }: { account: AccountOf<'other_asset'>; view: LedgerView; onClose: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [name, setName] = useState(account.name)
  const [value, setValue] = useState(String(account.openingBalance))
  const [date, setDate] = useState(account.openingDate)
  const [note, setNote] = useState(account.note ?? '')
  const revalued = view.valuations.some((v) => v.accountId === account.id)
  return (
    <FormDialog
      title="Sửa tài sản khác"
      onClose={onClose}
      onSubmit={async () => {
        const v = parseMoneyInput(value)
        if (!name.trim()) return 'Nhập tên'
        if (v === null) return 'Nhập giá trị ban đầu'
        if (date > today()) return 'Ngày không được ở tương lai'
        await updateOtherAsset(getRepos(), account, { name: name.trim(), openingBalance: v, openingDate: date, note: note.trim() || null }, view.transactions)
        await invalidate('accounts', 'snapshots')
        toast({ message: `Đã lưu "${name.trim()}"` })
        onClose()
      }}
    >
      <TextField label="Tên" value={name} onChange={(e) => setName(e.target.value)} />
      <MoneyField
        label="Giá trị lúc bắt đầu theo dõi"
        value={value}
        rawValue={value}
        onChange={(e) => setValue(e.target.value)}
        hint={revalued ? 'Giá trị hôm nay lấy theo lần định giá gần nhất — muốn đổi giá trị hiện tại, dùng “Định giá lại”.' : undefined}
      />
      <TextField label="Tại ngày" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <TextField label="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
    </FormDialog>
  )
}
