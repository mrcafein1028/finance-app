# 03 — Mô hình dữ liệu

## 1. Ý tưởng chủ đạo

- **Mọi thứ có số dư đều là `Account`** — tiền mặt, ngân hàng, quỹ mục tiêu, sổ tiết kiệm, tài khoản đầu tư, tài sản khác, **và cả khoản nợ**. Mỗi account có `class = asset | liability`. Nhờ vậy:
  - Net worth chỉ là một phép cộng trên một bảng.
  - Mọi dịch chuyển tiền (nạp tiết kiệm, trả nợ, mua vàng) đều dùng chung một cơ chế **chuyển khoản**.
- **Giao dịch (`Transaction`) là nguồn sự thật** cho biến động số dư. Số dư không bao giờ được lưu, luôn tính = `số dư đầu kỳ + Σ ảnh hưởng giao dịch`.
- **Giá trị thị trường** (cổ phiếu, vàng, nhà) đến từ bảng giá/định giá có **ngày** → tái dựng được net worth tại bất kỳ ngày nào trong quá khứ.
- **Lưu trên Supabase Postgres** (`supabase/migrations/`): tên cột snake_case (`opening_balance`), code dùng camelCase (`openingBalance`), đổi tự động ở `data/mappers.ts`. Mọi bảng có thêm `user_id` (ẩn khỏi kiểu TS, RLS tự lọc).
- **Quy ước dấu:** `amount` luôn là số nguyên dương (đồng). Hướng tác động do `type` quyết định. Số dư của nợ = **số tiền đang nợ (dương)**.

## 2. Sơ đồ quan hệ

```
Settings (1)

Category ─┐ (parentId tự tham chiếu, 2 cấp)
          │
          ├──< Transaction >── Account ──< Holding ──< InvestmentTrade
          │         │             │           └── PriceQuote (theo symbol)
          │     groupId           ├──< AssetValuation
          │   (nhóm giao dịch)    ├──< DepositTerm      (sổ tiết kiệm)
          │                       └── details (theo kind)
          └──< BudgetLine >── BudgetMonth
                    └────────── Account (dòng ngân sách "tiết kiệm vào quỹ X")

RecurringRule ──> tạo Transaction
NetWorthSnapshot (cache theo tháng, tính lại được)
```

## 3. Thực thể chi tiết

### 3.1 `Settings` (1 bản ghi)
| Trường | Kiểu | Ghi chú |
|--------|------|---------|
| currency | `'VND'` | Chừa chỗ đa tiền tệ |
| locale | `'vi-VN'` | |
| periodStartDay | 1–28 | Ngày bắt đầu kỳ ngân sách (G5) |
| defaultBudgetMode | `'standard' \| 'zero_based'` | Mặc định `zero_based` (G6) |
| includeAccruedInterest | boolean | G4: net worth tính lãi dồn tích sổ tiết kiệm |
| alertThresholds | `[0.8, 1.0]` | Ngưỡng cảnh báo ngân sách |
| emergencyTargetMonths | number (mặc định 6) | |
| theme | `'system' \| 'light' \| 'dark'` | |
| onboardingCompleted | boolean | |
| schemaVersion | number | |

### 3.2 `Account`
| Trường | Kiểu | Ghi chú |
|--------|------|---------|
| id | string (ULID) | ULID sắp xếp được theo thời gian |
| name | string | Duy nhất trong các account chưa lưu trữ |
| class | `'asset' \| 'liability'` | Suy ra từ `kind`, lưu để index |
| kind | xem bảng dưới | |
| openingBalance | int ≥ 0 | Số dư/dư nợ tại `openingDate` |
| openingDate | date | Giao dịch trước ngày này bị từ chối |
| isLiquid | boolean | Mặc định theo kind; dùng cho "quỹ khẩn cấp" và "tài sản thanh khoản" |
| includeInNetWorth | boolean | Mặc định true |
| isEmergencyFund | boolean | Đánh dấu account thuộc quỹ khẩn cấp |
| goal | `{ targetAmount, targetDate? } \| null` | Mục tiêu tích lũy — gắn được vào mọi account tài sản |
| archivedAt | datetime \| null | Lưu trữ thay vì xóa |
| icon, color, note, sortOrder | | |
| details | union theo `kind` | Xem 3.3 |
| createdAt, updatedAt | datetime | |

**Bảng `kind`:**

| kind | class | Tên hiển thị | isLiquid mặc định | Nguồn giá trị |
|------|-------|--------------|-------------------|---------------|
| `cash` | asset | Tiền mặt | ✔ | giao dịch |
| `bank` | asset | Tài khoản ngân hàng | ✔ | giao dịch |
| `ewallet` | asset | Ví điện tử | ✔ | giao dịch |
| `goal_fund` | asset | Quỹ mục tiêu | ✔ | giao dịch |
| `term_deposit` | asset | Tiết kiệm có kỳ hạn | ✘ (rút trước hạn mất lãi) | giao dịch (gốc) + lãi dồn tích |
| `investment` | asset | Tài khoản đầu tư | ✘ | tiền mặt trong TK + Σ holdings × giá |
| `other_asset` | asset | Tài sản khác (nhà, xe) | ✘ | định giá gần nhất |
| `loan` | liability | Khoản vay (nhà, xe, tiêu dùng) | – | giao dịch |
| `credit_card` | liability | Thẻ tín dụng | – | giao dịch |
| `bnpl` | liability | Trả góp / mua trước trả sau | – | giao dịch |
| `personal_debt` | liability | Vay người thân | – | giao dịch |

### 3.3 `Account.details` theo kind

**`term_deposit`** — thông tin kỳ hiện tại nằm ở `DepositTerm` (3.7); details chỉ chứa cấu hình:
```ts
{ bankName: string;
  interestPayout: 'at_maturity' | 'monthly' | 'upfront';
  maturityAction: 'renew_principal' | 'renew_with_interest' | 'withdraw';
  payoutAccountId: string;         // TK nhận lãi / nhận tiền khi tất toán
  earlyWithdrawalRate: number;     // lãi không kỳ hạn, VD 0.001 = 0,1%/năm
  dayCountBasis: 365 }
```

**`investment`**
```ts
{ platform?: string;               // SSI, VNDirect, Fmarket, tiệm vàng...
  costMethod: 'average' }          // MVP chỉ hỗ trợ giá vốn bình quân
```

**`loan` / `bnpl` / `personal_debt`**
```ts
{ lender?: string;
  originalPrincipal: number;       // số tiền vay ban đầu
  rateType: 'equal_principal'      // gốc đều, lãi trên dư nợ giảm dần (phổ biến vay nhà/xe VN)
          | 'annuity'              // trả đều mỗi tháng (niên kim)
          | 'flat'                 // lãi phẳng trên gốc ban đầu (vay tiêu dùng)
          | 'zero';                // không lãi (vay người thân, trả góp 0%)
  ratePeriods: { from: date; annualRate: number }[];  // hỗ trợ lãi ưu đãi → thả nổi
  termMonths: number;
  startDate: date;                 // ngày giải ngân
  paymentDay: 1..28;
  prepaymentFeeRate?: number;      // phí trả trước hạn
  interestCategoryId: string }     // mặc định "Lãi vay"
```

**`credit_card`**
```ts
{ issuer?: string; creditLimit: number;
  statementDay: 1..28; dueDay: 1..28;
  annualRate: number; minPaymentRate: number }  // VD 0.05 = 5% dư nợ
```

### 3.4 `Category`
| Trường | Kiểu | Ghi chú |
|--------|------|---------|
| id, name | | Tên duy nhất trong cùng cha |
| type | `'income' \| 'expense'` | |
| parentId | string \| null | Tối đa 2 cấp; giao dịch chỉ gắn vào **danh mục lá** |
| bucket | `'needs' \| 'wants' \| 'savings'` \| null | Chỉ với expense; con kế thừa của cha nếu không đặt |
| isSystem | boolean | Không xóa/đổi type được: *Lãi vay, Phí trả nợ trước hạn, Phí ngân hàng, Phí & thuế đầu tư, Lãi tiết kiệm, Cổ tức & lãi đầu tư* |
| archivedAt, icon, color, sortOrder | | |

### 3.5 `Transaction`
| Trường | Kiểu | Ghi chú |
|--------|------|---------|
| id | ULID | |
| type | `'income' \| 'expense' \| 'refund' \| 'transfer' \| 'adjustment'` | |
| date | `YYYY-MM-DD` | Không có giờ → tránh lỗi múi giờ |
| amount | int > 0 | |
| accountId | string | income/refund: TK nhận; expense: TK chi; transfer: TK **nguồn**; adjustment: TK điều chỉnh |
| toAccountId | string \| null | Chỉ transfer; ≠ accountId |
| categoryId | string \| null | Bắt buộc với income/expense/refund (danh mục lá đúng type) |
| direction | `'up' \| 'down'` \| null | Chỉ adjustment |
| groupId | string \| null | Nối các giao dịch sinh ra từ 1 nghiệp vụ (trả nợ gốc + lãi, mua đầu tư + phí) |
| origin | `'manual' \| 'recurring' \| 'system'` | system = do dịch vụ sinh (đáo hạn, trả nợ) |
| recurringRuleId | string \| null | |
| idempotencyKey | string \| null | Unique. Giao dịch do hệ thống sinh (VD `recurring:<ruleId>:<date>`) → không bao giờ tạo trùng |
| note, tags[] | | |
| createdAt, updatedAt | | |

**Ma trận ảnh hưởng số dư** (`+` = số dư account tăng; với nợ, số dư = dư nợ):

| type | accountId là asset | accountId là liability | toAccountId là asset | toAccountId là liability |
|------|--------------------|------------------------|----------------------|--------------------------|
| income | +amount | ✘ không cho phép | – | – |
| expense | −amount | +amount (quẹt thẻ → nợ tăng) | – | – |
| refund | +amount | −amount | – | – |
| transfer | −amount | +amount (giải ngân/rút tiền mặt) | +amount | −amount (trả nợ) |
| adjustment | ±amount theo direction | ±amount | – | – |

**Ảnh hưởng ngân sách:** chỉ `income`, `expense`, `refund` (refund trừ vào thực chi của danh mục). `transfer` và `adjustment` **không** là thu/chi — riêng transfer từ TK thanh khoản vào account có dòng ngân sách tiết kiệm sẽ được tính là "đã tiết kiệm".

### 3.6 `Holding`, `InvestmentTrade`, `PriceQuote` (đầu tư)
```ts
Holding        { id; accountId; symbol; name; assetType: 'stock'|'fund'|'gold'|'crypto'|'bond'|'other';
                 unit: string /* cổ phiếu, CCQ, chỉ, lượng, BTC */; quantityDecimals: number }
InvestmentTrade{ id; holdingId; date; side: 'buy'|'sell'; quantity: string /* thập phân dạng chuỗi */;
                 price: number /* đồng/đơn vị */; fee: number; tax: number;
                 cashAccountId: string /* TK tiền dùng thanh toán, mặc định chính TK đầu tư */;
                 isOpening: boolean /* vị thế có sẵn khi bắt đầu dùng app: không trừ tiền mặt */;
                 groupId }
PriceQuote     { id; symbol; date; price }   // unique (symbol, date)
```
- `quantity` lưu dạng chuỗi thập phân (vàng 0,5 chỉ; BTC 0,00125) và tính bằng thư viện decimal; **kết quả tiền luôn làm tròn về đồng**.
- Giá trị TK đầu tư = **tiền mặt trong TK** + Σ (số lượng × giá). Trade chỉ hoán đổi tiền mặt ↔ chứng khoán **bên trong** TK (mua: tiền mặt −qty×price; bán: +qty×price), nên tự nó không làm đổi net worth.
- Nếu `cashAccountId` là TK khác (VD mua vàng bằng tiền từ ngân hàng) → service tạo kèm `transfer` ngân hàng → TK đầu tư cùng `groupId`.
- Phí + thuế → `expense` danh mục hệ thống "Phí & thuế đầu tư", cùng `groupId`. Chi tiết ở `04 §7`.

### 3.7 `DepositTerm` (các kỳ của sổ tiết kiệm)
```ts
{ id; accountId; seq: number; principal: number; annualRate: number;
  termMonths: number; startDate; maturityDate;
  status: 'active' | 'matured' | 'withdrawn_early';
  interestPaid: number /* thực nhận */; closedAt?: date }
```
Mỗi lần tái tục tạo `seq` mới → giữ được lịch sử lãi suất.

### 3.8 `AssetValuation`
`{ id; accountId; date; value }` — cho `other_asset` (nhà, xe). Giá trị tại ngày D = bản ghi gần nhất có `date ≤ D`, nếu không có thì `openingBalance`.

### 3.9 `BudgetMonth` & `BudgetLine`
```ts
BudgetMonth { id: 'YYYY-MM'; mode: 'standard'|'zero_based'; expectedIncome: number;
              status: 'open'|'closed'; closedAt?; note? }
BudgetLine  { id; month: 'YYYY-MM';
              target: { kind: 'category'; categoryId } | { kind: 'account'; accountId };
              planned: number; rollover: boolean }
```
- `target.kind = 'category'` → dòng chi tiêu (chỉ danh mục expense; có thể đặt ở danh mục cha để gom các con).
- `target.kind = 'account'` → dòng tiết kiệm/trả nợ thêm (VD "Quỹ khẩn cấp 3 tr", "Trả trước vay mua xe 2 tr").
- Unique `(month, target)`. Không đặt ngân sách đồng thời cho cha và con của nó.

### 3.10 `RecurringRule`
```ts
{ id; name; template: Omit<Transaction, 'id'|'date'|'createdAt'|'updatedAt'>;
  frequency: 'monthly'|'weekly'|'yearly'; interval: number; dayOfMonth?: 1..31 /* 31 = cuối tháng */;
  startDate; endDate?; nextDate; mode: 'auto' | 'confirm'; pausedAt? }
```

### 3.11 `NetWorthSnapshot` (cache)
```ts
{ id: 'YYYY-MM'; asOf: date /* ngày cuối kỳ */; totalAssets; totalLiabilities; netWorth;
  liquidAssets; byKind: Record<kind, number>; byAccount: Record<accountId, number>;
  computedAt; stale: boolean }
```
Vì mọi giá trị đều tái dựng được, snapshot chỉ là cache: bất kỳ thay đổi nào có `date ≤ asOf` sẽ đánh dấu `stale = true` các snapshot từ tháng đó trở đi và tính lại ở lần đọc kế tiếp.

## 4. Bất biến (invariants) — kiểm tra ở tầng service, có test

| # | Bất biến |
|---|----------|
| I1 | `amount > 0` và là số nguyên với mọi giao dịch, trade, dòng ngân sách (`planned ≥ 0`). |
| I2 | `transaction.date ≥ account.openingDate` của mọi account liên quan. |
| I3 | Transfer: `accountId ≠ toAccountId`; cả hai chưa lưu trữ tại thời điểm tạo. |
| I4 | income/expense/refund có `categoryId` là **danh mục lá**, đúng `type` (refund dùng danh mục expense). |
| I5 | Không bán quá số lượng đang nắm giữ tại ngày bán. |
| I6 | Dư nợ không âm: một giao dịch làm dư nợ < 0 bị từ chối (trả thừa → gợi ý tách phần thừa). |
| I7 | TK tiền (`cash`) không được âm; TK ngân hàng/ví âm → cho phép nhưng cảnh báo (thấu chi). |
| I8 | Các giao dịch cùng `groupId` được tạo/sửa/xóa **cùng nhau** trong một DB transaction. |
| I9 | Xóa danh mục/account đang được tham chiếu → bắt buộc chọn: *chuyển sang X* hoặc *lưu trữ*. Không xóa cứng account có giao dịch. |
| I10 | Tháng `closed` không cho sửa ngân sách; sửa giao dịch trong tháng đã đóng phải xác nhận và tự mở lại snapshot. |

## 5. Lưu trữ trên Postgres

File nguồn: `supabase/migrations/20260924000001_init.sql`. Tóm tắt:

| Khía cạnh | Cách làm |
|-----------|----------|
| Khóa chính | `(user_id, id)`, `id` là uuid. `settings` có khóa là `user_id` |
| Khóa tự nhiên | `budget_months (user_id, month)`, `net_worth_snapshots (user_id, month)` là unique |
| Kiểu dữ liệu | Tiền `bigint`; lãi suất `numeric`; số lượng đầu tư `text` thập phân; ngày `date`; thời điểm `timestamptz`; `details/target/template/goal/by_kind` là `jsonb` |
| Unique quan trọng | tên tài khoản đang dùng (không phân biệt hoa thường); `(user_id, idempotency_key)`; `(user_id, symbol, date)` giá; `(user_id, month, target_key)` dòng ngân sách; danh mục hệ thống |
| CHECK | class ↔ kind; hình dạng giao dịch theo type; tiền trong khoảng; `net_worth = assets − liabilities`; `target_key` khớp `target` |
| Trigger | `transactions_validate` (I2, I4, không ghi thu vào nợ); `categories_validate` (2 cấp, cùng loại); `set_updated_at`; `handle_new_user` (tạo settings khi đăng ký) |
| Khóa ngoại | Mặc định NO ACTION → xóa bản ghi đang được tham chiếu bị chặn (I9) |
| Index | `(user_id, date)`, `(user_id, account_id, date)`, `(user_id, category_id, date)`, `(user_id, group_id)`, … |
| Hàm RPC | `replace_all_data(payload)` — khôi phục sao lưu trong 1 transaction |

Đổi schema về sau: **thêm file migration mới** (`…0003_….sql`), không sửa file đã chạy; tăng `CURRENT_SCHEMA_VERSION` trong `src/schemas/backup.ts` nếu định dạng sao lưu thay đổi.

## 6. File sao lưu

```json
{ "app": "tai-chinh-ca-nhan", "schemaVersion": 1, "exportedAt": "2026-09-23T10:00:00Z",
  "data": { "settings": [...], "accounts": [...], "categories": [...], "transactions": [...], "...": [] } }
```
Import: validate toàn bộ bằng Zod → hiển thị tóm tắt (số account, giao dịch, khoảng ngày) → người dùng chọn **Thay thế toàn bộ** (tự lưu bản sao lưu hiện tại lên Storage trước) hoặc **Hủy** → hàm SQL `replace_all_data` xóa và ghi lại trong **một transaction** (Postgres kiểm tra lại mọi ràng buộc; lỗi → rollback). Khôi phục sang tài khoản khác được. Không hỗ trợ "gộp" ở MVP để tránh trùng lặp.
