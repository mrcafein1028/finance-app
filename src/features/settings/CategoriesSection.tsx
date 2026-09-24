import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { FormDialog } from '../../components/ui/FormDialog'
import { Button, SegmentedControl, SelectField, TextField } from '../../components/ui/form'
import { useToast } from '../../components/ui/toastContext'
import { getRepos } from '../../data'
import { useCategories, useInvalidate } from '../../data/queries'
import type { BudgetBucket, Category, CategoryType } from '../../schemas'
import { archiveCategory, categoryUsage, createCategory, deleteCategory, mergeTargets, updateCategory } from '../../services/settings'

const BUCKET_LABELS: Record<BudgetBucket, string> = { needs: 'Thiết yếu', wants: 'Mong muốn', savings: 'Tiết kiệm' }
const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Có lỗi xảy ra')

type DialogState = { kind: 'edit'; category: Category | null } | { kind: 'merge'; category: Category } | null

/** W15 — quản lý danh mục: thêm, sửa, lưu trữ, xóa (khi chưa dùng) hoặc gộp (giữ lịch sử). */
export function CategoriesSection() {
  const categories = useCategories().data ?? []
  const invalidate = useInvalidate()
  const toast = useToast()
  const [type, setType] = useState<CategoryType>('expense')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [showArchived, setShowArchived] = useState(false)

  const ofType = categories.filter((c) => c.type === type && (showArchived || !c.archivedAt))
  const roots = ofType.filter((c) => !c.parentId || !ofType.some((p) => p.id === c.parentId)).sort((a, b) => a.sortOrder - b.sortOrder)
  const childrenOf = (id: string) => ofType.filter((c) => c.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder)
  const refresh = () => invalidate('categories', 'transactions', 'budgetLines', 'recurringRules')

  async function remove(c: Category) {
    try {
      await deleteCategory(getRepos(), c)
      await refresh()
      setDialog(null)
      toast({ message: `Đã xóa danh mục "${c.name}"` })
    } catch (e) {
      toast({ message: errorText(e), tone: 'error' })
    }
  }

  async function toggleArchive(c: Category) {
    try {
      await archiveCategory(getRepos(), c.id, !c.archivedAt)
      await refresh()
      setDialog(null)
      toast({ message: c.archivedAt ? `Đã dùng lại "${c.name}"` : `Đã lưu trữ "${c.name}" — không còn hiện khi ghi giao dịch` })
    } catch (e) {
      toast({ message: errorText(e), tone: 'error' })
    }
  }

  const row = (c: Category, child: boolean) => (
    <li key={c.id} className={`flex items-center justify-between gap-3 py-2 ${child ? 'pl-6' : ''}`}>
      <span className="min-w-0">
        <span className={`${child ? '' : 'font-medium'} ${c.archivedAt ? 'text-muted line-through' : ''}`}>{c.name}</span>
        <span className="ml-2 text-xs text-muted">
          {[c.bucket && BUCKET_LABELS[c.bucket], c.isSystem && 'hệ thống', c.archivedAt && 'đã lưu trữ'].filter(Boolean).join(' · ')}
        </span>
      </span>
      <Button variant="ghost" className="px-2 py-1 text-sm" aria-label={`Sửa danh mục ${c.name}`} onClick={() => setDialog({ kind: 'edit', category: c })}>
        Sửa
      </Button>
    </li>
  )

  return (
    <section aria-labelledby="categories-title" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="categories-title" className="text-lg font-semibold">
          Danh mục thu chi
        </h2>
        <Button variant="secondary" onClick={() => setDialog({ kind: 'edit', category: null })}>
          Thêm danh mục
        </Button>
      </div>
      <SegmentedControl label="Loại danh mục" options={[{ value: 'expense', label: 'Chi' }, { value: 'income', label: 'Thu' }] as const} value={type} onChange={setType} />
      <ul aria-label="Danh sách danh mục" className="divide-y divide-border">
        {roots.map((c) => (
          <li key={c.id}>
            <ul>
              {row(c, false)}
              {childrenOf(c.id).map((k) => row(k, true))}
            </ul>
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-[var(--color-brand)]" />
        Hiện danh mục đã lưu trữ
      </label>

      {dialog?.kind === 'edit' && (
        <CategoryDialog
          category={dialog.category}
          type={type}
          all={categories}
          onClose={() => setDialog(null)}
          onSaved={async (name) => {
            await refresh()
            setDialog(null)
            toast({ message: `Đã lưu danh mục "${name}"` })
          }}
          onDelete={remove}
          onArchive={toggleArchive}
          onMerge={(c) => setDialog({ kind: 'merge', category: c })}
        />
      )}
      {dialog?.kind === 'merge' && (
        <MergeDialog
          from={dialog.category}
          all={categories}
          onClose={() => setDialog(null)}
          onMerged={async (target, moved) => {
            await refresh()
            setDialog(null)
            toast({ message: `Đã gộp "${dialog.category.name}" vào "${target.name}" (${moved} giao dịch)` })
          }}
        />
      )}
    </section>
  )
}

function CategoryDialog({
  category,
  type,
  all,
  onClose,
  onSaved,
  onDelete,
  onArchive,
  onMerge,
}: {
  category: Category | null
  type: CategoryType
  all: Category[]
  onClose: () => void
  onSaved: (name: string) => Promise<void>
  onDelete: (c: Category) => void
  onArchive: (c: Category) => void
  onMerge: (c: Category) => void
}) {
  const kind = category?.type ?? type
  const [name, setName] = useState(category?.name ?? '')
  const [parentId, setParentId] = useState(category?.parentId ?? '')
  const [bucket, setBucket] = useState<BudgetBucket | ''>(category?.bucket ?? (kind === 'expense' ? 'wants' : ''))
  const parents = all.filter((c) => c.type === kind && !c.parentId && c.id !== category?.id && !c.archivedAt)
  const locked = category?.isSystem ?? false

  return (
    <FormDialog
      title={category ? `Sửa danh mục` : `Thêm danh mục ${kind === 'expense' ? 'chi' : 'thu'}`}
      onClose={onClose}
      onSubmit={async () => {
        if (!name.trim()) return 'Nhập tên danh mục'
        const input = { name, parentId: parentId || null, bucket: kind === 'income' || !bucket ? null : bucket }
        if (category) await updateCategory(getRepos(), category, input)
        else await createCategory(getRepos(), { ...input, type: kind })
        await onSaved(name.trim())
      }}
      extraActions={
        category && !locked ? (
          <span className="mr-auto flex flex-wrap gap-1">
            <Button variant="ghost" onClick={() => onMerge(category)}>
              Gộp…
            </Button>
            <Button variant="ghost" onClick={() => onArchive(category)}>
              {category.archivedAt ? 'Dùng lại' : 'Lưu trữ'}
            </Button>
            <Button variant="ghost" className="text-negative" onClick={() => onDelete(category)}>
              Xóa
            </Button>
          </span>
        ) : undefined
      }
    >
      <TextField label="Tên danh mục" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
      {locked ? (
        <p className="text-sm text-muted">Danh mục hệ thống (lãi vay, phí, lãi tiết kiệm…) được app tự dùng khi ghi nghiệp vụ nên chỉ đổi được tên.</p>
      ) : (
        <>
          <SelectField label="Thuộc nhóm" value={parentId} onChange={(e) => setParentId(e.target.value)} hint="Danh mục con giúp báo cáo gọn hơn; tối đa 2 cấp.">
            <option value="">— Không (danh mục cấp 1) —</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          {kind === 'expense' && (
            <SelectField label="Nhóm 50/30/20" value={bucket} onChange={(e) => setBucket(e.target.value as BudgetBucket | '')} hint="Để trống thì theo nhóm cha.">
              <option value="">— Theo nhóm cha —</option>
              {(Object.keys(BUCKET_LABELS) as BudgetBucket[]).map((b) => (
                <option key={b} value={b}>
                  {BUCKET_LABELS[b]}
                </option>
              ))}
            </SelectField>
          )}
        </>
      )}
    </FormDialog>
  )
}

function MergeDialog({ from, all, onClose, onMerged }: { from: Category; all: Category[]; onClose: () => void; onMerged: (target: Category, moved: number) => Promise<void> }) {
  const targets = mergeTargets(all, from)
  const [toId, setToId] = useState('')
  const usage = useQuery({ queryKey: ['categoryUsage', from.id], queryFn: () => categoryUsage(getRepos(), from.id), gcTime: 0 }).data

  return (
    <FormDialog
      title={`Gộp "${from.name}"`}
      submitLabel="Gộp và xóa"
      danger
      onClose={onClose}
      onSubmit={async () => {
        const target = targets.find((t) => t.id === toId)
        if (!target) return 'Chọn danh mục để gộp vào'
        const moved = await getRepos().categories.merge(from.id, target.id)
        await onMerged(target, moved)
      }}
    >
      <p className="text-sm">
        Mọi giao dịch, dòng ngân sách và giao dịch định kỳ của <strong>{from.name}</strong> sẽ chuyển sang danh mục bạn chọn, rồi <strong>{from.name}</strong> bị xóa. Tổng thu chi không đổi.
      </p>
      {usage && (
        <p className="text-sm text-muted">
          Đang dùng ở: {usage.transactions} giao dịch · {usage.budgetLines} dòng ngân sách · {usage.recurringRules} giao dịch định kỳ
        </p>
      )}
      <SelectField label="Gộp vào danh mục" value={toId} onChange={(e) => setToId(e.target.value)}>
        <option value="">— Chọn —</option>
        {targets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.parentId ? `${all.find((p) => p.id === t.parentId)?.name ?? ''} › ` : ''}
            {t.name}
          </option>
        ))}
      </SelectField>
    </FormDialog>
  )
}
