import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { FormDialog } from '../../components/ui/FormDialog'
import { Button, FormAlert, SelectField, TextField } from '../../components/ui/form'
import { useToast } from '../../components/ui/toastContext'
import { getRepos, getSupabase } from '../../data'
import { exportAll } from '../../data/backup'
import { buildDemoBackup, DEMO_PERSONAS, type DemoPersona } from '../../data/demo'
import { useInvalidate, useLedgerView, useSettings } from '../../data/queries'
import { today } from '../../lib/clock'
import { downloadFile } from '../../lib/download'
import { formatDate } from '../../lib/format'
import { writePref } from '../../lib/prefs'
import type { BackupFile } from '../../schemas'
import { backupFileName, deleteAllData, markBackedUp, readBackupText, restoreBackup, safetyBackup, summarizeBackup, TABLE_LABELS, transactionsCsv, type SafetyBackup } from '../../services/settings'
import { useAuth } from '../auth/authContext'

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Có lỗi xảy ra, vui lòng thử lại')

/** Chụp dữ liệu hiện tại trước thao tác thay thế; không lưu được lên máy chủ thì tải file về máy. */
async function takeSafetyBackup(userId: string): Promise<string> {
  const result: SafetyBackup = await safetyBackup(getSupabase(), userId)
  if (result.kind === 'storage') return 'Bản sao dữ liệu cũ đã lưu trên máy chủ (Storage › user-files).'
  downloadFile(backupFileName(result.backup.exportedAt), JSON.stringify(result.backup, null, 2), 'application/json')
  return 'Bản sao dữ liệu cũ đã được tải về máy.'
}

type Pending = { kind: 'restore'; backup: BackupFile; fileName: string } | { kind: 'demo' } | { kind: 'delete' } | null

/** W17 — sao lưu, khôi phục, xuất CSV, dữ liệu demo và xóa toàn bộ. */
export function DataSection() {
  const { user } = useAuth()
  const settings = useSettings().data
  const { data: view } = useLedgerView()
  const invalidate = useInvalidate()
  const toast = useToast()
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  async function exportJson() {
    setBusy(true)
    try {
      const backup = await exportAll(getSupabase())
      downloadFile(backupFileName(backup.exportedAt), JSON.stringify(backup, null, 2), 'application/json')
      await markBackedUp(getRepos())
      await invalidate('settings')
      toast({ message: 'Đã tải file sao lưu. Hãy cất ở nơi an toàn (Google Drive, USB…).' })
    } catch (e) {
      toast({ message: errorText(e), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  function exportCsv() {
    if (!view) return
    downloadFile(`giao-dich-${today()}.csv`, transactionsCsv(view.transactions, view.accountById, view.categoryById), 'text/csv;charset=utf-8')
  }

  async function pickFile(file: File | undefined) {
    setFileError(null)
    if (!file) return
    try {
      setPending({ kind: 'restore', backup: readBackupText(await file.text()), fileName: file.name })
    } catch (e) {
      setFileError(errorText(e))
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const lastBackup = settings?.lastBackupAt ? formatDate(settings.lastBackupAt.slice(0, 10)) : 'chưa bao giờ'

  return (
    <section aria-labelledby="data-title" className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
      <h2 id="data-title" className="text-lg font-semibold">
        Dữ liệu & sao lưu
      </h2>
      <p className="text-sm text-muted">
        Dữ liệu của bạn nằm trên Supabase và chỉ bạn đọc được. Nên tự tải một bản sao lưu mỗi tháng. Lần sao lưu gần nhất: <strong>{lastBackup}</strong>.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={exportJson} disabled={busy}>
          Tải file sao lưu (JSON)
        </Button>
        <Button variant="secondary" onClick={exportCsv} disabled={!view}>
          Xuất giao dịch (CSV)
        </Button>
        <Button variant="secondary" onClick={() => fileInput.current?.click()}>
          Khôi phục từ file…
        </Button>
        <input ref={fileInput} type="file" accept="application/json,.json" aria-label="Chọn file sao lưu" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0])} />
      </div>
      {fileError && <FormAlert tone="error">Không đọc được file: {fileError}</FormAlert>}

      <div className="border-t border-border pt-4">
        <h3 className="font-medium">Dữ liệu demo</h3>
        <p className="mt-1 text-sm text-muted">Nạp dữ liệu mẫu của một trong 3 nhân vật để khám phá mọi tính năng. Dữ liệu hiện tại sẽ được sao lưu rồi thay thế.</p>
        <Button variant="secondary" className="mt-2" onClick={() => setPending({ kind: 'demo' })}>
          Nạp dữ liệu demo…
        </Button>
      </div>

      <div className="rounded-xl border border-negative/40 p-4">
        <h3 className="font-medium text-negative">Vùng nguy hiểm</h3>
        <p className="mt-1 text-sm text-muted">Xóa toàn bộ tài khoản tiền, giao dịch, ngân sách… và làm lại từ đầu. Tài khoản đăng nhập vẫn giữ.</p>
        <Button variant="danger" className="mt-2" onClick={() => setPending({ kind: 'delete' })}>
          Xóa toàn bộ dữ liệu…
        </Button>
      </div>

      {pending?.kind === 'restore' && user && (
        <FormDialog
          title="Khôi phục từ file sao lưu"
          submitLabel="Thay thế toàn bộ dữ liệu"
          danger
          onClose={() => setPending(null)}
          onSubmit={async () => {
            const note = await takeSafetyBackup(user.id)
            await restoreBackup(getSupabase(), pending.backup)
            await invalidate()
            setPending(null)
            toast({ message: `Đã khôi phục dữ liệu từ ${pending.fileName}. ${note}`, durationMs: 8000 })
          }}
        >
          <p className="text-sm">
            File <strong>{pending.fileName}</strong>, tạo lúc {formatDate(pending.backup.exportedAt.slice(0, 10))}, gồm:
          </p>
          <ul aria-label="Nội dung file sao lưu" className="grid grid-cols-2 gap-x-4 text-sm">
            {summarizeBackup(pending.backup)
              .filter((r) => r.count > 0)
              .map((r) => (
                <li key={r.table} className="flex justify-between">
                  <span className="text-muted">{TABLE_LABELS[r.table]}</span>
                  <span>{r.count.toLocaleString('vi-VN')}</span>
                </li>
              ))}
          </ul>
          <FormAlert tone="warning">Toàn bộ dữ liệu hiện tại sẽ bị thay bằng nội dung file. App sẽ tự sao lưu dữ liệu hiện tại trước.</FormAlert>
        </FormDialog>
      )}

      {pending?.kind === 'demo' && user && <DemoDialog userId={user.id} periodStartDay={settings?.periodStartDay ?? 1} onClose={() => setPending(null)} onLoaded={async (label, note) => {
        await invalidate()
        setPending(null)
        toast({ message: `Đã nạp dữ liệu demo: ${label}. ${note}`, durationMs: 8000 })
        navigate('/')
      }} />}

      {pending?.kind === 'delete' && user && settings && (
        <DeleteAllDialog
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const note = await takeSafetyBackup(user.id)
            await deleteAllData(getSupabase(), settings)
            writePref(`onboarding-step:${user.id}`, 'welcome')
            await invalidate()
            setPending(null)
            toast({ message: `Đã xóa toàn bộ dữ liệu. ${note}`, durationMs: 8000 })
            navigate('/onboarding')
          }}
        />
      )}
    </section>
  )
}

function DemoDialog({ userId, periodStartDay, onClose, onLoaded }: { userId: string; periodStartDay: number; onClose: () => void; onLoaded: (label: string, note: string) => Promise<void> }) {
  const [persona, setPersona] = useState<DemoPersona>('lan')
  return (
    <FormDialog
      title="Nạp dữ liệu demo"
      submitLabel="Nạp dữ liệu demo"
      danger
      onClose={onClose}
      onSubmit={async () => {
        const note = await takeSafetyBackup(userId)
        await restoreBackup(getSupabase(), buildDemoBackup(persona, today(), periodStartDay))
        await onLoaded(DEMO_PERSONAS[persona].label, note)
      }}
    >
      <SelectField label="Nhân vật" value={persona} onChange={(e) => setPersona(e.target.value as DemoPersona)}>
        {(Object.keys(DEMO_PERSONAS) as DemoPersona[]).map((p) => (
          <option key={p} value={p}>
            {DEMO_PERSONAS[p].label}
          </option>
        ))}
      </SelectField>
      <FormAlert tone="warning">Dữ liệu hiện tại sẽ được sao lưu rồi thay bằng dữ liệu demo. Muốn quay lại: Khôi phục từ file sao lưu.</FormAlert>
    </FormDialog>
  )
}

function DeleteAllDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => Promise<void> }) {
  const [typed, setTyped] = useState('')
  return (
    <FormDialog
      title="Xóa toàn bộ dữ liệu"
      submitLabel="Xóa vĩnh viễn"
      danger
      onClose={onClose}
      onSubmit={async () => {
        if (typed.trim() !== 'XÓA') return 'Gõ đúng chữ XÓA (viết hoa) để xác nhận'
        await onConfirm()
      }}
    >
      <p className="text-sm">
        Mọi tài khoản tiền, giao dịch, ngân sách, khoản vay, đầu tư sẽ bị xóa. App sẽ tự tạo một bản sao lưu trước khi xóa. Sau đó bạn sẽ làm lại các bước bắt đầu.
      </p>
      <TextField label='Gõ "XÓA" để xác nhận' value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
    </FormDialog>
  )
}
