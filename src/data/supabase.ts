import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/** false khi chưa khai báo biến môi trường → app hiện hướng dẫn cấu hình thay vì lỗi trắng trang. */
export const isSupabaseConfigured = Boolean(url && key)

let client: SupabaseClient | null = null

/** Client Supabase dùng chung. Chỉ dùng publishable/anon key — an toàn khi lộ ra trình duyệt vì mọi bảng đã bật RLS. */
export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error('Thiếu VITE_SUPABASE_URL hoặc VITE_SUPABASE_PUBLISHABLE_KEY (xem .env.example)')
  }
  client ??= createClient(url!, key!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  return client
}
