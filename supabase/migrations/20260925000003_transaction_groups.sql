-- =============================================================================
-- Nhóm giao dịch: các giao dịch sinh ra từ MỘT nghiệp vụ (trả nợ = gốc + lãi + phí,
-- mua đầu tư = chuyển tiền + phí…) luôn được ghi / sửa / xóa CÙNG NHAU (bất biến I8).
-- Chạy sau 20260924000001_init.sql.
-- =============================================================================

-- Ghi đè toàn bộ nhóm `p_group_id` bằng các dòng trong `p_rows` (mảng JSON, cột snake_case).
-- Lỗi ở bất kỳ dòng nào (ràng buộc, trigger) → không dòng nào được ghi, nhóm cũ giữ nguyên.
create or replace function public.save_transaction_group(p_group_id uuid, p_rows jsonb)
returns setof public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Chưa đăng nhập' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nhóm giao dịch phải có ít nhất một giao dịch' using errcode = 'P0001';
  end if;

  delete from public.transactions where user_id = uid and group_id = p_group_id;

  return query
  insert into public.transactions
  select *
  from jsonb_populate_recordset(
    null::public.transactions,
    (
      select jsonb_agg(
        jsonb_build_object('id', gen_random_uuid(), 'tags', '[]'::jsonb, 'origin', 'manual', 'created_at', now(), 'updated_at', now())
        || e
        || jsonb_build_object('user_id', uid, 'group_id', p_group_id)
      )
      from jsonb_array_elements(p_rows) as e
    )
  )
  returning *;
end;
$$;

-- Xóa cả nhóm; trả về số giao dịch đã xóa.
create or replace function public.delete_transaction_group(p_group_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  deleted integer;
begin
  if uid is null then
    raise exception 'Chưa đăng nhập' using errcode = '42501';
  end if;
  delete from public.transactions where user_id = uid and group_id = p_group_id;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke execute on function public.save_transaction_group(uuid, jsonb) from public, anon;
revoke execute on function public.delete_transaction_group(uuid) from public, anon;
grant execute on function public.save_transaction_group(uuid, jsonb) to authenticated;
grant execute on function public.delete_transaction_group(uuid) to authenticated;
