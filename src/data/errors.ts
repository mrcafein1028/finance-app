import type { ZodError } from 'zod'

export interface FieldIssue {
  path: string
  message: string
}

/** Dữ liệu không hợp lệ — UI hiển thị `issues` dưới từng trường (path rỗng = lỗi chung của form). */
export class ValidationError extends Error {
  readonly issues: FieldIssue[]

  constructor(issues: FieldIssue[]) {
    super(issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; '))
    this.name = 'ValidationError'
    this.issues = issues
  }

  static fromZod(error: ZodError): ValidationError {
    return new ValidationError(error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`Không tìm thấy ${what}`)
    this.name = 'NotFoundError'
  }
}

/** Vi phạm ràng buộc giữa nhiều bản ghi: trùng tên, đang được tham chiếu… */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class AuthRequiredError extends Error {
  constructor(message = 'Phiên đăng nhập đã hết, vui lòng đăng nhập lại') {
    super(message)
    this.name = 'AuthRequiredError'
  }
}

/** Đã đăng nhập nhưng thao tác trên dữ liệu không thuộc về mình (bị RLS chặn). */
export class ForbiddenError extends Error {
  constructor(message = 'Bạn không có quyền thao tác trên dữ liệu này') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

/** Lỗi hạ tầng (mạng, máy chủ) — không phải lỗi dữ liệu của người dùng. */
export class DatabaseError extends Error {
  readonly code: string | undefined

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'DatabaseError'
    this.code = code
  }
}

/** Thông báo thân thiện cho từng ràng buộc unique trong supabase/migrations. */
const UNIQUE_MESSAGES: Record<string, string> = {
  accounts_active_name_key: 'Đã có tài khoản cùng tên',
  categories_sibling_name_key: 'Đã có danh mục cùng tên trong nhóm này',
  categories_system_key_key: 'Danh mục hệ thống này đã tồn tại',
  transactions_user_id_idempotency_key_key: 'Giao dịch này đã được ghi trước đó',
  holdings_user_id_account_id_symbol_key: 'Mã này đã có trong tài khoản đầu tư',
  price_quotes_user_id_symbol_date_key: 'Mã này đã có giá cho ngày này',
  deposit_terms_user_id_account_id_seq_key: 'Kỳ gửi này đã tồn tại',
  budget_months_user_id_month_key: 'Tháng này đã có ngân sách',
  budget_lines_user_id_month_target_key_key: 'Dòng ngân sách này đã tồn tại trong tháng',
  net_worth_snapshots_user_id_month_key: 'Tháng này đã có snapshot',
}

interface PgLikeError {
  code?: string
  message: string
}

const constraintName = (message: string) => /constraint "([^"]+)"/.exec(message)?.[1] ?? ''

/**
 * Đổi lỗi Postgres/PostgREST thành lỗi nghiệp vụ. Dùng cho cả lỗi từ supabase-js (PostgrestError)
 * lẫn lỗi từ PGlite trong test — cả hai đều có `code` SQLSTATE và `message`.
 */
export function fromDbError(error: PgLikeError): Error {
  const constraint = constraintName(error.message)
  switch (error.code) {
    case '23505':
      return new ConflictError(UNIQUE_MESSAGES[constraint] ?? 'Dữ liệu bị trùng')
    case '23503':
      return error.message.includes('update or delete')
        ? new ConflictError('Không thể xóa vì dữ liệu này đang được sử dụng ở nơi khác')
        : new ValidationError([{ path: '', message: 'Dữ liệu liên quan không tồn tại (tài khoản, danh mục…)' }])
    case '23514':
    case '23502':
    case '22P02':
      return new ValidationError([{ path: '', message: `Dữ liệu không hợp lệ${constraint ? ` (${constraint})` : ''}` }])
    case 'P0001': // raise exception trong trigger — message đã là tiếng Việt
      return new ValidationError([{ path: '', message: error.message }])
    case '42501':
      return /row-level security/i.test(error.message) ? new ForbiddenError() : new AuthRequiredError()
    case 'PGRST116':
      return new NotFoundError('bản ghi')
    default:
      return new DatabaseError(error.message || 'Lỗi kết nối máy chủ', error.code)
  }
}
