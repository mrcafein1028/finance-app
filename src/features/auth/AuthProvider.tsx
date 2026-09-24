import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { getSupabase } from '../../data/supabase'
import { AuthContext } from './authContext'

/** Theo dõi phiên đăng nhập Supabase và cung cấp cho toàn app qua useAuth(). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPasswordRecovery, setPasswordRecovery] = useState(false)
  const userIdRef = useRef<string | null>(null)

  useEffect(() => {
    const supabase = getSupabase()
    const apply = (next: Session | null) => {
      const nextUserId = next?.user.id ?? null
      // Đổi người dùng (đăng xuất / đăng nhập tài khoản khác) → xóa cache, không bao giờ hiện dữ liệu của người trước.
      if (userIdRef.current !== nextUserId) queryClient.clear()
      userIdRef.current = nextUserId
      setSession(next)
      setLoading(false)
    }

    supabase.auth.getSession().then(({ data }) => apply(data.session))
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      apply(next)
    })
    return () => data.subscription.unsubscribe()
  }, [queryClient])

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        isPasswordRecovery,
        clearPasswordRecovery: () => setPasswordRecovery(false),
        signOut: async () => {
          await getSupabase().auth.signOut()
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
