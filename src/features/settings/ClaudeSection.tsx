import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, FormAlert } from '../../components/ui/form'
import { useToast } from '../../components/ui/toastContext'
import { getSupabase } from '../../data/supabase'
import { formatDate } from '../../lib/format'

const GRANTS_KEY = ['oauth-grants'] as const

/** Kết nối Claude (custom connector qua MCP): địa chỉ để dán vào Claude + các ứng dụng đang có quyền. */
export function ClaudeSection() {
  const toast = useToast()
  const client = useQueryClient()
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/api/mcp`

  const grants = useQuery({
    queryKey: GRANTS_KEY,
    retry: false,
    queryFn: async () => {
      const { data, error } = await getSupabase().auth.oauth.listGrants()
      if (error) throw error
      return data
    },
  })

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ message: 'Không sao chép được — hãy bôi đen địa chỉ và sao chép thủ công', tone: 'warning' })
    }
  }

  async function revoke(clientId: string, name: string) {
    const { error } = await getSupabase().auth.oauth.revokeGrant({ clientId })
    if (error) return toast({ message: `Không thu hồi được: ${error.message}`, tone: 'error' })
    await client.invalidateQueries({ queryKey: GRANTS_KEY })
    toast({ message: `Đã thu hồi quyền của "${name}". Ứng dụng đó sẽ phải xin phép lại.` })
  }

  return (
    <section aria-labelledby="claude-title" className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
      <h2 id="claude-title" className="text-lg font-semibold">
        Kết nối Claude
      </h2>
      <p className="text-sm text-muted">
        Cho Claude đọc số liệu, lập báo cáo, ghi giao dịch từ ảnh hóa đơn ngay trong cuộc trò chuyện. Claude chỉ thấy dữ liệu của bạn và luôn hỏi trước khi ghi.
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mcp-url" className="text-sm font-medium">
          Địa chỉ máy chủ (dán vào Claude)
        </label>
        <div className="flex gap-2">
          <input id="mcp-url" readOnly value={url} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-lg border border-border bg-canvas px-3 py-2.5 font-mono text-sm" />
          <Button variant="secondary" onClick={() => void copy()}>
            {copied ? 'Đã chép ✓' : 'Sao chép'}
          </Button>
        </div>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>
          Trên claude.ai: <strong>Cài đặt → Connectors → Add custom connector</strong>.
        </li>
        <li>Đặt tên “Tài Chính Cá Nhân”, dán địa chỉ trên → Add → Connect.</li>
        <li>
          Đăng nhập (nếu được hỏi) và bấm <strong>Cho phép</strong> ở trang xin quyền.
        </li>
      </ol>

      <div className="border-t border-border pt-4">
        <h3 className="font-medium">Ứng dụng đang có quyền</h3>
        {grants.isLoading ? (
          <p className="mt-1 text-sm text-muted">Đang tải…</p>
        ) : grants.error ? (
          <FormAlert tone="warning">Chưa đọc được danh sách. Nếu vừa cài đặt: kiểm tra đã bật Authentication → OAuth Server trong Supabase (docs/12).</FormAlert>
        ) : (grants.data ?? []).length === 0 ? (
          <p className="mt-1 text-sm text-muted">Chưa có ứng dụng nào.</p>
        ) : (
          <ul aria-label="Ứng dụng đang có quyền" className="mt-2 divide-y divide-border">
            {grants.data!.map((g) => (
              <li key={g.client.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{g.client.name || 'Ứng dụng không tên'}</span>
                  <span className="ml-2 text-muted">từ {formatDate(g.granted_at.slice(0, 10))}</span>
                </span>
                <Button variant="ghost" className="px-2 py-1 text-negative" onClick={() => void revoke(g.client.id, g.client.name)}>
                  Thu hồi
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
