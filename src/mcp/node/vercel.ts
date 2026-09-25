import { createMcpHttpHandler } from '../http'
import { toNodeHandler } from './adapter'

// Điểm vào của hàm serverless trên Vercel (scripts/build-vercel-output.mjs gói file này cùng mọi
// thư viện thành một file duy nhất). Dùng lại 2 biến môi trường của web app — không cần khóa bí mật mới.

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY

const missingConfig = async () =>
  new Response(JSON.stringify({ error: 'server_misconfigured', error_description: 'Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY trong Environment Variables của Vercel.' }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  })

export default toNodeHandler(supabaseUrl && supabaseKey ? createMcpHttpHandler({ supabaseUrl, supabaseKey }) : missingConfig)
