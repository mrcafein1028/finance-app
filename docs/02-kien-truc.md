# 02 — Kiến trúc & cấu trúc thư mục

## 1. Lựa chọn công nghệ

| Lớp | Lựa chọn | Lý do |
|-----|----------|-------|
| Ngôn ngữ | **TypeScript (strict)** | Kiểu dữ liệu chặt cho tiền, enum loại tài khoản, tránh lỗi logic |
| UI framework | **React 19 + Vite 8** | Hệ sinh thái lớn, build nhanh, SPA thuần không cần server |
| Routing | React Router | Các trang: Dashboard, Ngân sách, Giao dịch, Tài sản, Nợ, Báo cáo, Cài đặt |
| Cơ sở dữ liệu | **Supabase Postgres** + Row Level Security | Dữ liệu theo tài khoản, đồng bộ mọi thiết bị; ràng buộc & trigger ở DB là lớp chặn cuối |
| Đăng nhập | **Supabase Auth** (email + mật khẩu) | Xác nhận email, quên mật khẩu có sẵn |
| Lưu file | **Supabase Storage** (bucket riêng tư `user-files`) | File sao lưu, ảnh hóa đơn; mỗi người một thư mục |
| Lấy dữ liệu | **TanStack Query** | Cache, tự làm mới khi quay lại tab, invalidate sau khi ghi |
| Hosting | **Vercel** (free tier) | Tự build từ GitHub, HTTPS, CDN |
| State UI | Zustand (chỉ state tạm: bộ lọc, modal) | Dữ liệu nghiệp vụ lấy thẳng từ DB, không nhân bản vào store |
| Form | React Hook Form + **Zod** | Một schema Zod dùng chung cho validate form, validate file import, và kiểu TS |
| Biểu đồ | **Recharts** (+ ECharts nếu cần Sankey) | Đủ line/area/bar/pie/composed, tùy biến tốt |
| Ngày tháng | date-fns (locale `vi`) | Nhẹ, thuần hàm |
| Style | Tailwind CSS + các component tự viết | Nhanh, nhất quán, dễ làm dark mode |
| Test đơn vị | **Vitest** | Test toàn bộ tầng `domain/` |
| Test cơ sở dữ liệu | **PGlite** (Postgres 17 nhúng) | Chạy migration SQL thật: ràng buộc, trigger, RLS, khôi phục — không cần Docker/Supabase |
| Test E2E / mô phỏng người dùng | **Playwright** | Chạy kịch bản như người thật trên trình duyệt (xem `08`) |

## 2. Phân tầng

```
┌──────────────────────────────────────────────────────────┐
│  UI (features/*, components/*)                           │
│  - Trang, form, biểu đồ. KHÔNG chứa công thức tính toán. │
└───────────────┬──────────────────────────────────────────┘
                │ gọi hooks
┌───────────────▼──────────────────────────────────────────┐
│  Application / Hooks (features/*/hooks, services/)       │
│  - useBudgetMonth(), useNetWorth(), recordDebtPayment()  │
│  - Điều phối: đọc repo → gọi domain → ghi repo           │
│  - Ghi nhiều bảng = 1 hàm SQL (RPC) = 1 transaction      │
└───────┬────────────────────────────────┬─────────────────┘
        │                                │
┌───────▼──────────────┐     ┌───────────▼─────────────────┐
│  Domain (pure)       │     │  Data (repositories)        │
│  money, budget,      │     │  supabase.ts, mappers.ts    │
│  balance, networth,  │     │  accountsRepo, txRepo, ...  │
│  loan, savings,      │     │  backup (export/import)     │
│  investment,insights │     │                             │
│  → 0 phụ thuộc React │     │                             │
│    hay Supabase      │     │  (camel ↔ snake_case)       │
└──────────────────────┘     └─────────────────────────────┘
```

**Quy tắc phụ thuộc:** `UI → Application → (Domain, Data)`; `Data → Domain (chỉ types)`; `Domain` không phụ thuộc ai. Điều này đảm bảo mọi con số hiển thị đều đi qua hàm thuần đã được test.

## 3. Luồng dữ liệu điển hình

**Ghi nhận khoản chi 150.000 ₫ ăn trưa:**
1. Form `TransactionForm` validate bằng `transactionSchema` (Zod).
2. `repos.transactions.create()` validate lại bằng Zod → gửi lên Supabase (PostgREST). Postgres kiểm tra lần nữa (CHECK, trigger, RLS). Nghiệp vụ nhiều bước (trả nợ = gốc + lãi) gọi **hàm SQL (RPC)** để ghi trong một transaction.
3. TanStack Query invalidate các truy vấn liên quan → hooks tính lại:
   - `domain/balance.accountBalance()` → số dư ví giảm.
   - `domain/budget.monthSummary()` → danh mục "Ăn uống" còn lại giảm, kiểm tra ngưỡng 80/100%.
   - `domain/networth.compute()` → net worth giảm 150.000.
4. UI cập nhật; nếu vượt ngưỡng → toast cảnh báo.

**Hai lớp kiểm tra:** Zod ở trình duyệt (báo lỗi ngay dưới ô nhập) và ràng buộc Postgres (không ai ghi được dữ liệu sai, kể cả khi gọi API trực tiếp). Lỗi DB được đổi sang tiếng Việt tại `data/errors.ts`.

**Không lưu số liệu dẫn xuất** (số dư, tổng chi…) vào DB, trừ `netWorthSnapshots` (lưu có chủ đích để giữ lịch sử và tăng tốc biểu đồ).

## 4. Cây thư mục dự kiến

```
tai-chinh-ca-nhan/
├── README.md
├── docs/                       # Bộ tài liệu phân tích (hiện tại)
├── public/
├── src/
│   ├── main.tsx
│   ├── App.tsx                 # Router + layout
│   ├── app/routes.ts           # Sơ đồ trang (1 nguồn cho router + menu)
│   ├── domain/                 # ★ LÕI – hàm thuần, test 100%
│   │   ├── types.ts            # Kiểu thực thể (suy ra từ Zod schema)
│   │   ├── money.ts            # Money = số nguyên đồng; cộng, chia tỉ lệ không lệch
│   │   ├── dates.ts            # Ngày YYYY-MM-DD tính bằng UTC, cộng tháng kẹp cuối tháng
│   │   ├── errors.ts           # DomainError (VD bán quá số lượng)
│   │   ├── period.ts           # Kỳ ngân sách (YYYY-MM, ngày bắt đầu kỳ)
│   │   ├── balance.ts          # Số dư tài khoản tại ngày bất kỳ
│   │   ├── budget.ts           # Kế hoạch vs thực tế, rollover, chưa phân bổ
│   │   ├── savings.ts          # Lãi tiết kiệm, đáo hạn, rút trước hạn
│   │   ├── loan.ts             # Lịch trả nợ, tách gốc/lãi, trả trước
│   │   ├── investment.ts       # Giá vốn bình quân, lãi/lỗ
│   │   ├── networth.ts         # Tổng tài sản, nợ, net worth, phân rã biến động
│   │   ├── insights.ts         # Chỉ số sức khỏe + sinh câu insight
│   │   └── *.test.ts           # Test đặt cạnh file nguồn
│   ├── schemas/                # Zod schemas (form + import + types)
│   ├── data/
│   │   ├── supabase.ts         # Client Supabase (đọc biến môi trường)
│   │   ├── mappers.ts          # camelCase ↔ snake_case
│   │   ├── errors.ts           # ValidationError / NotFoundError / ConflictError
│   │   ├── repositories/       # CRUD từng bảng
│   │   ├── seed/               # Danh mục mẫu, dữ liệu demo
│   │   └── backup.ts           # Export/Import JSON, CSV
│   ├── services/               # Nghiệp vụ nhiều bước (trả nợ, đáo hạn, đóng tháng)
│   ├── features/
│   │   ├── auth/               # Đăng nhập, đăng ký, quên/đặt lại mật khẩu
│   │   ├── onboarding/
│   │   ├── dashboard/
│   │   ├── budget/
│   │   ├── transactions/
│   │   ├── accounts/           # Tiền mặt, ngân hàng, ví, quỹ mục tiêu
│   │   ├── savings/            # Sổ tiết kiệm
│   │   ├── investments/
│   │   ├── liabilities/
│   │   ├── reports/
│   │   └── settings/
│   ├── components/
│   │   ├── ui/                 # Button, Modal, MoneyInput, DatePicker...
│   │   ├── charts/             # Wrapper biểu đồ dùng chung
│   │   └── layout/
│   ├── lib/                    # format (tiền, ngày), id, clock, theme
│   └── test/factories.ts       # Bản ghi hợp lệ mẫu cho test
├── supabase/migrations/        # SQL: bảng, ràng buộc, trigger, RLS, storage
├── tests/
│   ├── db/                     # Test SQL trên PGlite
│   ├── e2e/                    # Playwright – kịch bản persona
│   └── fixtures/               # Bộ dữ liệu mẫu có số liệu kỳ vọng
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vercel.json
├── .env.example
└── playwright.config.ts
```

## 5. Điều hướng (sitemap)

```
/                    Dashboard (net worth, ngân sách tháng này, cảnh báo, insight)
/budget/:month       Ngân sách tháng (mặc định tháng hiện tại)
/transactions        Danh sách giao dịch + bộ lọc
/accounts            Tài khoản tiền + quỹ mục tiêu
/accounts/:id        Chi tiết tài khoản (lịch sử số dư, giao dịch)
/savings             Sổ tiết kiệm   /savings/:id
/investments         Danh mục đầu tư /investments/:id
/liabilities         Khoản nợ       /liabilities/:id (lịch trả nợ)
/reports             Báo cáo: dòng tiền, xu hướng chi tiêu, net worth
/what-if             Mô phỏng what-if: dự phóng net worth, so sánh kịch bản
/settings            Cài đặt, danh mục, sao lưu/khôi phục, xóa dữ liệu
/onboarding          Chỉ hiện khi chưa có dữ liệu
/login /signup       Công khai; đã đăng nhập thì chuyển vào app
/forgot-password     Gửi email đặt lại mật khẩu
/reset-password      Mở từ link trong email, đặt mật khẩu mới
```

Nút **"+" nổi** (mọi trang) → mở nhanh form giao dịch — thao tác phổ biến nhất phải ≤ 3 chạm.

## 6. Bảo mật

| Lớp | Cơ chế |
|-----|--------|
| Xác thực | Supabase Auth; phiên lưu ở trình duyệt, tự làm mới token |
| Phân quyền dữ liệu | RLS trên cả 13 bảng: `user_id = auth.uid()`; vai trò `anon` bị thu hồi mọi quyền |
| Tham chiếu chéo | Khóa chính `(user_id, id)` và khóa ngoại `(user_id, x_id)`: không thể trỏ tới bản ghi của người khác |
| Khóa API | Trình duyệt chỉ có **publishable/anon key**; `service_role` không bao giờ nằm trong mã nguồn hay Vercel |
| File | Bucket `user-files` riêng tư, policy theo thư mục `<user_id>/` |
| Kiểm chứng | `tests/db` chạy RLS thật: người B không đọc/sửa/xóa/tham chiếu được dữ liệu người A |
