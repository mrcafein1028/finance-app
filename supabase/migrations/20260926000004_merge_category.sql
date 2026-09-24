-- =============================================================================
-- Gộp danh mục (docs/05 W15): chuyển mọi giao dịch, dòng ngân sách và mẫu giao dịch định kỳ
-- từ danh mục `p_from` sang `p_to` rồi xóa `p_from` — trong MỘT transaction.
-- Chạy sau 20260925000003_transaction_groups.sql.
-- =============================================================================

create or replace function public.merge_category(p_from uuid, p_to uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  src public.categories;
  dst public.categories;
  moved integer;
  l public.budget_lines;
begin
  if uid is null then
    raise exception 'Chưa đăng nhập' using errcode = '42501';
  end if;
  select * into src from public.categories where user_id = uid and id = p_from;
  select * into dst from public.categories where user_id = uid and id = p_to;
  if src.id is null or dst.id is null then
    raise exception 'Không tìm thấy danh mục' using errcode = 'P0001';
  end if;
  if src.id = dst.id then
    raise exception 'Hãy chọn một danh mục khác để gộp vào' using errcode = 'P0001';
  end if;
  if src.is_system then
    raise exception 'Không thể xóa danh mục hệ thống' using errcode = 'P0001';
  end if;
  if src.type <> dst.type then
    raise exception 'Chỉ gộp được vào danh mục cùng loại thu/chi' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.categories where user_id = uid and parent_id = p_from) then
    raise exception 'Danh mục còn danh mục con — hãy gộp hoặc chuyển các danh mục con trước' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.categories where user_id = uid and parent_id = p_to) then
    raise exception 'Hãy gộp vào một danh mục con, không phải nhóm' using errcode = 'P0001';
  end if;

  update public.transactions set category_id = p_to where user_id = uid and category_id = p_from;
  get diagnostics moved = row_count;

  -- Dòng ngân sách: tháng đã có dòng cho danh mục đích → cộng dồn; chưa có → đổi target.
  for l in select * from public.budget_lines where user_id = uid and target_key = 'c:' || p_from loop
    if exists (select 1 from public.budget_lines where user_id = uid and month = l.month and target_key = 'c:' || p_to) then
      update public.budget_lines set planned = planned + l.planned where user_id = uid and month = l.month and target_key = 'c:' || p_to;
      delete from public.budget_lines where user_id = uid and id = l.id;
    else
      update public.budget_lines
      set target = jsonb_build_object('kind', 'category', 'categoryId', p_to), target_key = 'c:' || p_to
      where user_id = uid and id = l.id;
    end if;
  end loop;

  update public.recurring_rules
  set template = jsonb_set(template, '{categoryId}', to_jsonb(p_to::text))
  where user_id = uid and template ->> 'categoryId' = p_from::text;

  delete from public.categories where user_id = uid and id = p_from;
  return moved;
end;
$$;

revoke execute on function public.merge_category(uuid, uuid) from public, anon;
grant execute on function public.merge_category(uuid, uuid) to authenticated;
