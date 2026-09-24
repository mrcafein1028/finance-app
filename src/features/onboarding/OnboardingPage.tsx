import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button, FormAlert, MoneyField, SelectField } from '../../components/ui/form'
import { Money } from '../../components/ui/Money'
import { getRepos, getSupabase } from '../../data'
import { importReplace } from '../../data/backup'
import { buildDemoBackup } from '../../data/demo'
import { today } from '../../lib/clock'
import { useInvalidate, useLedgerView, useSettings } from '../../data/queries'
import type { CategoryTemplate } from '../../data/seed/categories'
import { split503020 } from '../../domain/budget'
import { parseMoneyInput } from '../../lib/format'
import { readPref, writePref } from '../../lib/prefs'
import type { BudgetMode } from '../../schemas'
import { completeOnboarding, ONBOARDING_STEPS, saveBasicSettings, saveExpectedIncome, seedCategories, type OnboardingStep } from '../../services/onboarding'
import { AccountFormDialog } from '../accounts/AccountFormDialog'
import { useAuth } from '../auth/authContext'

const STEP_TITLES: Record<OnboardingStep, string> = {
  welcome: 'Chào mừng',
  settings: 'Cài đặt cơ bản',
  categories: 'Danh mục thu chi',
  accounts: 'Tài khoản tiền',
  emergency: 'Quỹ khẩn cấp',
  income: 'Thu nhập hằng tháng',
  done: 'Hoàn tất',
}

/** W0 — lần đầu đăng nhập. Tiến độ lưu theo người dùng để mở lại tiếp tục đúng bước. */
export function OnboardingPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const settings = useSettings().data
  const { data: view } = useLedgerView()
  const prefKey = `onboarding-step:${user?.id ?? 'anon'}`
  const [step, setStepState] = useState<OnboardingStep>(() => readPref<OnboardingStep>(prefKey, 'welcome'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [periodStartDay, setPeriodStartDay] = useState(settings?.periodStartDay ?? 1)
  const [mode, setMode] = useState<BudgetMode>(settings?.defaultBudgetMode ?? 'zero_based')
  const [template, setTemplate] = useState<CategoryTemplate>('basic')
  const [income, setIncome] = useState('')
  const [accountDialog, setAccountDialog] = useState<null | 'bank' | 'goal_fund'>(null)

  const index = ONBOARDING_STEPS.indexOf(step)
  const setStep = (next: OnboardingStep) => {
    writePref(prefKey, next)
    setStepState(next)
    setError(null)
  }

  async function run(action: () => Promise<unknown>, next: OnboardingStep) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setStep(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được, vui lòng thử lại')
    } finally {
      setBusy(false)
    }
  }

  const cashAccounts = (view?.accounts ?? []).filter((a) => ['cash', 'bank', 'ewallet'].includes(a.kind) && !a.archivedAt)
  const funds = (view?.accounts ?? []).filter((a) => a.kind === 'goal_fund' && !a.archivedAt)
  const incomeValue = parseMoneyInput(income)
  const split = incomeValue ? split503020(incomeValue) : null

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-8">
      <p className="text-center text-lg font-semibold text-brand">Tài Chính Cá Nhân</p>
      <div className="mt-4" aria-label={`Bước ${index + 1} / ${ONBOARDING_STEPS.length}`}>
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div className="h-full bg-brand transition-all" style={{ width: `${((index + 1) / ONBOARDING_STEPS.length) * 100}%` }} />
        </div>
        <p className="mt-2 text-sm text-muted">
          Bước {index + 1}/{ONBOARDING_STEPS.length}
        </p>
      </div>

      <section className="mt-4 flex flex-1 flex-col gap-5 rounded-2xl border border-border bg-surface p-6">
        <h1 className="text-2xl font-semibold">{STEP_TITLES[step]}</h1>
        {error && <FormAlert tone="error">{error}</FormAlert>}

        {step === 'welcome' && (
          <>
            <p className="text-muted">
              Chỉ mất khoảng 3 phút để thiết lập: chọn cách lập ngân sách, bộ danh mục, nhập số dư các tài khoản đang có và thu nhập hằng tháng.
              Bạn có thể dừng giữa chừng — lần sau sẽ tiếp tục từ bước đang làm.
            </p>
            <Button onClick={() => setStep('settings')}>Bắt đầu</Button>
            <div className="border-t border-border pt-4 text-sm text-muted">
              <p>Muốn xem thử trước? Nạp dữ liệu mẫu của “Lan” (lương 18 triệu, ngân sách zero-based, quỹ khẩn cấp) — sau này xóa được trong Cài đặt.</p>
              <Button
                variant="secondary"
                className="mt-2"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    await importReplace(getSupabase(), buildDemoBackup('lan', today(), settings?.periodStartDay ?? 1))
                    writePref(prefKey, 'welcome')
                    await invalidate()
                    navigate('/', { replace: true })
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Không nạp được dữ liệu demo')
                    setBusy(false)
                  }
                }}
              >
                Xem dữ liệu demo
              </Button>
            </div>
          </>
        )}

        {step === 'settings' && (
          <>
            <SelectField
              label="Ngày bắt đầu tháng tài chính"
              hint="Chọn ngày bạn nhận lương nếu lương về giữa tháng."
              value={periodStartDay}
              onChange={(e) => setPeriodStartDay(Number(e.target.value))}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  Ngày {d}
                  {d === 1 ? ' (tháng dương lịch)' : ''}
                </option>
              ))}
            </SelectField>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Cách lập ngân sách</legend>
              {(
                [
                  ['zero_based', 'Zero-based (khuyên dùng)', 'Mọi đồng thu nhập đều được giao việc: chi tiêu, tiết kiệm hay trả nợ.'],
                  ['standard', 'Thông thường', 'Chỉ đặt hạn mức cho các danh mục muốn kiểm soát.'],
                ] as const
              ).map(([value, label, hint]) => (
                <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${mode === value ? 'border-brand' : 'border-border'}`}>
                  <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1 accent-[var(--color-brand)]" />
                  <span>
                    <span className="block font-medium">{label}</span>
                    <span className="block text-sm text-muted">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Button disabled={busy} onClick={() => run(() => saveBasicSettings(getRepos(), periodStartDay, mode), 'categories')}>
              Tiếp tục
            </Button>
          </>
        )}

        {step === 'categories' && (
          <>
            {(view?.categories.length ?? 0) > 0 ? (
              <p className="text-muted">Bạn đã có {view!.categories.length} danh mục. Có thể sửa sau trong Cài đặt.</p>
            ) : (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">Chọn bộ danh mục mẫu</legend>
                {(
                  [
                    ['basic', 'Cơ bản', '10 nhóm chi tiêu phổ biến: Nhà ở, Ăn uống, Đi lại, Hóa đơn…'],
                    ['detailed', 'Chi tiết', 'Khoảng 35 danh mục 2 cấp, VD Ăn uống → Đi chợ / Ăn ngoài / Cà phê.'],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${template === value ? 'border-brand' : 'border-border'}`}>
                    <input type="radio" name="template" value={value} checked={template === value} onChange={() => setTemplate(value)} className="mt-1 accent-[var(--color-brand)]" />
                    <span>
                      <span className="block font-medium">{label}</span>
                      <span className="block text-sm text-muted">{hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await seedCategories(getRepos(), template)
                  await invalidate('categories')
                }, 'accounts')
              }
            >
              Tiếp tục
            </Button>
          </>
        )}

        {step === 'accounts' && (
          <>
            <p className="text-muted">Thêm các tài khoản tiền bạn đang có với số dư hiện tại: tiền mặt, ngân hàng, ví điện tử. Cần ít nhất một tài khoản.</p>
            {cashAccounts.length > 0 && (
              <ul aria-label="Tài khoản đã thêm" className="divide-y divide-border rounded-xl border border-border">
                {cashAccounts.map((a) => (
                  <li key={a.id} className="flex justify-between px-4 py-3">
                    <span>{a.name}</span>
                    <Money value={view!.balances.get(a.id) ?? 0} />
                  </li>
                ))}
              </ul>
            )}
            <Button variant="secondary" onClick={() => setAccountDialog('bank')}>
              + Thêm tài khoản
            </Button>
            <Button disabled={cashAccounts.length === 0} onClick={() => setStep('emergency')}>
              Tiếp tục
            </Button>
          </>
        )}

        {step === 'emergency' && (
          <>
            <p className="text-muted">
              Quỹ khẩn cấp giúp bạn trang trải 3–6 tháng chi tiêu thiết yếu khi có biến cố. Nếu bạn đang để riêng một khoản cho việc này, hãy thêm nó như một quỹ mục tiêu.
            </p>
            {funds.length > 0 && (
              <ul aria-label="Quỹ đã thêm" className="divide-y divide-border rounded-xl border border-border">
                {funds.map((a) => (
                  <li key={a.id} className="flex justify-between px-4 py-3">
                    <span>{a.name}</span>
                    <Money value={view!.balances.get(a.id) ?? 0} />
                  </li>
                ))}
              </ul>
            )}
            <Button variant="secondary" onClick={() => setAccountDialog('goal_fund')}>
              + Thêm quỹ
            </Button>
            <Button onClick={() => setStep('income')}>{funds.length > 0 ? 'Tiếp tục' : 'Bỏ qua'}</Button>
          </>
        )}

        {step === 'income' && (
          <>
            <MoneyField label="Thu nhập dự kiến mỗi tháng" hint="Tổng lương, thưởng, thu nhập đều đặn. Sửa được ở trang Ngân sách." value={income} rawValue={income} onChange={(e) => setIncome(e.target.value)} />
            {split && (
              <div className="rounded-xl bg-canvas p-4 text-sm">
                <p className="font-medium">Gợi ý theo quy tắc 50/30/20</p>
                <ul className="mt-2 space-y-1">
                  <li className="flex justify-between">
                    <span>Thiết yếu (50%)</span>
                    <Money value={split.needs} />
                  </li>
                  <li className="flex justify-between">
                    <span>Mong muốn (30%)</span>
                    <Money value={split.wants} />
                  </li>
                  <li className="flex justify-between">
                    <span>Tiết kiệm & trả nợ (20%)</span>
                    <Money value={split.savings} />
                  </li>
                </ul>
              </div>
            )}
            <Button
              disabled={busy || !incomeValue}
              onClick={() =>
                run(async () => {
                  await saveExpectedIncome(getRepos(), incomeValue!, settings?.periodStartDay ?? periodStartDay, settings?.defaultBudgetMode ?? mode)
                  await invalidate('budgetMonths')
                }, 'done')
              }
            >
              Tiếp tục
            </Button>
            <Button variant="ghost" onClick={() => setStep('done')}>
              Để sau
            </Button>
          </>
        )}

        {step === 'done' && (
          <>
            <p className="text-muted">Mọi thứ đã sẵn sàng. Việc tiếp theo nên làm:</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>Ghi khoản chi đầu tiên bằng nút + ở góc màn hình.</li>
              <li>Thêm sổ tiết kiệm, khoản đầu tư hoặc khoản nợ nếu có.</li>
              <li>Lập ngân sách cho tháng này.</li>
            </ul>
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await completeOnboarding(getRepos())
                  await invalidate('settings')
                  navigate('/', { replace: true })
                }, 'done')
              }
            >
              Vào ứng dụng
            </Button>
          </>
        )}

        {index > 0 && step !== 'done' && (
          <button type="button" className="mt-auto self-start text-sm text-muted hover:text-ink" onClick={() => setStep(ONBOARDING_STEPS[index - 1]!)}>
            ‹ Quay lại
          </button>
        )}
      </section>

      <AccountFormDialog
        open={accountDialog !== null}
        editing={null}
        initialKind={accountDialog ?? 'bank'}
        kinds={accountDialog === 'goal_fund' ? ['goal_fund'] : ['cash', 'bank', 'ewallet']}
        onClose={() => setAccountDialog(null)}
      />
    </main>
  )
}
