# 10 — Triển khai: GitHub → Supabase → Vercel

Làm một lần duy nhất, khoảng 20–30 phút. Cả ba dịch vụ đều dùng gói **miễn phí**.

```
Máy bạn (thư mục current/)
   │ kéo thả lên
   ▼
GitHub (lưu mã nguồn)  ──── Vercel tự build mỗi lần GitHub thay đổi ────►  Vercel (web chạy thật: https://<tên>.vercel.app)
                                                                              │ gọi API bằng publishable key
                                                                              ▼
                                                               Supabase (Postgres + Đăng nhập + Lưu file)
```

## Bước 1 — Đưa mã nguồn lên GitHub

1. Đăng nhập github.com → **New repository** → đặt tên (VD `tai-chinh-ca-nhan`) → chọn **Private** → **Create repository** (không tick thêm README).
2. Trên trang repo mới, bấm **uploading an existing file**.
3. Mở thư mục `current/` trên máy, **chọn tất cả những gì bên trong** (Ctrl+A) rồi kéo thả vào trình duyệt.
   - Kéo *nội dung bên trong* `current/`, không kéo cả thư mục `current` — để `package.json` nằm ngay gốc repo.
   - Nếu Windows ẩn file bắt đầu bằng dấu chấm (`.gitignore`, `.env.example`): trong File Explorer bật **View → Show → Hidden items**.
4. Ghi chú commit (VD "Giai đoạn 1") → **Commit changes**.

> GitHub web cho tải tối đa **100 file mỗi lần**; `current/` hiện có **~195 file**, nên tải thành **3 đợt**:
>
> | Đợt | Đứng ở đâu trên GitHub | Kéo thả gì (từ máy) | Số file |
> |-----|------------------------|---------------------|---------|
> | A | Trang gốc repo → **Add file → Upload files** | Mọi thứ trong `current/` **trừ** thư mục `src` (các file lẻ + `docs`, `public`, `supabase`, `tests`) | ~55 |
> | B | Mở thư mục **`src`** trên GitHub → **Add file → Upload files** | Hai thư mục `src/domain` và `src/features` | ~76 |
> | C | Vẫn trong **`src`** trên GitHub → **Add file → Upload files** | Mọi thứ còn lại trong `src/` (`app`, `components`, `data`, `lib`, `schemas`, `services`, `test`, `App.tsx`, `index.css`, `main.tsx`, `vite-env.d.ts`) | ~66 |
>
> ⚠️ Đợt B, C phải **đứng trong thư mục `src` trên GitHub** trước khi kéo thả, nếu không file sẽ rơi ra gốc repo (VD `domain/` thay vì `src/domain/`). Repo mới tinh chưa có `src`? Làm đợt C trước theo cách: ở gốc repo **Add file → Create new file**, gõ tên `src/.keep`, Commit → giờ đã có thư mục `src` để vào.
>
> Dễ hơn: dùng **GitHub Desktop** (desktop.github.com) — kéo cả thư mục, không giới hạn số file, tự bỏ qua file trong `.gitignore`.

**Cập nhật về sau:** mỗi khi có phiên bản mới trong `current/`, lặp lại bước 2–4. File cùng tên sẽ được ghi đè. File đã **bị xóa** trong `current/` phải tự xóa trên GitHub (mở file → biểu tượng thùng rác). Mỗi bản giao, Claude sẽ liệt kê các file cần xóa, nếu có.

## Bước 2 — Tạo cơ sở dữ liệu trên Supabase

1. Đăng nhập supabase.com → **New project** → đặt tên, tạo mật khẩu DB (lưu lại), Region **Southeast Asia (Singapore)** cho nhanh nhất từ Việt Nam.
2. Chờ project khởi tạo xong (~2 phút) → menu trái **SQL Editor** → **New query**.
3. Mở file `supabase/migrations/20260924000001_init.sql`, copy **toàn bộ** nội dung → dán → **Run**. Kết quả phải là "Success. No rows returned".
4. Làm tương tự, **đúng thứ tự**, với từng file còn lại:
   - `20260924000002_storage.sql` — bucket lưu file
   - `20260925000003_transaction_groups.sql` — ghi/xóa nhóm giao dịch trong một lần (Giai đoạn 3)
   - `20260926000004_merge_category.sql` — gộp danh mục (Giai đoạn 7)
5. Kiểm tra: menu **Table Editor** thấy 13 bảng (accounts, transactions, …), mỗi bảng có nhãn **RLS enabled**.

> Các file migration phải chạy **đúng thứ tự tên file** và **mỗi file chỉ một lần**. Đã chạy 0001–0003 từ trước? Chỉ cần chạy thêm `…0004_merge_category.sql`. Chạy nhầm lần hai file 0001/0002 sẽ báo lỗi "already exists" — không hỏng gì, bỏ qua. File 0003, 0004 chạy lại an toàn (`create or replace`).

### Cấu hình đăng nhập (Authentication)
1. **Authentication → Sign In / Providers → Email**: bật *Email*, giữ *Confirm email* **bật** (người dùng phải xác nhận email).
2. **Authentication → URL Configuration** (làm sau khi có địa chỉ Vercel ở Bước 3):
   - **Site URL**: `https://<tên-app>.vercel.app`
   - **Redirect URLs** thêm: `https://<tên-app>.vercel.app/**` và `http://localhost:5173/**`
3. (Khuyến nghị) **Authentication → Emails → SMTP Settings**: email mặc định của Supabase chỉ gửi được vài thư mỗi giờ, đủ để thử nghiệm. Khi có người dùng thật, hãy kết nối SMTP riêng (VD Resend, Brevo — đều có gói miễn phí).

### Lấy khóa kết nối
**Project Settings → API Keys** (hoặc nút **Connect** ở đầu trang):
- **Project URL**: `https://xxxx.supabase.co`
- **Publishable key** (`sb_publishable_…`), hoặc **anon key** nếu project cũ.

> ⚠️ Chỉ dùng publishable/anon key cho web. **Tuyệt đối không** đưa `service_role`/secret key vào Vercel hay mã nguồn: khóa đó bỏ qua mọi bảo mật RLS.

## Bước 3 — Deploy lên Vercel

1. Đăng nhập vercel.com bằng tài khoản GitHub → **Add New… → Project** → chọn repo vừa tạo → **Import**.
2. Vercel tự nhận ra **Vite**: build command `npm run build`, output `dist`. Không cần sửa gì.
3. Mở **Environment Variables**, thêm 2 biến:
   | Name | Value |
   |------|-------|
   | `VITE_SUPABASE_URL` | Project URL ở Bước 2 |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable (hoặc anon) key |
4. **Deploy** → chờ ~1 phút → nhận địa chỉ `https://<tên-app>.vercel.app`.
5. Quay lại Supabase → **URL Configuration** (Bước 2) điền địa chỉ này.

Từ nay mỗi lần bạn tải file mới lên GitHub, Vercel **tự build và cập nhật** web sau khoảng 1 phút. Nếu build lỗi, web cũ vẫn chạy bình thường; xem lỗi ở **Vercel → Deployments**.

## Bước 4 — Kiểm tra sau khi deploy

1. Mở web → phải thấy trang **Đăng nhập**. Nếu thấy "Chưa cấu hình kết nối Supabase" → biến môi trường sai tên hoặc thiếu → sửa trong Vercel rồi **Redeploy**.
2. **Đăng ký** bằng email thật → mở thư xác nhận → bấm link → được đưa vào app.
3. Supabase → **Table Editor → settings**: có 1 dòng mới với `default_budget_mode = zero_based`.
4. Thử **Quên mật khẩu** → thư đến → link mở trang **Đặt mật khẩu mới**.
5. Ở bước đầu của hướng dẫn bắt đầu bấm **Xem dữ liệu demo** → thấy Tổng quan có số liệu, Báo cáo có biểu đồ.
6. **Cài đặt → Nạp dữ liệu demo…** chọn *Hùng* → Supabase **Storage → user-files → <id của bạn>/backups/** có 1 file sao lưu tự động (chứng tỏ migration storage đã chạy).
7. **Cài đặt → Danh mục → Sửa "Giải trí" → Gộp…** vào "Mua sắm" → thành công (chứng tỏ migration 0004 đã chạy).
8. **Cài đặt → Xóa toàn bộ dữ liệu…** → gõ `XÓA` → quay về hướng dẫn bắt đầu. Giờ bạn nhập số liệu thật.

## Chạy trên máy (tùy chọn, dành cho phát triển)

```bash
npm install
cp .env.example .env.local   # rồi điền URL + key thật
npm run dev                  # http://localhost:5173
```

## Xử lý sự cố thường gặp

| Hiện tượng | Nguyên nhân | Cách sửa |
|------------|-------------|----------|
| Trang "Chưa cấu hình kết nối Supabase" | Thiếu biến `VITE_…` trên Vercel | Thêm biến → Deployments → Redeploy |
| Link xác nhận email mở ra `localhost` | Site URL trên Supabase chưa đổi | Sửa Site URL = địa chỉ Vercel |
| F5 ở trang con báo 404 | Thiếu `vercel.json` | Đảm bảo `vercel.json` nằm ở gốc repo |
| "Email hoặc mật khẩu không đúng" dù chắc chắn đúng | Chưa bấm link xác nhận email | Mở thư xác nhận, hoặc tắt *Confirm email* khi thử nghiệm |
| Không nhận được email | Giới hạn email mặc định của Supabase | Đợi 1 giờ, hoặc cấu hình SMTP riêng |
| Lỗi "relation … does not exist" | Chưa chạy migration SQL | Chạy lại Bước 2.3–2.4 |
| Lỗi "Could not find the function public.save_transaction_group" khi xóa/hoàn tác | Chưa chạy file `20260925000003_transaction_groups.sql` | Chạy file đó trong SQL Editor |
| "Could not find the function public.merge_category" khi gộp danh mục | Chưa chạy `20260926000004_merge_category.sql` | Chạy file đó trong SQL Editor |
| Khôi phục / xóa toàn bộ tải một file JSON về máy thay vì lưu lên máy chủ | Storage chưa sẵn sàng (chưa chạy `…0002_storage.sql`) | Chạy file đó; file đã tải về máy vẫn là bản sao lưu hợp lệ |
| Project Supabase "Paused" | Gói free tạm dừng sau 7 ngày không hoạt động | Dashboard → **Restore project** |
