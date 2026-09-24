import { describe, expect, it } from 'vitest'
import { loginSchema, signupSchema } from './auth'

describe('form đăng nhập / đăng ký', () => {
  it('email phải hợp lệ, mật khẩu đăng ký tối thiểu 8 ký tự và nhập lại khớp', () => {
    expect(loginSchema.safeParse({ email: ' lan@example.com ', password: 'x' }).success).toBe(true)
    expect(loginSchema.safeParse({ email: 'lan@', password: 'x' }).success).toBe(false)

    const ok = { email: 'lan@example.com', password: '12345678', confirmPassword: '12345678' }
    expect(signupSchema.safeParse(ok).success).toBe(true)
    expect(signupSchema.safeParse({ ...ok, password: '1234567', confirmPassword: '1234567' }).success).toBe(false)
    const mismatch = signupSchema.safeParse({ ...ok, confirmPassword: '12345679' })
    expect(mismatch.error?.issues[0]?.path).toEqual(['confirmPassword'])
  })
})
