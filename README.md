# Tài Chính Cá Nhân — Budget & Net Worth Planner

Web app giúp một người (hoặc một hộ gia đình) **lập ngân sách chi tiêu hàng tháng**, **quản lý tài sản** (quỹ, tiết kiệm, đầu tư) và **khoản nợ**, từ đó tính ra **giá trị tài sản ròng (net worth)** và đưa ra insight bằng biểu đồ.

> Trạng thái: **Hoàn thành cả 8 giai đoạn ✅** — ngân sách zero-based, giao dịch & định kỳ, quỹ mục tiêu, sổ tiết kiệm, đầu tư, tài sản khác, khoản vay, thẻ tín dụng, net worth, 14 biểu đồ, insight, mô phỏng what-if, danh mục, sao lưu/khôi phục, dữ liệu demo, giao diện tối, điện thoại. 👉 Người dùng mới đọc **[docs/11 — Hướng dẫn khám phá](docs/11-huong-dan-kham-pha.md)**.

## Kiến trúc triển khai

| Thành phần | Dịch vụ | Vai trò |
|------------|---------|---------|
| Mã nguồn | **GitHub** | Lưu trữ, Vercel đọc từ đây |
| Web | **Vercel** (free) | Build `npm run build` và phục vụ thư mục `dist/` |
| Dữ liệu, đăng nhập, file | **Supabase** (free) | Postgres + Row Level Security, Auth (email/mật khẩu), Storage |

👉 Hướng dẫn từng bước: **[docs/10-trien-khai.md](docs/10-trien-khai.md)**

## Cấu trúc thư mục

```
├── src/
│   ├── schemas/        Zod schema: 1 nguồn cho kiểu TS, validate form, file sao lưu
│   ├── domain/         Công thức tính toán thuần: ngân sách, tiết kiệm, vay, đầu tư, net worth, insight
│   ├── data/           Supabase client, repositories, hook truy vấn, sao lưu, lỗi, danh mục mẫu, dữ liệu demo
│   ├── services/       Nghiệp vụ nhiều bước: giao dịch, ngân sách, định kỳ, tiết kiệm, đầu tư, nợ, snapshot, cài đặt/sao lưu
│   ├── features/       Từng màn hình: overview, budget, transactions, recurring, accounts, savings, investments, liabilities, reports, whatif, settings…
│   ├── components/     UI dùng chung, layout
│   └── lib/            Định dạng tiền/ngày, đồng hồ, theme
├── supabase/migrations/  SQL chạy trên Supabase (bảng, ràng buộc, RLS, trigger, storage)
├── tests/
│   ├── db/             Test SQL thật trên Postgres nhúng (PGlite): ràng buộc, RLS, khôi phục
│   ├── e2e/            Playwright: mô phỏng người dùng thật trên desktop + điện thoại, backend giả chạy Postgres thật
│   └── support/        PGlite chạy toàn bộ migration (dùng chung cho db và e2e)
├── docs/               Phân tích, thiết kế, triển khai, hướng dẫn người dùng (+ anh/ ảnh chụp màn hình)
├── vercel.json         Cấu hình Vercel (SPA rewrites)
└── .env.example        Mẫu biến môi trường
```

## Lệnh phát triển

Yêu cầu Node.js ≥ 20.

```bash
npm install
npm run dev          # http://localhost:5173 (cần .env.local, xem .env.example)
npm test             # unit + property + test cơ sở dữ liệu (không cần Supabase thật)
npm run test:coverage  # kèm độ phủ tầng domain (ngưỡng 95%)
npm run e2e          # mô phỏng người dùng (lần đầu: npx playwright install chromium)
npm run typecheck && npm run lint && npm run build
```

## Bộ tài liệu

| # | Tài liệu | Nội dung |
|---|----------|----------|
| 01 | [Phân tích nhu cầu](docs/01-phan-tich-nhu-cau.md) | Người dùng, bài toán, phạm vi MVP, yêu cầu phi chức năng |
| 02 | [Kiến trúc & cấu trúc thư mục](docs/02-kien-truc.md) | Stack, phân tầng, luồng dữ liệu, bảo mật |
| 03 | [Mô hình dữ liệu](docs/03-mo-hinh-du-lieu.md) | Thực thể, trường, quan hệ, bất biến (invariants) |
| 04 | [Công thức tính toán](docs/04-cong-thuc-tinh-toan.md) | Ngân sách, net worth, lãi tiết kiệm, khoản vay, chỉ số sức khỏe tài chính |
| 05 | [Workflows](docs/05-workflows.md) | Mọi luồng người dùng + edge case |
| 06 | [Forms & validation](docs/06-forms-validation.md) | Danh sách form, trường, quy tắc kiểm tra |
| 07 | [Biểu đồ & insight](docs/07-bieu-do-insight.md) | Dashboard, từng biểu đồ trả lời câu hỏi gì |
| 08 | [Kiểm thử & mô phỏng người dùng](docs/08-kiem-thu-mo-phong.md) | Persona, kịch bản E2E, số liệu kỳ vọng |
| 09 | [Lộ trình xây dựng](docs/09-lo-trinh.md) | Các giai đoạn, tiêu chí hoàn thành |
| 10 | [Triển khai](docs/10-trien-khai.md) | GitHub → Supabase → Vercel, xử lý sự cố |
| 11 | [Hướng dẫn khám phá](docs/11-huong-dan-kham-pha.md) | Cho người dùng: tour từng màn hình, chu kỳ 1 tháng, dữ liệu demo, FAQ |

## Nguyên tắc cốt lõi

1. **Giao dịch là nguồn sự thật cho dòng tiền**; số dư tài khoản luôn được *tính ra*, không nhập tay.
2. **Chuyển tiền ≠ chi tiêu.** Nạp tiết kiệm, mua đầu tư, trả gốc nợ là *chuyển giữa các tài khoản*; chỉ lãi vay và phí mới là chi phí.
3. **Net worth = Tổng tài sản − Tổng nợ** tại một thời điểm, có snapshot cuối tháng để vẽ lịch sử.
4. **Tiền lưu dạng số nguyên (đồng)**, không dùng số thực.
5. **Dữ liệu của ai người đó thấy**: mọi bảng bật Row Level Security; ràng buộc kiểm tra 2 lớp (Zod ở trình duyệt + CHECK/trigger ở Postgres).
6. **Logic tính toán là hàm thuần** tách khỏi UI và cơ sở dữ liệu → test được 100%.
