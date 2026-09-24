import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { Button, FormAlert, TextField } from '../../components/ui/form'
import { getSupabase } from '../../data/supabase'
import { forgotPasswordSchema, type ForgotPasswordInput } from '../../schemas/auth'
import { AuthCard } from './AuthLayout'
import { authErrorMessage } from './authErrors'

export function ForgotPasswordPage() {
  const [formError, setFormError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const { register, handleSubmit, formState } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) })

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null)
    const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) return setFormError(authErrorMessage(error))
    setSent(true)
  })

  return (
    <AuthCard
      title="Quên mật khẩu"
      subtitle="Nhập email đã đăng ký, chúng tôi sẽ gửi đường dẫn đặt lại mật khẩu."
      footer={<Link to="/login" className="font-medium text-brand">Về trang đăng nhập</Link>}
    >
      {sent ? (
        // Không tiết lộ email có tồn tại hay không.
        <FormAlert tone="success">Nếu email này đã đăng ký, bạn sẽ nhận được thư trong vài phút.</FormAlert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {formError && <FormAlert tone="error">{formError}</FormAlert>}
          <TextField label="Email" type="email" autoComplete="email" error={formState.errors.email?.message} {...register('email')} />
          <Button type="submit" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? 'Đang gửi…' : 'Gửi đường dẫn'}
          </Button>
        </form>
      )}
    </AuthCard>
  )
}
