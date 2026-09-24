-- =============================================================================
-- Supabase Storage: bucket riêng tư "user-files" cho file của người dùng
-- (file sao lưu, ảnh hóa đơn…). Mỗi người chỉ truy cập thư mục <user_id>/ của mình.
-- Đường dẫn file: <user_id>/backups/2026-09-24.json, <user_id>/receipts/<id>.jpg
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('user-files', 'user-files', false, 52428800) -- 50 MB / file
on conflict (id) do nothing;

create policy "user-files: đọc file của mình" on storage.objects
  for select to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "user-files: tải lên thư mục của mình" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "user-files: sửa file của mình" on storage.objects
  for update to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "user-files: xóa file của mình" on storage.objects
  for delete to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
