import type { Account, Category, CategoryType } from '../../schemas'
import { formatMoney } from '../../lib/format'

/** Option danh mục: chỉ chọn được danh mục lá; nhóm cha thành optgroup; "Gần đây" lên đầu (docs/06). */
export function CategoryOptions({
  categories,
  type,
  recent = [],
  placeholder = '— Chọn danh mục —',
}: {
  categories: readonly Category[]
  type: CategoryType
  recent?: readonly string[]
  placeholder?: string
}) {
  const active = categories.filter((c) => c.type === type && !c.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder)
  const parents = active.filter((c) => c.parentId === null)
  const childrenOf = (id: string) => active.filter((c) => c.parentId === id)
  const leaves = new Set(active.filter((c) => childrenOf(c.id).length === 0).map((c) => c.id))
  const recentLeaves = recent.filter((id) => leaves.has(id)).map((id) => active.find((c) => c.id === id)!)
  const standalone = parents.filter((p) => childrenOf(p.id).length === 0)
  const groups = parents.filter((p) => childrenOf(p.id).length > 0)

  return (
    <>
      <option value="">{placeholder}</option>
      {recentLeaves.length > 0 && (
        <optgroup label="Gần đây">
          {recentLeaves.map((c) => (
            <option key={`r-${c.id}`} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      )}
      {groups.length > 0 ? (
        <>
          {standalone.length > 0 && (
            <optgroup label="Danh mục">
              {standalone.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          )}
          {groups.map((g) => (
            <optgroup key={g.id} label={g.name}>
              {childrenOf(g.id).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </>
      ) : (
        standalone.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))
      )}
    </>
  )
}

const GROUPS: { label: string; kinds: Account['kind'][] }[] = [
  { label: 'Tiền & ngân hàng', kinds: ['cash', 'bank', 'ewallet'] },
  { label: 'Quỹ mục tiêu', kinds: ['goal_fund'] },
  { label: 'Tiết kiệm & đầu tư', kinds: ['term_deposit', 'investment', 'other_asset'] },
  { label: 'Khoản nợ', kinds: ['loan', 'credit_card', 'bnpl', 'personal_debt'] },
]

/** Option tài khoản: nhóm theo loại, kèm số dư hiện tại, ẩn tài khoản đã lưu trữ (trừ tài khoản đang chọn khi sửa). */
export function AccountOptions({
  accounts,
  balances,
  keep,
  filter = () => true,
  placeholder = '— Chọn tài khoản —',
}: {
  accounts: readonly Account[]
  balances: ReadonlyMap<string, number>
  keep?: string | null
  filter?: (a: Account) => boolean
  placeholder?: string
}) {
  const visible = accounts.filter((a) => (a.archivedAt === null || a.id === keep) && filter(a))
  return (
    <>
      <option value="">{placeholder}</option>
      {GROUPS.map((g) => {
        const list = visible.filter((a) => g.kinds.includes(a.kind))
        if (list.length === 0) return null
        return (
          <optgroup key={g.label} label={g.label}>
            {list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {formatMoney(balances.get(a.id) ?? 0)}
                {a.class === 'liability' ? ' nợ' : ''}
              </option>
            ))}
          </optgroup>
        )
      })}
    </>
  )
}

