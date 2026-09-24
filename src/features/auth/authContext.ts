import type { Session, User } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export interface AuthState {
  session: Session | null
  user: User | null
  /** true trong lúc đọc phiên đã lưu — chưa biết đã đăng nhập hay chưa. */
  loading: boolean
  /** Người dùng vừa mở đường dẫn đặt lại mật khẩu trong email. */
  isPasswordRecovery: boolean
  clearPasswordRecovery: () => void
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth() phải nằm trong <AuthProvider>')
  return ctx
}
