-- =============================================================================
-- Tài Chính Cá Nhân — schema cơ sở dữ liệu v1 (docs/03)
--
-- Chạy file này trong Supabase Dashboard → SQL Editor (hoặc `supabase db push`).
-- Nguyên tắc:
--   * Mọi bảng có user_id, mặc định = auth.uid(); RLS chỉ cho người dùng thấy dữ liệu của mình.
--   * Khóa chính (user_id, id) và khóa ngoại (user_id, x_id): không thể tham chiếu bản ghi của người khác,
--     và khôi phục file sao lưu sang tài khoản khác không bị trùng khóa.
--   * Zod ở client là lớp kiểm tra chính; CHECK/trigger ở đây là lớp chặn cuối cùng.
--   * Tiền: bigint (đồng). Lãi suất: numeric. Số lượng đầu tư: text thập phân (không mất chính xác).
-- =============================================================================

-- ---------- tiện ích chung ----------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =============================================================================
-- settings — 1 dòng / người dùng, tạo tự động khi đăng ký
-- =============================================================================
create table public.settings (
  user_id                  uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  currency                 text not null default 'VND' check (currency = 'VND'),
  locale                   text not null default 'vi-VN' check (locale = 'vi-VN'),
  period_start_day         smallint not null default 1 check (period_start_day between 1 and 28),
  default_budget_mode      text not null default 'zero_based' check (default_budget_mode in ('standard', 'zero_based')),
  include_accrued_interest boolean not null default true,
  allow_negative_rollover  boolean not null default true,
  alert_thresholds         jsonb not null default '[0.8, 1]'::jsonb check (jsonb_typeof(alert_thresholds) = 'array' and jsonb_array_length(alert_thresholds) = 2),
  emergency_target_months  smallint not null default 6 check (emergency_target_months between 1 and 24),
  theme                    text not null default 'system' check (theme in ('system', 'light', 'dark')),
  onboarding_completed     boolean not null default false,
  last_backup_at           timestamptz,
  schema_version           integer not null default 1 check (schema_version >= 1),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- =============================================================================
-- accounts — mọi thứ có số dư: tiền, quỹ, tiết kiệm, đầu tư, tài sản khác, nợ
-- =============================================================================
create table public.accounts (
  id                   uuid not null default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (user_id, id),
  name                 text not null check (char_length(btrim(name)) between 1 and 50),
  kind                 text not null check (kind in ('cash', 'bank', 'ewallet', 'goal_fund', 'term_deposit', 'investment',
                                                     'other_asset', 'loan', 'credit_card', 'bnpl', 'personal_debt')),
  class                text not null check (class in ('asset', 'liability')),
  currency             text not null default 'VND' check (currency = 'VND'),
  opening_balance      bigint not null check (opening_balance between 0 and 999999999999999),
  opening_date         date not null,
  is_liquid            boolean not null,
  include_in_net_worth boolean not null default true,
  is_emergency_fund    boolean not null default false,
  goal                 jsonb,
  archived_at          timestamptz,
  icon                 text,
  color                text,
  note                 text check (char_length(note) <= 500),
  sort_order           integer not null default 0,
  details              jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint accounts_class_matches_kind check (
    (class = 'asset') = (kind in ('cash', 'bank', 'ewallet', 'goal_fund', 'term_deposit', 'investment', 'other_asset'))
  ),
  -- Khoản nợ không thanh khoản, không phải quỹ khẩn cấp, không có mục tiêu tích lũy.
  constraint accounts_liability_flags check (class = 'asset' or (not is_liquid and not is_emergency_fund and goal is null)),
  -- Các loại cần cấu hình riêng phải có details.
  constraint accounts_details_required check (
    (kind in ('term_deposit', 'investment', 'loan', 'credit_card', 'bnpl', 'personal_debt')) = (details is not null)
  )
);

-- Tên duy nhất trong các tài khoản đang dùng (không phân biệt hoa thường).
create unique index accounts_active_name_key on public.accounts (user_id, lower(btrim(name))) where archived_at is null;
create index accounts_user_kind_idx on public.accounts (user_id, kind);

-- =============================================================================
-- categories — danh mục thu/chi 2 cấp
-- =============================================================================
create table public.categories (
  id          uuid not null default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (user_id, id),
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  type        text not null check (type in ('income', 'expense')),
  parent_id   uuid,
  bucket      text check (bucket in ('needs', 'wants', 'savings')),
  is_system   boolean not null default false,
  system_key  text check (system_key in ('loan_interest', 'prepayment_fee', 'bank_fee', 'investment_fee_tax',
                                         'savings_interest', 'investment_income')),
  archived_at timestamptz,
  icon        text,
  color       text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (user_id, parent_id) references public.categories (user_id, id),
  constraint categories_income_no_bucket check (type = 'expense' or bucket is null),
  constraint categories_not_self_parent check (parent_id is distinct from id),
  constraint categories_system_key_consistent check (is_system = (system_key is not null))
);

create unique index categories_system_key_key on public.categories (user_id, system_key) where system_key is not null;
create unique index categories_sibling_name_key on public.categories
  (user_id, type, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)))
  where archived_at is null;
create index categories_user_parent_idx on public.categories (user_id, parent_id);

-- Tối đa 2 cấp, cha cùng loại; danh mục hệ thống không đổi loại.
create or replace function public.categories_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent public.categories;
begin
  if new.parent_id is not null then
    select * into parent from public.categories where id = new.parent_id and user_id = new.user_id;
    if parent.parent_id is not null then
      raise exception 'Danh mục chỉ có tối đa 2 cấp' using errcode = 'P0001';
    end if;
    if parent.type <> new.type then
      raise exception 'Danh mục con phải cùng loại thu/chi với danh mục cha' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.is_system and (new.type <> old.type or new.system_key is distinct from old.system_key) then
    raise exception 'Không thể đổi loại của danh mục hệ thống' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger categories_validate before insert or update on public.categories
  for each row execute function public.categories_validate();

-- =============================================================================
-- recurring_rules — giao dịch định kỳ (tạo trước vì transactions tham chiếu tới)
-- =============================================================================
create table public.recurring_rules (
  id             uuid not null default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (user_id, id),
  name           text not null check (char_length(btrim(name)) between 1 and 60),
  template       jsonb not null,
  frequency      text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  interval_count smallint not null default 1 check (interval_count between 1 and 12),
  day_of_month   smallint check (day_of_month between 1 and 31),
  start_date     date not null,
  end_date       date,
  next_date      date not null,
  mode           text not null default 'confirm' check (mode in ('auto', 'confirm')),
  paused_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_date is null or end_date > start_date),
  check ((frequency = 'weekly') = (day_of_month is null))
);

create index recurring_rules_user_next_idx on public.recurring_rules (user_id, next_date);

-- =============================================================================
-- transactions — nguồn sự thật cho dòng tiền (docs/03 §3.5)
-- =============================================================================
create table public.transactions (
  id                uuid not null default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (user_id, id),
  type              text not null check (type in ('income', 'expense', 'refund', 'transfer', 'adjustment')),
  date              date not null,
  amount            bigint not null check (amount between 1 and 999999999999999),
  account_id        uuid not null,
  to_account_id     uuid,
  category_id       uuid,
  direction         text check (direction in ('up', 'down')),
  note              text check (char_length(note) <= 200),
  tags              text[] not null default '{}' check (cardinality(tags) <= 10),
  group_id          uuid,
  origin            text not null default 'manual' check (origin in ('manual', 'recurring', 'system')),
  recurring_rule_id uuid,
  idempotency_key   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (user_id, account_id) references public.accounts (user_id, id),
  foreign key (user_id, to_account_id) references public.accounts (user_id, id),
  foreign key (user_id, category_id) references public.categories (user_id, id),
  foreign key (user_id, recurring_rule_id) references public.recurring_rules (user_id, id) on delete set null (recurring_rule_id),
  -- Mỗi loại giao dịch có đúng các trường của nó.
  constraint transactions_shape check (
    case type
      when 'transfer'   then to_account_id is not null and to_account_id <> account_id and category_id is null and direction is null
      when 'adjustment' then direction is not null and category_id is null and to_account_id is null
      else category_id is not null and to_account_id is null and direction is null
    end
  ),
  -- Giao dịch do hệ thống sinh không bao giờ bị tạo trùng (W18).
  unique (user_id, idempotency_key)
);

create index transactions_user_date_idx     on public.transactions (user_id, date);
create index transactions_account_date_idx  on public.transactions (user_id, account_id, date);
create index transactions_to_account_idx    on public.transactions (user_id, to_account_id) where to_account_id is not null;
create index transactions_category_date_idx on public.transactions (user_id, category_id, date) where category_id is not null;
create index transactions_group_idx         on public.transactions (user_id, group_id) where group_id is not null;

-- Bất biến I2, I4 và "không ghi thu nhập vào khoản nợ" (docs/03 §4).
create or replace function public.transactions_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  src public.accounts;
  dst public.accounts;
  cat public.categories;
begin
  select * into src from public.accounts where id = new.account_id and user_id = new.user_id;
  if new.date < src.opening_date then
    raise exception 'Ngày giao dịch trước ngày bắt đầu theo dõi của tài khoản "%"', src.name using errcode = 'P0001';
  end if;
  if new.type = 'income' and src.class = 'liability' then
    raise exception 'Không thể ghi thu nhập vào khoản nợ' using errcode = 'P0001';
  end if;

  if new.to_account_id is not null then
    select * into dst from public.accounts where id = new.to_account_id and user_id = new.user_id;
    if new.date < dst.opening_date then
      raise exception 'Ngày giao dịch trước ngày bắt đầu theo dõi của tài khoản "%"', dst.name using errcode = 'P0001';
    end if;
  end if;

  if new.category_id is not null then
    select * into cat from public.categories where id = new.category_id and user_id = new.user_id;
    if cat.type <> (case when new.type = 'income' then 'income' else 'expense' end) then
      raise exception 'Danh mục "%" không đúng loại thu/chi của giao dịch', cat.name using errcode = 'P0001';
    end if;
    if exists (select 1 from public.categories c where c.user_id = new.user_id and c.parent_id = new.category_id) then
      raise exception 'Hãy chọn danh mục con thay vì nhóm "%"', cat.name using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger transactions_validate before insert or update on public.transactions
  for each row execute function public.transactions_validate();

-- =============================================================================
-- Đầu tư: holdings, investment_trades, price_quotes (docs/03 §3.6)
-- =============================================================================
create table public.holdings (
  id                uuid not null default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (user_id, id),
  account_id        uuid not null,
  symbol            text not null check (symbol ~ '^[A-Z0-9._-]{1,20}$'),
  name              text not null check (char_length(btrim(name)) between 1 and 80),
  asset_type        text not null check (asset_type in ('stock', 'fund', 'gold', 'crypto', 'bond', 'other')),
  unit              text not null check (char_length(btrim(unit)) between 1 and 20),
  quantity_decimals smallint not null default 0 check (quantity_decimals between 0 and 8),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, account_id, symbol),
  foreign key (user_id, account_id) references public.accounts (user_id, id)
);

create table public.investment_trades (
  id              uuid not null default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (user_id, id),
  holding_id      uuid not null,
  date            date not null,
  side            text not null check (side in ('buy', 'sell')),
  quantity        text not null check (quantity ~ '^\d+(\.\d+)?$' and quantity::numeric > 0),
  price           bigint not null check (price between 0 and 999999999999999),
  fee             bigint not null default 0 check (fee between 0 and 999999999999999),
  tax             bigint not null default 0 check (tax between 0 and 999999999999999),
  cash_account_id uuid not null,
  is_opening      boolean not null default false,
  group_id        uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (user_id, holding_id) references public.holdings (user_id, id),
  foreign key (user_id, cash_account_id) references public.accounts (user_id, id),
  check (not is_opening or side = 'buy')
);

create index investment_trades_holding_date_idx on public.investment_trades (user_id, holding_id, date);

create table public.price_quotes (
  id         uuid not null default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (user_id, id),
  symbol     text not null check (symbol ~ '^[A-Z0-9._-]{1,20}$'),
  date       date not null,
  price      bigint not null check (price between 0 and 999999999999999),
  created_at timestamptz not null default now(),
  unique (user_id, symbol, date)
);

-- =============================================================================
-- Sổ tiết kiệm & định giá tài sản khác (docs/03 §3.7, §3.8)
-- =============================================================================
create table public.deposit_terms (
  id            uuid not null default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (user_id, id),
  account_id    uuid not null,
  seq           integer not null check (seq >= 1),
  principal     bigint not null check (principal between 1 and 999999999999999),
  annual_rate   numeric(9, 6) not null check (annual_rate between 0 and 0.2),
  term_months   smallint not null check (term_months between 1 and 120),
  start_date    date not null,
  maturity_date date not null,
  status        text not null default 'active' check (status in ('active', 'matured', 'withdrawn_early')),
  interest_paid bigint not null default 0 check (interest_paid >= 0),
  closed_at     date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, account_id, seq),
  foreign key (user_id, account_id) references public.accounts (user_id, id),
  check (maturity_date > start_date),
  check ((status = 'active') = (closed_at is null))
);

create table public.asset_valuations (
  id         uuid not null default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (user_id, id),
  account_id uuid not null,
  date       date not null,
  value      bigint not null check (value between 0 and 999999999999999),
  note       text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  foreign key (user_id, account_id) references public.accounts (user_id, id)
);

create index asset_valuations_account_date_idx on public.asset_valuations (user_id, account_id, date);

-- =============================================================================
-- Ngân sách (docs/03 §3.9)
-- =============================================================================
create table public.budget_months (
  id              uuid not null default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (user_id, id),
  month           text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  mode            text not null check (mode in ('standard', 'zero_based')),
  expected_income bigint not null default 0 check (expected_income between 0 and 999999999999999),
  status          text not null default 'open' check (status in ('open', 'closed')),
  closed_at       timestamptz,
  note            text check (char_length(note) <= 500),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, month),
  check ((status = 'closed') = (closed_at is not null))
);

create table public.budget_lines (
  id         uuid not null default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (user_id, id),
  month      text not null,
  target     jsonb not null,
  target_key text not null,
  planned    bigint not null check (planned between 0 and 999999999999999),
  rollover   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, month) references public.budget_months (user_id, month) on delete cascade,
  unique (user_id, month, target_key),
  constraint budget_lines_target_key_matches check (
    target_key = case target ->> 'kind'
                   when 'category' then 'c:' || (target ->> 'categoryId')
                   when 'account'  then 'a:' || (target ->> 'accountId')
                 end
  )
);

-- =============================================================================
-- Snapshot net worth theo tháng — cache, luôn tính lại được (docs/03 §3.11)
-- =============================================================================
create table public.net_worth_snapshots (
  id                uuid not null default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (user_id, id),
  month             text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  as_of             date not null,
  total_assets      bigint not null check (total_assets >= 0),
  total_liabilities bigint not null check (total_liabilities >= 0),
  net_worth         bigint not null,
  liquid_assets     bigint not null check (liquid_assets >= 0),
  by_kind           jsonb not null default '{}'::jsonb,
  by_account        jsonb not null default '{}'::jsonb,
  computed_at       timestamptz not null default now(),
  stale             boolean not null default false,
  unique (user_id, month),
  check (net_worth = total_assets - total_liabilities)
);

-- =============================================================================
-- updated_at tự động
-- =============================================================================
do $$
declare
  t text;
begin
  foreach t in array array['settings', 'accounts', 'categories', 'recurring_rules', 'transactions', 'holdings',
                           'investment_trades', 'deposit_terms', 'budget_months', 'budget_lines']
  loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- =============================================================================
-- Row Level Security: mỗi người chỉ đọc/ghi dữ liệu của chính mình
-- =============================================================================
do $$
declare
  t text;
begin
  foreach t in array array['settings', 'accounts', 'categories', 'recurring_rules', 'transactions', 'holdings',
                           'investment_trades', 'price_quotes', 'deposit_terms', 'asset_valuations',
                           'budget_months', 'budget_lines', 'net_worth_snapshots']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows" on public.%I for all to authenticated
                    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

-- Dòng settings chỉ tạo bởi trigger đăng ký và không bị xóa từ client.
revoke insert, delete on public.settings from authenticated;

-- =============================================================================
-- Tạo settings mặc định khi có người dùng mới đăng ký
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- replace_all_data: khôi phục từ file sao lưu — xóa và ghi lại trong MỘT transaction.
-- Lỗi ở bất kỳ bước nào → rollback, dữ liệu hiện tại nguyên vẹn (docs/05 W17, E6, E14).
-- payload: { "<tên bảng>": [ { cột snake_case: giá trị } ] }, user_id luôn bị ghi đè = auth.uid().
-- =============================================================================
create or replace function public._rows_for_user(rows jsonb, uid uuid)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(e || jsonb_build_object('user_id', uid)), '[]'::jsonb)
  from jsonb_array_elements(coalesce(rows, '[]'::jsonb)) as e;
$$;

create or replace function public.replace_all_data(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s   public.settings;
begin
  if uid is null then
    raise exception 'Chưa đăng nhập' using errcode = '42501';
  end if;

  -- Xóa theo thứ tự con → cha.
  delete from public.net_worth_snapshots where user_id = uid;
  delete from public.budget_lines        where user_id = uid;
  delete from public.budget_months       where user_id = uid;
  delete from public.transactions        where user_id = uid;
  delete from public.recurring_rules     where user_id = uid;
  delete from public.investment_trades   where user_id = uid;
  delete from public.price_quotes        where user_id = uid;
  delete from public.holdings            where user_id = uid;
  delete from public.deposit_terms       where user_id = uid;
  delete from public.asset_valuations    where user_id = uid;
  delete from public.accounts            where user_id = uid;
  delete from public.categories          where user_id = uid;

  if jsonb_array_length(coalesce(payload -> 'settings', '[]'::jsonb)) > 0 then
    s := jsonb_populate_record(null::public.settings, (payload -> 'settings' -> 0) || jsonb_build_object('user_id', uid));
    update public.settings set
      period_start_day         = s.period_start_day,
      default_budget_mode      = s.default_budget_mode,
      include_accrued_interest = s.include_accrued_interest,
      allow_negative_rollover  = s.allow_negative_rollover,
      alert_thresholds         = s.alert_thresholds,
      emergency_target_months  = s.emergency_target_months,
      theme                    = s.theme,
      onboarding_completed     = s.onboarding_completed,
      last_backup_at           = s.last_backup_at
    where user_id = uid;
  end if;

  -- Ghi theo thứ tự cha → con.
  insert into public.categories          select * from jsonb_populate_recordset(null::public.categories,          public._rows_for_user(payload -> 'categories', uid));
  insert into public.accounts            select * from jsonb_populate_recordset(null::public.accounts,            public._rows_for_user(payload -> 'accounts', uid));
  insert into public.holdings            select * from jsonb_populate_recordset(null::public.holdings,            public._rows_for_user(payload -> 'holdings', uid));
  insert into public.investment_trades   select * from jsonb_populate_recordset(null::public.investment_trades,   public._rows_for_user(payload -> 'investment_trades', uid));
  insert into public.price_quotes        select * from jsonb_populate_recordset(null::public.price_quotes,        public._rows_for_user(payload -> 'price_quotes', uid));
  insert into public.deposit_terms       select * from jsonb_populate_recordset(null::public.deposit_terms,       public._rows_for_user(payload -> 'deposit_terms', uid));
  insert into public.asset_valuations    select * from jsonb_populate_recordset(null::public.asset_valuations,    public._rows_for_user(payload -> 'asset_valuations', uid));
  insert into public.recurring_rules     select * from jsonb_populate_recordset(null::public.recurring_rules,     public._rows_for_user(payload -> 'recurring_rules', uid));
  insert into public.transactions        select * from jsonb_populate_recordset(null::public.transactions,        public._rows_for_user(payload -> 'transactions', uid));
  insert into public.budget_months       select * from jsonb_populate_recordset(null::public.budget_months,       public._rows_for_user(payload -> 'budget_months', uid));
  insert into public.budget_lines        select * from jsonb_populate_recordset(null::public.budget_lines,        public._rows_for_user(payload -> 'budget_lines', uid));
  insert into public.net_worth_snapshots select * from jsonb_populate_recordset(null::public.net_worth_snapshots, public._rows_for_user(payload -> 'net_worth_snapshots', uid));
end;
$$;

revoke execute on function public.replace_all_data(jsonb) from public, anon;
grant execute on function public.replace_all_data(jsonb) to authenticated;
