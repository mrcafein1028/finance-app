/** Vi phạm quy tắc nghiệp vụ phát hiện trong tính toán (VD bán quá số lượng đang có). */
export class DomainError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}
