import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { Button, FormAlert, TextField } from '../../components/ui/form'
import { getSupabase } from '../../data/supabase'
import { loginSchema, type LoginInput } from '../../schemas/auth'
import { AuthCard } from './AuthLayout'
import { authErrorMessage } from './authErrors'

export function LoginPage() {
  const [formError, setFormError] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) })

  // Đăng nhập thành công → AuthProvider nhận phiên mới → RedirectIfAuthenticated chuyển vào app.
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    const { error } = await getSupabase().auth.signInWithPassword(values)
    if (error) setFormError(authErrorMessage(error))
  })

  return (
    <AuthCard
      title="Đăng nhập"
      subtitle="Quản lý ngân sách, tài sản và net worth của bạn."
      footer={
        <>
          Chưa có tài khoản?{' '}
          <Link to="/signup" className="font-medium text-brand">
            Đăng ký
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && <FormAlert tone="error">{formError}</FormAlert>}
        <TextField label="Email" type="email" autoComplete="email" error={formState.errors.email?.message} {...register('email')} />
        <TextField
          label="Mật khẩu"
          type="password"
          autoComplete="current-password"
          error={formState.errors.password?.message}
          {...register('password')}
        />
        <Link to="/forgot-password" className="-mt-2 self-end text-sm text-brand">
          Quên mật khẩu?
        </Link>
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </Button>
      </form>
    </AuthCard>
  )
}
