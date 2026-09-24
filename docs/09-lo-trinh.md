# 09 — Lộ trình xây dựng

Xây **từ lõi ra ngoài**: công thức đúng trước, giao diện sau. Mỗi giai đoạn kết thúc bằng tiêu chí kiểm chứng được.

| Giai đoạn | Nội dung | Hoàn thành khi |
|-----------|----------|----------------|
| **0. Phân tích & khung lõi** ✅ | Bộ tài liệu `docs/` | Người dùng duyệt các giả định ở `01 §5` và phạm vi MVP |
| **1. Nền móng** ✅ | Vite + React + TS strict, Tailwind, Vitest, Playwright, ESLint; Zod schemas; **Supabase**: migration SQL (13 bảng, RLS, trigger, storage), repositories, sao lưu qua RPC; **Auth**: đăng ký/đăng nhập/quên mật khẩu; cấu hình Vercel | build, lint, unit + DB test, E2E xanh; hướng dẫn triển khai `10` |
| **2. Domain lõi** ✅ | `money`, `period`, `balance`, `budget`, `savings`, `loan`, `investment`, `networth`, `insights` + unit test & property test với **toàn bộ số liệu ở `04` và `08`** | Mọi số kỳ vọng ở `08 §2–4` pass ở tầng unit |
| **3. Tài khoản & giao dịch** ✅ | Layout, điều hướng, W0 onboarding, F1/F2, danh sách giao dịch, W3, W4, W16 | E2E: onboarding + ghi giao dịch của P1 |
| **4. Ngân sách** ✅ | F11, trang ngân sách, rollover, pace, cảnh báo, W5–W7, W14 định kỳ, W18 | E2E: toàn bộ kịch bản P1 |
| **5. Tài sản & nợ** ✅ | Sổ tiết kiệm (W9), đầu tư (W10), tài sản khác (W11), khoản vay (W12), thẻ (W13) | E2E: kịch bản P2, P3 |
| **6. Dashboard, báo cáo & what-if** ✅ | D1–D6, R1–R14, bộ sinh insight, trang mô phỏng what-if (01 §3.1-H) | Số trên biểu đồ khớp bảng kỳ vọng; trạng thái rỗng E9 |
| **7. Dữ liệu & hoàn thiện** ✅ | W15 danh mục, W17 sao lưu/khôi phục, dark mode, responsive, a11y, hiệu năng 10k giao dịch | Toàn bộ edge case E1–E14 pass |
| **8. Hướng dẫn khám phá** ✅ | Tài liệu "Discover guide" cho người dùng cuối: tour từng màn hình, ảnh chụp, mẹo, câu hỏi thường gặp; dữ liệu demo 3 persona | Người mới làm theo hướng dẫn hoàn thành chu kỳ 1 tháng không cần hỏi |

## Quyết định đã chốt (24/09/2026)

1. "Quỹ" = quỹ mục tiêu/khẩn cấp; chứng chỉ quỹ thuộc Đầu tư.
2. MVP: chỉ VND. ~~Một người dùng, local-first~~ → **đổi 24/09/2026**: nhiều người dùng, Supabase (DB + Auth + Storage), deploy Vercel free, mã nguồn trên GitHub (tải lên thủ công từ thư mục `current/`).
3. Chế độ ngân sách mặc định: **zero-based**.
4. Mô phỏng what-if **có trong MVP** (Giai đoạn 6).
5. Stack: React + TypeScript + Supabase + TanStack Query + Recharts.
