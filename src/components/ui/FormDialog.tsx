import { useState, type ReactNode } from 'react'
import { ValidationError } from '../../data/errors'
import { Button, FormAlert } from './form'
import { Modal } from './Modal'

/**
 * Khung hộp thoại form dùng chung: nút Hủy / nút chính, trạng thái đang lưu, lỗi chung.
 * `onSubmit` trả về chuỗi → hiện như lỗi (kiểm tra phía giao diện); ném lỗi → hiện thông báo lỗi.
 * Cha chỉ render khi mở (`{open && <FormDialog …/>}`) nên mỗi lần mở là form mới.
 */
export function FormDialog({
  title,
  submitLabel = 'Lưu',
  onSubmit,
  onClose,
  children,
  extraActions,
  danger = false,
}: {
  title: string
  submitLabel?: string
  onSubmit: () => Promise<string | void> | string | void
  onClose: () => void
  children: ReactNode
  extraActions?: ReactNode
  danger?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const message = await onSubmit()
      if (typeof message === 'string') setError(message)
    } catch (e) {
      setError(e instanceof ValidationError ? e.issues.map((i) => i.message).join('; ') : e instanceof Error ? e.message : 'Có lỗi xảy ra, vui lòng thử lại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          {extraActions}
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={submit} disabled={busy}>
            {busy ? 'Đang lưu…' : submitLabel}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {error && <FormAlert tone="error">{error}</FormAlert>}
        {children}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
