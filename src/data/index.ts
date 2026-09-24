import { createRepositories, type Repositories } from './repositories'
import { getSupabase } from './supabase'

let repos: Repositories | null = null

/** Repositories dùng chung cho toàn app (tạo lần đầu khi gọi, sau khi đã kiểm tra cấu hình Supabase). */
export function getRepos(): Repositories {
  repos ??= createRepositories(getSupabase())
  return repos
}

export { createRepositories, DEFAULT_SETTINGS, type Repositories } from './repositories'
export { getSupabase, isSupabaseConfigured } from './supabase'
export { AuthRequiredError, ConflictError, DatabaseError, ForbiddenError, NotFoundError, ValidationError } from './errors'
