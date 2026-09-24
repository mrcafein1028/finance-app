import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { formatMoney, parseMoneyInput } from '../../lib/format'

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-negative">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

const controlClass = (error?: string) =>
  `w-full rounded-lg border bg-surface px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-brand ${error ? 'border-negative' : 'border-border'}`

const describedBy = (id: string, error?: string, hint?: ReactNode) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined)

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: ReactNode
}

/** Ô nhập có nhãn, gợi ý và lỗi gắn với aria-describedby (đọc được bằng trình đọc màn hình). */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ label, error, hint, id, ...input }, ref) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <Field id={inputId} label={label} error={error} hint={hint}>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, error, hint)}
        className={controlClass(error)}
        {...input}
      />
    </Field>
  )
})

interface MoneyFieldProps extends Omit<TextFieldProps, 'type'> {
  /** Giá trị đang gõ — để hiện "= 150.000 ₫" ngay dưới ô. */
  rawValue?: string
}

/** Ô số tiền: gõ tắt 150k / 2tr / 2,5tr, hiện số đã hiểu ngay bên dưới (docs/06). */
export const MoneyField = forwardRef<HTMLInputElement, MoneyFieldProps>(function MoneyField({ rawValue, hint, ...props }, ref) {
  const parsed = rawValue ? parseMoneyInput(rawValue) : null
  const preview = parsed !== null && rawValue && rawValue.replace(/\D/g, '') !== String(parsed) ? `= ${formatMoney(parsed)}` : undefined
  return <TextField ref={ref} inputMode="decimal" autoComplete="off" placeholder="VD: 150k, 2,5tr" hint={preview ?? hint} {...props} />
})

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  error?: string
  hint?: ReactNode
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField({ label, error, hint, id, children, ...select }, ref) {
  const autoId = useId()
  const selectId = id ?? autoId
  return (
    <Field id={selectId} label={label} error={error} hint={hint}>
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(selectId, error, hint)}
        className={controlClass(error)}
        {...select}
      >
        {children}
      </select>
    </Field>
  )
})

export const CheckboxField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }>(
  function CheckboxField({ label, hint, id, ...input }, ref) {
    const autoId = useId()
    const inputId = id ?? autoId
    return (
      <div className="flex items-start gap-2">
        <input ref={ref} id={inputId} type="checkbox" className="mt-1 size-4 accent-[var(--color-brand)]" {...input} />
        <label htmlFor={inputId} className="text-sm">
          <span className="font-medium">{label}</span>
          {hint && <span className="block text-muted">{hint}</span>}
        </label>
      </div>
    )
  },
)

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-ink hover:opacity-90',
  secondary: 'border border-border bg-surface text-ink hover:bg-canvas',
  danger: 'bg-negative text-white hover:opacity-90',
  ghost: 'text-muted hover:bg-canvas hover:text-ink',
}

export function Button({ className = '', variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={`rounded-lg px-4 py-2.5 font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

/** Thông báo cấp form: lỗi chung, cảnh báo hoặc thành công. */
export function FormAlert({ tone, children }: { tone: 'error' | 'warning' | 'success'; children: ReactNode }) {
  const colors = { error: 'border-negative/40 text-negative', warning: 'border-warning/40 text-warning', success: 'border-positive/40 text-positive' }
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2.5 text-sm ${colors[tone]}`}>
      {children}
    </div>
  )
}

/** Nhóm nút chọn một (tab Chi / Thu / Chuyển…). */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-canvas p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2 py-2 text-sm font-medium ${value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
