import type { Repositories } from '../data/repositories'
import { buildCategorySeed, type CategoryTemplate } from '../data/seed/categories'
import { periodOf } from '../domain/period'
import { today } from '../lib/clock'
import type { BudgetMode } from '../schemas'

// W0 — mỗi bước ghi ngay dữ liệu của nó, nên thoát giữa chừng không mất gì và mở lại tiếp tục được.

export const ONBOARDING_STEPS = ['welcome', 'settings', 'categories', 'accounts', 'emergency', 'income', 'done'] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export const saveBasicSettings = (repos: Repositories, periodStartDay: number, defaultBudgetMode: BudgetMode) =>
  repos.settings.update({ periodStartDay, defaultBudgetMode })

/** Tạo bộ danh mục mẫu — bỏ qua nếu người dùng đã có danh mục (mở lại onboarding). */
export async function seedCategories(repos: Repositories, template: CategoryTemplate) {
  const existing = await repos.categories.list()
  if (existing.length > 0) return existing
  return repos.categories.bulkCreate(buildCategorySeed(template))
}

/** Ngân sách tháng hiện tại với thu nhập dự kiến (tạo mới hoặc cập nhật). */
export async function saveExpectedIncome(repos: Repositories, expectedIncome: number, periodStartDay: number, mode: BudgetMode) {
  const month = periodOf(today(), periodStartDay)
  const existing = await repos.budgetMonths.byMonth(month)
  if (existing) return repos.budgetMonths.update(existing.id, { expectedIncome })
  return repos.budgetMonths.create({ month, mode, expectedIncome, status: 'open', closedAt: null, note: null })
}

export const completeOnboarding = (repos: Repositories) => repos.settings.update({ onboardingCompleted: true })
