-- =============================================================================
-- Xóa hẳn một tài khoản cùng MỌI dữ liệu gắn với nó — trong MỘT transaction (lỗi → không xóa gì).
-- Dùng khi nhập nhầm một tài khoản và muốn làm lại từ đầu (Cài đặt không đủ: tài khoản đã có giao dịch).
-- Chạy sau 20260926000004_merge_category.sql.
--
-- Xóa theo thứ tự con → cha:
--   1. giao dịch định kỳ có mẫu dùng tài khoản này
--   2. lệnh mua/bán của các mã trong tài khoản (và lệnh lấy tiền từ tài khoản này)
--   3. giao dịch chạm tới tài khoản + CẢ NHÓM của chúng (VD trả nợ = gốc + lãi: xóa đủ cả hai phần)
--   4. mã đầu tư, kỳ gửi tiết kiệm, định giá tài sản, dòng ngân sách dành cho tài khoản
--   5. chính tài khoản
-- Ảnh chụp net worth từ tháng trước ngày bắt đầu theo dõi bị đánh dấu cần tính lại.
-- =============================================================================

create or replace function public.delete_account_cascade(p_account uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  acc public.accounts;
  blocker text;
  n_rules integer;
  n_trades integer;
  n_transactions integer;
  groups uuid[];
begin
  if uid is null then
    raise exception 'Chưa đăng nhập' using errcode = '42501';
  end if;
  select * into acc from public.accounts where user_id = uid and id = p_account;
  if acc.id is null then
    raise exception 'Không tìm thấy tài khoản' using errcode = 'P0001';
  end if;

  -- Một sổ tiết kiệm khác trả lãi vào tài khoản này → xóa sẽ làm sổ đó hỏng.
  select name into blocker from public.accounts
  where user_id = uid and id <> p_account and kind = 'term_deposit' and details ->> 'payoutAccountId' = p_account::text
  limit 1;
  if blocker is not null then
    raise exception 'Sổ tiết kiệm "%" đang nhận lãi vào tài khoản này — hãy đổi tài khoản nhận lãi của sổ đó trước', blocker using errcode = 'P0001';
  end if;

  delete from public.recurring_rules
  where user_id = uid and (template ->> 'accountId' = p_account::text or template ->> 'toAccountId' = p_account::text);
  get diagnostics n_rules = row_count;

  -- Nhóm giao dịch gắn với lệnh sẽ bị xóa (phí, chuyển tiền của lệnh) — xóa cùng giao dịch ở bước sau.
  select coalesce(array_agg(distinct g), '{}') into groups from (
    select group_id as g from public.investment_trades
    where user_id = uid and group_id is not null
      and (cash_account_id = p_account or holding_id in (select id from public.holdings where user_id = uid and account_id = p_account))
    union
    select group_id from public.transactions
    where user_id = uid and group_id is not null and (account_id = p_account or to_account_id = p_account)
  ) s;

  delete from public.investment_trades
  where user_id = uid
    and (cash_account_id = p_account or holding_id in (select id from public.holdings where user_id = uid and account_id = p_account));
  get diagnostics n_trades = row_count;

  delete from public.transactions
  where user_id = uid
    and (account_id = p_account or to_account_id = p_account or group_id = any(groups));
  get diagnostics n_transactions = row_count;

  delete from public.holdings where user_id = uid and account_id = p_account;
  delete from public.deposit_terms where user_id = uid and account_id = p_account;
  delete from public.asset_valuations where user_id = uid and account_id = p_account;
  delete from public.budget_lines where user_id = uid and target_key = 'a:' || p_account::text;

  update public.net_worth_snapshots set stale = true
  where user_id = uid and month >= to_char(acc.opening_date - interval '1 month', 'YYYY-MM');

  delete from public.accounts where user_id = uid and id = p_account;

  return jsonb_build_object('transactions', n_transactions, 'trades', n_trades, 'recurring_rules', n_rules);
end;
$$;

revoke execute on function public.delete_account_cascade(uuid) from public, anon;
grant execute on function public.delete_account_cascade(uuid) to authenticated;
