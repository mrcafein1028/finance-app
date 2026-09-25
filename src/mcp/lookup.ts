import type { Account, Category, CategoryType } from '../schemas'

// Claude gọi tài khoản / danh mục bằng tên người dùng nói ("vietcombank", "ăn uống", "tien mat")
// chứ không biết id. Tra cứu không phân biệt hoa thường và dấu; mơ hồ thì báo lỗi kèm danh sách để Claude hỏi lại.

/** Lỗi trả về cho Claude như kết quả công cụ (isError) — thông điệp phải tự giải thích và gợi ý cách sửa. */
export class ToolError extends Error {}

/** "Ăn uống " → "an uong" — bỏ dấu, đ→d, gộp khoảng trắng. */
export const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

function pick<T extends { id: string; name: string }>(items: readonly T[], ref: string, what: string, describe: (item: T) => string): T {
  const byId = items.find((i) => i.id === ref)
  if (byId) return byId
  const q = fold(ref)
  const exact = items.filter((i) => fold(i.name) === q)
  if (exact.length === 1) return exact[0]!
  const partial = exact.length > 1 ? exact : items.filter((i) => fold(i.name).includes(q))
  if (partial.length === 1) return partial[0]!
  if (partial.length > 1) throw new ToolError(`"${ref}" khớp nhiều ${what}: ${partial.map(describe).join('; ')}. Hãy dùng tên đầy đủ hoặc id.`)
  throw new ToolError(`Không tìm thấy ${what} "${ref}". Hiện có: ${items.map(describe).join('; ') || '(chưa có)'}.`)
}

/** Tài khoản đang dùng (không tính đã lưu trữ). */
export function resolveAccount(accounts: readonly Account[], ref: string): Account {
  return pick(
    accounts.filter((a) => !a.archivedAt),
    ref,
    'tài khoản',
    (a) => `${a.name} (id ${a.id})`,
  )
}

const hasChildren = (id: string, all: readonly Category[]) => all.some((c) => c.parentId === id)

/**
 * Danh mục lá dùng được cho giao dịch. Nhận "Tên", "Nhóm > Tên" hoặc id.
 * Gọi tên một nhóm (có danh mục con) → báo lỗi liệt kê các danh mục con để chọn.
 */
export function resolveCategory(categories: readonly Category[], ref: string, type: CategoryType): Category {
  // Theo thứ tự hiển thị trong app, để danh sách gợi ý dễ đọc.
  const active = categories.filter((c) => c.type === type && !c.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder)
  const parentName = (c: Category) => (c.parentId ? categories.find((p) => p.id === c.parentId)?.name : undefined)
  const label = (c: Category) => (parentName(c) ? `${parentName(c)} > ${c.name}` : c.name)
  const segments = ref.split(/\s*[>/›]\s*/).filter(Boolean)
  let pool = active
  if (segments.length > 1) {
    const parent = pick(active.filter((c) => !c.parentId), segments[0]!, `nhóm danh mục ${type === 'income' ? 'thu' : 'chi'}`, (c) => c.name)
    pool = active.filter((c) => c.parentId === parent.id)
  }
  const found = pick(pool, segments.at(-1) ?? ref, `danh mục ${type === 'income' ? 'thu' : 'chi'}`, (c) => `${label(c)}${hasChildren(c.id, categories) ? ' (nhóm)' : ''}`)
  if (hasChildren(found.id, categories)) {
    const children = active.filter((c) => c.parentId === found.id).map((c) => c.name)
    throw new ToolError(`"${found.name}" là nhóm — hãy chọn một danh mục con: ${children.join(', ')}.`)
  }
  return found
}
