import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Button, FormAlert } from '../../components/ui/form'
import { getSupabase } from '../../data/supabase'
import { AuthCard } from '../auth/AuthLayout'
import { useAuth } from '../auth/authContext'

// Trang đồng ý OAuth ("Authorization Path" trong Supabase → Authentication → OAuth Server).
// Claude (hoặc ứng dụng MCP khác) gửi người dùng tới Supabase /oauth/authorize; Supabase chuyển về đây
// kèm authorization_id. Người dùng đã đăng nhập xem ai đang xin quyền rồi Cho phép / Từ chối;
// Supabase trả về redirect_url để quay lại ứng dụng kia kèm mã cấp quyền (hoặc lỗi access_denied).

const TRUSTED_HOSTS = ['claude.ai', 'claude.com']

function hostOf(uri: string): string {
  try {
    return new URL(uri).host
  } catch {
    return uri
  }
}

export function ConsentPage() {
  const [params] = useSearchParams()
  const authorizationId = params.get('authorization_id')
  const { user } = useAuth()
  const [busy, setBusy] = useState<null | 'approve' | 'deny'>(null)
  const [error, setError] = useState<string | null>(null)

  const details = useQuery({
    queryKey: ['oauth-authorization', authorizationId],
    enabled: !!authorizationId,
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await getSupabase().auth.oauth.getAuthorizationDetails(authorizationId!)
      if (error) throw error
      return data
    },
  })

  // Đã đồng ý trước đó với đúng quyền này → Supabase trả luôn redirect_url, quay lại ngay.
  const alreadyApproved = details.data && 'redirect_url' in details.data ? details.data.redirect_url : null
  useEffect(() => {
    if (alreadyApproved) window.location.assign(alreadyApproved)
  }, [alreadyApproved])

  async function decide(action: 'approve' | 'deny') {
    setBusy(action)
    setError(null)
    const oauth = getSupabase().auth.oauth
    // Thành công: supabase-js tự chuyển trình duyệt tới redirect_url.
    const { error } = action === 'approve' ? await oauth.approveAuthorization(authorizationId!) : await oauth.denyAuthorization(authorizationId!)
    if (error) {
      setError(error.message || 'Không gửi được lựa chọn — yêu cầu có thể đã hết hạn. Hãy bấm kết nối lại từ Claude.')
      setBusy(null)
    }
  }

  if (!authorizationId) {
    return (
      <AuthCard title="Thiếu yêu cầu cấp quyền" footer={<Link to="/" className="font-medium text-brand">Về trang chủ</Link>}>
        <FormAlert tone="error">Đường dẫn này phải được mở từ Claude (hoặc ứng dụng đang xin quyền). Hãy bấm Kết nối lại từ ứng dụng đó.</FormAlert>
      </AuthCard>
    )
  }
  if (details.isLoading || alreadyApproved) {
    return <AuthCard title="Cho phép truy cập">{alreadyApproved ? <p className="text-muted">Bạn đã cho phép trước đó — đang quay lại…</p> : <p className="text-muted">Đang tải yêu cầu…</p>}</AuthCard>
  }
  if (details.error || !details.data || !('authorization_id' in details.data)) {
    return (
      <AuthCard title="Không đọc được yêu cầu" footer={<Link to="/" className="font-medium text-brand">Về trang chủ</Link>}>
        <FormAlert tone="error">Yêu cầu cấp quyền không tồn tại hoặc đã hết hạn (chỉ có hiệu lực vài phút). Hãy bấm Kết nối lại từ Claude.</FormAlert>
      </AuthCard>
    )
  }

  const { client, redirect_uri: redirectUri } = details.data
  const host = hostOf(redirectUri)
  const trusted = TRUSTED_HOSTS.includes(host)
  const loopback = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)

  return (
    <AuthCard title="Cho phép truy cập" subtitle={`Đang đăng nhập: ${user?.email ?? ''}`}>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-base">
          <strong>{client.name || 'Một ứng dụng'}</strong> muốn truy cập dữ liệu Tài Chính Cá Nhân của bạn.
        </p>

        <div>
          <p className="font-medium">Ứng dụng sẽ có thể:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
            <li>Xem tài khoản, số dư, giao dịch, ngân sách, khoản nợ, đầu tư và báo cáo</li>
            <li>Ghi, sửa, xóa giao dịch; lập ngân sách; thêm tài khoản tiền; cập nhật giá đầu tư</li>
          </ul>
          <p className="mt-2 font-medium">Không thể:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
            <li>Xem hay đổi mật khẩu của bạn, xóa toàn bộ dữ liệu, khôi phục sao lưu</li>
            <li>Thấy dữ liệu của người dùng khác</li>
          </ul>
        </div>

        <p>
          Sau khi chọn, bạn sẽ được chuyển về <strong className="break-all">{host}</strong>.
        </p>
        {!trusted && (
          <FormAlert tone="warning">
            {loopback
              ? 'Địa chỉ quay về nằm trên chính máy tính này (VD Claude Code). Chỉ cho phép nếu bạn vừa tự bấm kết nối.'
              : `Đây không phải địa chỉ của Claude. Chỉ cho phép nếu bạn biết và tin ứng dụng "${client.name}".`}
          </FormAlert>
        )}
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" disabled={busy !== null} onClick={() => void decide('deny')}>
            {busy === 'deny' ? 'Đang từ chối…' : 'Từ chối'}
          </Button>
          <Button className="flex-1" disabled={busy !== null} onClick={() => void decide('approve')}>
            {busy === 'approve' ? 'Đang chuyển…' : 'Cho phép'}
          </Button>
        </div>
        <p className="text-xs text-muted">Thu hồi bất cứ lúc nào trong Cài đặt → Kết nối Claude.</p>
      </div>
    </AuthCard>
  )
}
