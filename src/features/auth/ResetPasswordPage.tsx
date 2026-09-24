import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { Button, FormAlert, TextField } from '../../components/ui/form'
import { getSupabase } from '../../data/supabase'
import { resetPasswordSchema, type ResetPasswordInput } from '../../schemas/auth'
import { AuthCard } from './AuthLayout'
import { useAuth } from './authContext'
import { authErrorMessage } from './authErrors'

/** Mở từ đường dẫn trong email "đặt lại mật khẩu": Supabase đã tạo phiên tạm thời cho người dùng. */
export function ResetPasswordPage() {
  const { session, loading, clearPasswordRecovery } = useAuth()
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) })

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(null)
    const { error } = await getSupabase().auth.updateUser({ password })
    if (error) return setFormError(authErrorMessage(error))
    clearPasswordRecovery()
    navigate('/', { replace: true })
  })

  if (loading) return null

  if (!session) {
    return (
      <AuthCard title="Đường dẫn không hợp lệ" footer={<Link to="/login" className="font-medium text-brand">Về trang đăng nhập</Link>}>
        <FormAlert tone="error">
          Đường dẫn đặt lại mật khẩu đã hết hạn hoặc đã được dùng.{' '}
          <Link to="/forgot-password" className="underline">
            Yêu cầu gửi lại
          </Link>
          .
        </FormAlert>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Đặt mật khẩu mới">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && <FormAlert tone="error">{formError}</FormAlert>}
        <TextField
          label="Mật khẩu mới"
          type="password"
          autoComplete="new-password"
          hint="Tối thiểu 8 ký tự"
          error={formState.errors.password?.message}
          {...register('password')}
        />
        <TextField
          label="Nhập lại mật khẩu mới"
          type="password"
          autoComplete="new-password"
          error={formState.errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Đang lưu…' : 'Lưu mật khẩu mới'}
        </Button>
      </form>
    </AuthCard>
  )
}
