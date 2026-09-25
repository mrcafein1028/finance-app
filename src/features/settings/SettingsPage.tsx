import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button, CheckboxField, FormAlert, SelectField, TextField } from '../../components/ui/form'
import { ErrorState, LoadingState } from '../../components/ui/Money'
import { useToast } from '../../components/ui/toastContext'
import { getRepos, getSupabase } from '../../data'
import { useInvalidate, useSettings } from '../../data/queries'
import { applyTheme } from '../../lib/theme'
import type { BudgetMode, Settings } from '../../schemas'
import { resetPasswordSchema, type ResetPasswordInput } from '../../schemas/auth'
import { useAuth } from '../auth/authContext'
import { authErrorMessage } from '../auth/authErrors'
import { CategoriesSection } from './CategoriesSection'
import { ClaudeSection } from './ClaudeSection'
import { DataSection } from './DataSection'

const card = 'flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5'

/** Trang Cài đặt (docs/07 §10): tài khoản, tùy chọn, danh mục, dữ liệu. */
export function SettingsPage() {
  const { data: settings, isLoading, error } = useSettings()
  if (isLoading) return <LoadingState />
  if (error || !settings) return <ErrorState error={error} />
  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">Cài đặt</h1>
      <PreferencesSection key={settings.periodStartDay + settings.theme + settings.defaultBudgetMode} settings={settings} />
      <CategoriesSection />
      <DataSection />
      <ClaudeSection />
      <AccountSection />
    </section>
  )
}

function PreferencesSection({ settings }: { settings: Settings }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [form, setForm] = useState(settings)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((f) => ({ ...f, [key]: value }))
  const dirty = (Object.keys(form) as (keyof Settings)[]).some((k) => JSON.stringify(form[k]) !== JSON.stringify(settings[k]))

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const saved = await getRepos().settings.update({
        periodStartDay: form.periodStartDay,
        defaultBudgetMode: form.defaultBudgetMode,
        includeAccruedInterest: form.includeAccruedInterest,
        allowNegativeRollover: form.allowNegativeRollover,
        emergencyTargetMonths: form.emergencyTargetMonths,
        theme: form.theme,
      })
      applyTheme(saved.theme)
      // Đổi ngày bắt đầu tháng → khoảng ngày của mọi kỳ đổi theo, ảnh chụp net worth phải tính lại.
      if (saved.periodStartDay !== settings.periodStartDay) await getRepos().snapshots.markStaleFrom('0000-01')
      await invalidate()
      toast({ message: 'Đã lưu cài đặt' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được cài đặt')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="prefs-title" className={card}>
      <h2 id="prefs-title" className="text-lg font-semibold">
        Tùy chọn
      </h2>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Giao diện" value={form.theme} onChange={(e) => set('theme', e.target.value as Settings['theme'])}>
          <option value="system">Theo hệ điều hành</option>
          <option value="light">Sáng</option>
          <option value="dark">Tối</option>
        </SelectField>
        <SelectField label="Ngày bắt đầu tháng tài chính" value={form.periodStartDay} onChange={(e) => set('periodStartDay', Number(e.target.value))}>
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              Ngày {d}
              {d === 1 ? ' (tháng dương lịch)' : ''}
            </option>
          ))}
        </SelectField>
        <SelectField label="Cách lập ngân sách mặc định" value={form.defaultBudgetMode} onChange={(e) => set('defaultBudgetMode', e.target.value as BudgetMode)}>
          <option value="zero_based">Zero-based (giao việc cho mọi đồng)</option>
          <option value="standard">Thông thường (hạn mức từng danh mục)</option>
        </SelectField>
        <SelectField label="Mục tiêu quỹ khẩn cấp" value={form.emergencyTargetMonths} onChange={(e) => set('emergencyTargetMonths', Number(e.target.value))}>
          {[3, 4, 6, 9, 12].map((m) => (
            <option key={m} value={m}>
              {m} tháng chi tiêu
            </option>
          ))}
        </SelectField>
      </div>
      {form.periodStartDay !== settings.periodStartDay && (
        <FormAlert tone="warning">
          Đổi ngày bắt đầu tháng sẽ tính lại khoảng ngày của <strong>mọi</strong> tháng (cả tháng cũ): số liệu thu chi, ngân sách từng tháng trong báo cáo sẽ thay đổi theo. Giao dịch không bị sửa.
        </FormAlert>
      )}
      <CheckboxField
        label="Tính lãi dồn tích của sổ tiết kiệm vào net worth"
        hint="Lãi đã phát sinh nhưng chưa đến kỳ trả."
        checked={form.includeAccruedInterest}
        onChange={(e) => set('includeAccruedInterest', e.target.checked)}
      />
      <CheckboxField
        label="Chi vượt ngân sách trừ vào tháng sau"
        hint="Áp dụng cho danh mục bật chuyển số dư (rollover)."
        checked={form.allowNegativeRollover}
        onChange={(e) => set('allowNegativeRollover', e.target.checked)}
      />
      <div>
        <Button onClick={save} disabled={busy || !dirty}>
          {busy ? 'Đang lưu…' : 'Lưu cài đặt'}
        </Button>
      </div>
    </section>
  )
}

function AccountSection() {
  const { user, signOut } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const { register, handleSubmit, formState, reset } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) })

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(null)
    const { error } = await getSupabase().auth.updateUser({ password })
    if (error) return setFormError(authErrorMessage(error))
    reset()
    setOpen(false)
    toast({ message: 'Đã đổi mật khẩu' })
  })

  return (
    <section aria-labelledby="account-title" className={card}>
      <h2 id="account-title" className="text-lg font-semibold">
        Tài khoản đăng nhập
      </h2>
      <p className="text-sm">
        Email: <strong>{user?.email}</strong>
      </p>
      {open ? (
        <form onSubmit={onSubmit} noValidate className="flex max-w-sm flex-col gap-3">
          {formError && <FormAlert tone="error">{formError}</FormAlert>}
          <TextField label="Mật khẩu mới" type="password" autoComplete="new-password" hint="Tối thiểu 8 ký tự" error={formState.errors.password?.message} {...register('password')} />
          <TextField label="Nhập lại mật khẩu mới" type="password" autoComplete="new-password" error={formState.errors.confirmPassword?.message} {...register('confirmPassword')} />
          <div className="flex gap-2">
            <Button type="submit" disabled={formState.isSubmitting}>
              Lưu mật khẩu
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Hủy
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Đổi mật khẩu
          </Button>
          <Button variant="secondary" onClick={() => void signOut()}>
            Đăng xuất
          </Button>
        </div>
      )}
    </section>
  )
}
