import { z } from 'zod'

const email = z.string().trim().min(1, 'Nhập email').pipe(z.email('Email không hợp lệ'))
const password = z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(72, 'Mật khẩu tối đa 72 ký tự')

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Nhập mật khẩu'),
})

export const signupSchema = z
  .object({ email, password, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Mật khẩu nhập lại không khớp' })

export const forgotPasswordSchema = z.object({ email })

export const resetPasswordSchema = z
  .object({ password, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Mật khẩu nhập lại không khớp' })

export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
