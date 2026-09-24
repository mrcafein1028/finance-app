import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { Button, FormAlert, TextField } from '../../components/ui/form'
import { getSupabase } from '../../data/supabase'
import { signupSchema, type SignupInput } from '../../schemas/auth'
import { AuthCard } from './AuthLayout'
import { authErrorMessage } from './authErrors'

export function SignupPage() {
  const [formError, setFormError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<SignupInput>({ resolver: zodResolver(signupSchema) })

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError(null)
    const { data, error } = await getSupabase().auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    })
    if (error) return setFormError(authErrorMessage(error))
    // Khi bật xác nhận email, Supabase không báo lỗi cho email đã tồn tại mà trả về user không có identity.
    if (data.user && data.user.identities?.length === 0) return setFormError(authErrorMessage({ code: 'user_already_exists' }))
    // Có session ngay (tắt xác nhận email) → AuthProvider tự chuyển vào app. Không có → chờ xác nhận email.
    if (!data.session) setSentTo(email)
  })

  if (sentTo) {
    return (
      <AuthCard title="Kiểm tra email của bạn" footer={<Link to="/login" className="font-medium text-brand">Về trang đăng nhập</Link>}>
        <FormAlert tone="success">
          Đã gửi thư xác nhận tới <strong>{sentTo}</strong>. Mở thư và bấm vào đường dẫn để kích hoạt tài khoản.
        </FormAlert>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Tạo tài khoản"
      subtitle="Dữ liệu của bạn được bảo vệ, chỉ bạn nhìn thấy."
      footer={
        <>
          Đã có tài khoản?{' '}
          <Link to="/login" className="font-medium text-brand">
            Đăng nhập
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
          autoComplete="new-password"
          hint="Tối thiểu 8 ký tự"
          error={formState.errors.password?.message}
          {...register('password')}
        />
        <TextField
          label="Nhập lại mật khẩu"
          type="password"
          autoComplete="new-password"
          error={formState.errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Đang tạo tài khoản…' : 'Đăng ký'}
        </Button>
      </form>
    </AuthCard>
  )
}
