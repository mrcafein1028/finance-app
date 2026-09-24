import { nowIso } from '../../lib/clock'
import { newId } from '../../lib/id'
import type { BudgetBucket, Category, CategoryType, SystemCategoryKey } from '../../schemas'

interface CategorySpec {
  name: string
  bucket?: BudgetBucket
  systemKey?: SystemCategoryKey
  icon?: string
  children?: CategorySpec[]
}

export type CategoryTemplate = 'basic' | 'detailed'

// Danh mục hệ thống luôn có mặt, bất kể người dùng chọn bộ mẫu nào (docs/03 §3.4).
const SYSTEM_INCOME: CategorySpec[] = [
  { name: 'Lãi tiết kiệm', systemKey: 'savings_interest', icon: 'piggy-bank' },
  { name: 'Cổ tức & lãi đầu tư', systemKey: 'investment_income', icon: 'trending-up' },
]

const SYSTEM_EXPENSE_GROUP: CategorySpec = {
  name: 'Tài chính',
  bucket: 'needs',
  icon: 'landmark',
  children: [
    { name: 'Lãi vay', systemKey: 'loan_interest' },
    { name: 'Phí trả nợ trước hạn', systemKey: 'prepayment_fee' },
    { name: 'Phí ngân hàng', systemKey: 'bank_fee' },
    { name: 'Phí & thuế đầu tư', systemKey: 'investment_fee_tax' },
  ],
}

const TEMPLATES: Record<CategoryTemplate, { income: CategorySpec[]; expense: CategorySpec[] }> = {
  basic: {
    income: [{ name: 'Lương', icon: 'wallet' }, { name: 'Thưởng', icon: 'gift' }, { name: 'Thu nhập khác', icon: 'plus' }],
    expense: [
      { name: 'Nhà ở', bucket: 'needs', icon: 'home' },
      { name: 'Ăn uống', bucket: 'needs', icon: 'utensils' },
      { name: 'Đi lại', bucket: 'needs', icon: 'car' },
      { name: 'Hóa đơn & tiện ích', bucket: 'needs', icon: 'receipt' },
      { name: 'Sức khỏe', bucket: 'needs', icon: 'heart-pulse' },
      { name: 'Giáo dục', bucket: 'needs', icon: 'book' },
      { name: 'Mua sắm', bucket: 'wants', icon: 'shopping-bag' },
      { name: 'Giải trí', bucket: 'wants', icon: 'ticket' },
      { name: 'Hiếu hỷ & quà tặng', bucket: 'wants', icon: 'gift' },
      { name: 'Chi khác', bucket: 'wants', icon: 'more-horizontal' },
    ],
  },
  detailed: {
    income: [
      { name: 'Lương', icon: 'wallet' },
      { name: 'Thưởng', icon: 'gift' },
      { name: 'Thu nhập tự do', icon: 'briefcase' },
      { name: 'Cho thuê', icon: 'key' },
      { name: 'Thu nhập khác', icon: 'plus' },
    ],
    expense: [
      {
        name: 'Nhà ở', bucket: 'needs', icon: 'home',
        children: [{ name: 'Tiền thuê nhà' }, { name: 'Sửa chữa & bảo trì' }, { name: 'Phí quản lý' }],
      },
      {
        name: 'Ăn uống', bucket: 'needs', icon: 'utensils',
        children: [{ name: 'Đi chợ & siêu thị' }, { name: 'Ăn ngoài', bucket: 'wants' }, { name: 'Cà phê & đồ uống', bucket: 'wants' }],
      },
      {
        name: 'Đi lại', bucket: 'needs', icon: 'car',
        children: [{ name: 'Xăng xe' }, { name: 'Gửi xe & phí đường' }, { name: 'Taxi & xe công nghệ' }, { name: 'Bảo dưỡng xe' }],
      },
      {
        name: 'Hóa đơn & tiện ích', bucket: 'needs', icon: 'receipt',
        children: [{ name: 'Điện' }, { name: 'Nước' }, { name: 'Internet & điện thoại' }, { name: 'Gas' }],
      },
      {
        name: 'Sức khỏe', bucket: 'needs', icon: 'heart-pulse',
        children: [{ name: 'Khám chữa bệnh' }, { name: 'Thuốc' }, { name: 'Bảo hiểm' }, { name: 'Thể thao', bucket: 'wants' }],
      },
      {
        name: 'Gia đình', bucket: 'needs', icon: 'users',
        children: [{ name: 'Học phí con' }, { name: 'Gửi bố mẹ' }, { name: 'Đồ dùng trẻ em' }],
      },
      { name: 'Giáo dục bản thân', bucket: 'needs', icon: 'book', children: [{ name: 'Khóa học' }, { name: 'Sách' }] },
      {
        name: 'Mua sắm', bucket: 'wants', icon: 'shopping-bag',
        children: [{ name: 'Quần áo' }, { name: 'Đồ gia dụng' }, { name: 'Điện tử' }, { name: 'Làm đẹp' }],
      },
      {
        name: 'Giải trí', bucket: 'wants', icon: 'ticket',
        children: [{ name: 'Du lịch' }, { name: 'Phim & sự kiện' }, { name: 'Dịch vụ đăng ký' }],
      },
      { name: 'Xã hội', bucket: 'wants', icon: 'gift', children: [{ name: 'Hiếu hỷ' }, { name: 'Quà tặng' }, { name: 'Từ thiện' }] },
      { name: 'Chi khác', bucket: 'wants', icon: 'more-horizontal', children: [{ name: 'Chi không rõ' }, { name: 'Khác' }] },
    ],
  },
}

/** Sinh danh sách danh mục (cha trước con) cho bước onboarding "chọn bộ danh mục". */
export function buildCategorySeed(template: CategoryTemplate): Category[] {
  const now = nowIso()
  const result: Category[] = []

  const add = (spec: CategorySpec, type: CategoryType, parentId: string | null, sortOrder: number) => {
    const category: Category = {
      id: newId(),
      name: spec.name,
      type,
      parentId,
      // Con không đặt nhóm thì để null → kế thừa của cha khi tính 50/30/20.
      bucket: type === 'expense' ? (spec.bucket ?? null) : null,
      isSystem: spec.systemKey !== undefined,
      systemKey: spec.systemKey ?? null,
      archivedAt: null,
      icon: spec.icon ?? null,
      color: null,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    }
    result.push(category)
    spec.children?.forEach((child, i) => add(child, type, category.id, i))
  }

  const { income, expense } = TEMPLATES[template]
  ;[...income, ...SYSTEM_INCOME].forEach((spec, i) => add(spec, 'income', null, i))
  ;[...expense, SYSTEM_EXPENSE_GROUP].forEach((spec, i) => add(spec, 'expense', null, i))
  return result
}
