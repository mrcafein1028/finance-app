/** Hiện khi build thiếu biến môi trường Supabase — thay vì trắng trang. */
export function ConfigMissingPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Chưa cấu hình kết nối Supabase</h1>
      <p className="mt-3 text-muted">Ứng dụng cần hai biến môi trường để kết nối cơ sở dữ liệu:</p>
      <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface p-4 text-sm">
        {'VITE_SUPABASE_URL=https://<project>.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=<publishable hoặc anon key>'}
      </pre>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted">
        <li>Chạy trên máy: tạo file <code>.env.local</code> theo mẫu <code>.env.example</code>.</li>
        <li>Trên Vercel: Project → Settings → Environment Variables, rồi Redeploy.</li>
        <li>Chi tiết: <code>docs/10-trien-khai.md</code>.</li>
      </ul>
    </main>
  )
}
