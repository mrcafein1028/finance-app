/** Mã lỗi của Supabase Auth → thông báo tiếng Việt. Tham khảo: supabase.com/docs/guides/auth/debugging/error-codes */
const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email hoặc mật khẩu không đúng',
  email_not_confirmed: 'Email chưa được xác nhận — hãy mở thư xác nhận trong hộp thư của bạn',
  user_already_exists: 'Email này đã được đăng ký',
  email_exists: 'Email này đã được đăng ký',
  weak_password: 'Mật khẩu quá yếu — hãy dùng ít nhất 8 ký tự, gồm chữ và số',
  same_password: 'Mật khẩu mới phải khác mật khẩu hiện tại',
  over_email_send_rate_limit: 'Đã gửi quá nhiều email, vui lòng thử lại sau ít phút',
  over_request_rate_limit: 'Thao tác quá nhanh, vui lòng thử lại sau ít phút',
  email_address_invalid: 'Email không hợp lệ',
  signup_disabled: 'Hiện chưa mở đăng ký tài khoản mới',
  session_expired: 'Phiên đăng nhập đã hết, vui lòng đăng nhập lại',
  otp_expired: 'Đường dẫn đã hết hạn, vui lòng yêu cầu gửi lại',
}

interface AuthErrorLike {
  code?: string
  status?: number
  message?: string
  name?: string
}

export function authErrorMessage(error: unknown): string {
  const e = (error ?? {}) as AuthErrorLike
  if (e.code && MESSAGES[e.code]) return MESSAGES[e.code]!
  if (e.name === 'AuthRetryableFetchError' || e.status === 0 || e.message === 'Failed to fetch') {
    return 'Không kết nối được máy chủ — kiểm tra mạng và thử lại'
  }
  return e.message ? `Có lỗi xảy ra: ${e.message}` : 'Có lỗi xảy ra, vui lòng thử lại'
}
