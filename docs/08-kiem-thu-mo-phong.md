# 08 — Kế hoạch kiểm thử & mô phỏng người dùng

## 1. Ba tầng kiểm thử

| Tầng | Công cụ | Phạm vi | Tiêu chí |
|------|---------|---------|----------|
| **Unit** | Vitest | Toàn bộ `domain/` — từng công thức ở `04` với số liệu kỳ vọng | Coverage `domain/` ≥ 95% |
| **Cơ sở dữ liệu** | Vitest + PGlite | Chạy migration SQL thật: RLS tách người dùng, CHECK/trigger, unique, khôi phục sao lưu atomic, khớp schema TS ↔ cột SQL | Mọi ràng buộc ở `03 §4–5` có test |
| **Property-based** | Vitest + fast-check | Sinh ngẫu nhiên hàng nghìn chuỗi giao dịch → kiểm tra bất biến | 0 vi phạm |
| **E2E mô phỏng người dùng** | Playwright (Chromium desktop + giả lập điện thoại Pixel 7) | Chạy các kịch bản persona dưới đây như người thật: gõ, bấm, điều hướng; giả lập đồng hồ để "sống" qua nhiều tháng | Mọi số hiển thị khớp bảng kỳ vọng |

Lệnh: `npm test` (unit + property + DB), `npm run test:coverage` (ngưỡng tầng domain: câu lệnh/dòng/hàm ≥ 95%, nhánh ≥ 85% — build CI sẽ fail nếu tụt), `npm run e2e`.

**Bất biến kiểm tra bằng property test** (`src/domain/invariants.property.test.ts`, mục 1–5 có từ Giai đoạn 2; mục 8 ở `tests/db` từ Giai đoạn 1; mục 6–7 cần tầng service, làm ở Giai đoạn 3–4):
1. `netWorth = Σ value(asset) − Σ value(liability)` tại mọi ngày.
2. Phân rã ΔNW (04 §8) cộng lại **đúng bằng** ΔNW, lệch 0 đồng.
3. Transfer không bao giờ làm đổi net worth, không làm đổi tổng thu/chi.
4. Lịch trả nợ: Σ gốc = dư nợ ban đầu; kỳ cuối dư nợ = 0.
5. Chia không lệch: Σ phần = tổng.
6. Xóa rồi hoàn tác một giao dịch → toàn bộ số liệu trở về y nguyên.
7. Chạy tác vụ khởi động (W18) 2 lần liên tiếp → không phát sinh bản ghi mới ở lần 2.
8. Export → Import → Export: hai file giống hệt nhau (trừ `exportedAt`).

## 2. Kịch bản P1 — Lan (ngân sách + quỹ khẩn cấp)

**Thiết lập W0 ngày 01/08/2026** (kỳ = tháng dương lịch):

| Account | kind | Số dư đầu |
|---------|------|-----------|
| Vietcombank | bank | 25.000.000 |
| Tiền mặt | cash | 2.000.000 |
| MoMo | ewallet | 500.000 |
| Quỹ khẩn cấp (mục tiêu 60.000.000, isEmergencyFund) | goal_fund | 10.000.000 |

→ **Kỳ vọng:** Net worth = **37.500.000**.

**Ngân sách 08/2026 (W5)** — thu nhập dự kiến 18.000.000:
Nhà ở 5.000.000 · Ăn uống 3.500.000 (rollover) · Đi lại 800.000 · Mua sắm 1.500.000 · Giải trí 1.000.000 · Hóa đơn 700.000 · Quỹ khẩn cấp (account) 3.000.000
→ **Kỳ vọng:** Tổng kế hoạch 15.500.000 · Chưa phân bổ **2.500.000**.

**Giao dịch tháng 8 (W1, W2):**

| Ngày | Loại | Chi tiết | Số tiền |
|------|------|----------|---------|
| 05/08 | Thu | Lương → VCB | 18.000.000 |
| 05/08 | Chi | Nhà ở, VCB | 5.000.000 |
| 06/08 | Chuyển | VCB → Quỹ khẩn cấp | 3.000.000 |
| 07/08 | Chuyển | VCB → Tiền mặt | 2.000.000 |
| 07/08 | Chuyển | VCB → MoMo | 1.000.000 |
| rải rác | Chi | Ăn uống: Tiền mặt 2.600.000 + VCB 1.250.000 | 3.850.000 |
| rải rác | Chi | Đi lại, MoMo | 600.000 |
| 15/08 | Chi | Mua sắm, VCB | 1.200.000 |
| 18/08 | Hoàn tiền | Mua sắm, VCB | 200.000 |
| rải rác | Chi | Giải trí, VCB | 1.100.000 |
| 20/08 | Chi | Hóa đơn, VCB | 700.000 |

**Kỳ vọng cuối tháng 8 (W7):**

| Chỉ tiêu | Giá trị |
|----------|---------|
| Thu nhập thực tế | 18.000.000 |
| Chi tiêu thực tế (đã trừ hoàn tiền) | 12.250.000 |
| Dòng tiền ròng | 5.750.000 |
| Tỉ lệ tiết kiệm | 31,9% → "Tốt" |
| Ăn uống | 3.850.000 / 3.500.000 = 110% → **vượt 350.000**; rollover → tháng 9 nhận `carryIn = −350.000` |
| Giải trí | 110% → vượt 100.000 (không rollover) |
| Mua sắm | 1.000.000 / 1.500.000 = 66,7% |
| Hóa đơn | 100% → "vừa hết" |
| Dòng Quỹ khẩn cấp | 3.000.000 / 3.000.000 = 100% |
| Số dư: VCB / Tiền mặt / MoMo / Quỹ | 27.950.000 / 1.400.000 / 900.000 / 13.000.000 |
| Net worth | **43.250.000** (Δ = +5.750.000 = dòng tiền ròng, thị trường = 0) |
| Chi thiết yếu (Nhà, Ăn, Đi lại, Hóa đơn) | 10.150.000 |
| Tháng quỹ khẩn cấp | 13.000.000 / 10.150.000 = **1,28** → insight I-EMERG |
| 50/30/20 thực tế | 56,4% / 11,7% / 31,9% (tổng 100%) |

**Tiếp tục tháng 9:** sao chép ngân sách → Ăn uống khả dụng = 3.500.000 − 350.000 = **3.150.000**. Thử: nhập chi 150.000 từ Tiền mặt ngày 31/07 → phải bị chặn (trước openingDate). Rút 20.000.000 từ Tiền mặt → bị chặn (âm). Hoàn tác giao dịch vừa lưu → số dư về như cũ.

## 3. Kịch bản P2 — Hùng (vay mua nhà + sổ tiết kiệm)

1. **Khoản vay đang trả** (W12): gốc đều, dư nợ 1.200.000.000, 9%/năm, còn 240 kỳ, trả ngày 10.
   → Lịch kỳ 1: gốc **5.000.000**, lãi **9.000.000**, tổng **14.000.000**; kỳ 240 tổng **5.037.500**; Σ gốc = 1.200.000.000.
2. **Trả kỳ 1** (F9, điền sẵn, giữ nguyên) từ VCB:
   → VCB −14.000.000 · dư nợ **1.195.000.000** · chi "Lãi vay" +9.000.000 · **net worth chỉ giảm 9.000.000**.
   → Xóa giao dịch lãi đơn lẻ → hệ thống mở form trả nợ (không cho xóa lẻ). Xóa cả nhóm → dư nợ về 1.200.000.000.
3. **Hết ưu đãi**: thêm ratePeriod 11% từ kỳ 13 → lãi kỳ 13 = dư nợ đầu kỳ × 11%/12.
4. **Trả trước 100.000.000**, giảm kỳ hạn, phí 1% → chi phí 1.000.000; số kỳ còn lại giảm; màn so sánh hiện tổng lãi tiết kiệm được > 0.
5. **Sổ tiết kiệm** (W9): 100.000.000, 5,5%, 6 tháng, mở 01/03/2026 từ VCB, trả lãi cuối kỳ, tái tục gốc.
   → Đáo hạn **01/09/2026**, lãi **2.772.603**. Ngày 01/06 (bật lãi dồn tích) giá trị sổ = 100.000.000 + round(100.000.000 × 0,055 × 92/365) = **101.386.301**.
   → Giả lập đồng hồ tới 01/09/2026, mở app → thông báo đáo hạn → xác nhận → income 2.772.603 vào VCB, kỳ #2 bắt đầu 01/09/2026.
   → Mở app lần 2 cùng ngày → **không** sinh thêm lãi (idempotent).
6. **Kịch bản rút trước hạn** (bản sao dữ liệu): rút 01/06/2026 với 0,1%/năm → lãi **25.205**, gốc về VCB, sổ lưu trữ.

## 4. Kịch bản P3 — Mai (đầu tư + thẻ tín dụng + thu nhập không đều)

1. TK "Chứng khoán" tiền mặt 0 → chuyển từ VCB 300.000.000.
2. Mua FPT 1.000 cp × 120.000, phí 180.000 → Mua 500 cp × 108.000, phí 81.000.
   → Giá vốn bình quân **116.000**; tiền mặt TK CK = 300.000.000 − 120.000.000 − 54.000.000 − 261.000 = **125.739.000**.
3. Cập nhật giá 125.000 → giá trị thị trường **187.500.000**, giá vốn **174.000.000**, lãi chưa thực hiện **+13.500.000 (+7,76%)**.
   → Thác nước tháng: mục "Thị trường" = +13.500.000; mục "Chi tiêu" gồm 261.000 phí.
4. Bán 600 cp × 130.000, phí 117.000, thuế 78.000 → lãi thực hiện **8.400.000**; còn 900 cp, giá vốn vẫn 116.000.
   → Thử bán 1.000 cp → bị chặn (chỉ còn 900).
5. Thẻ tín dụng: hạn mức 50.000.000, dư nợ 20.000.000, lãi 30%/năm, trả cố định 1.000.000/tháng
   → Dự phóng **29 tháng** trả hết (n ≈ 28,07); sử dụng hạn mức 40% → "Trung bình".
   → Đặt trả 400.000/tháng (< lãi 500.000) → cảnh báo "không bao giờ trả hết".
6. Thu nhập: tháng 7 = 10 tr, tháng 8 = 60 tr → ngân sách tháng 9 chọn "TB 3 tháng" cho thu nhập dự kiến.

## 5. Kịch bản edge case (chạy trên cả 3 persona)

| # | Kịch bản | Kỳ vọng |
|---|----------|---------|
| E1 | Đổi `periodStartDay` từ 1 → 5 giữa tháng | **(Chốt lại ở GĐ7)** Mọi kỳ — cả kỳ cũ — được tính lại theo ngày mới; app cảnh báo rõ trước khi lưu và đánh dấu mọi snapshot cần tính lại. Mỗi giao dịch thuộc đúng 1 kỳ → không mất/nhân đôi. (Giữ kỳ cũ theo ngày cũ sẽ tạo kỳ chuyển tiếp dài/ngắn bất thường, khó hiểu hơn.) |
| E2 | Giao dịch định kỳ ngày 31, qua tháng 2 | Ghi vào 28/02 (29/02 năm nhuận) |
| E3 | Không mở app 3 tháng | Mở lại: sinh đủ 3 kỳ định kỳ lỡ, 3 snapshot, thông báo gom nhóm |
| E4 | Ghi giao dịch lùi ngày vào tháng đã đóng | Hỏi xác nhận; snapshot các tháng sau được tính lại; biểu đồ R1 cập nhật |
| E5 | Xóa danh mục có 50 giao dịch, gộp vào danh mục khác | Tổng chi theo tháng không đổi; dòng ngân sách cộng dồn |
| E6 | Import file hỏng / file từ version cao hơn | Báo lỗi rõ, dữ liệu hiện tại nguyên vẹn |
| E7 | Mở 2 tab / 2 thiết bị, ghi ở A | B cập nhật khi quay lại tab (TanStack Query refetch); W18 không tạo trùng nhờ unique idempotency_key |
| E8 | Số tiền cực lớn (999 tỷ) và cực nhỏ (1 đồng) | Hiển thị đúng, không tràn layout, không sai số |
| E9 | App mới tinh, chưa có dữ liệu | Mọi biểu đồ ở trạng thái rỗng có hướng dẫn; chỉ số hiện "Chưa đủ dữ liệu", không NaN |
| E10 | Thu nhập tháng = 0 | Tỉ lệ tiết kiệm = "Chưa đủ dữ liệu" |
| E11 | Trả nợ số gốc > dư nợ | Chặn, gợi ý số tối đa |
| E12 | Lưu trữ account còn số dư | Cảnh báo; nếu vẫn lưu trữ → NW lịch sử giữ nguyên, NW hiện tại loại bỏ account |
| E13 | Mobile 360px, dark mode | Mọi form dùng được bằng một tay; không cuộn ngang ngoài biểu đồ |
| E14 | Đóng trình duyệt giữa lúc lưu nghiệp vụ nhiều bước | Hoặc có đủ cả nhóm, hoặc không có gì (DB transaction) |

**Nơi kiểm thử từng edge case**

| # | Test |
|---|------|
| E1 | `domain/period.test.ts` (property: mỗi ngày thuộc đúng 1 kỳ với mọi startDay) · `e2e/settings.spec.ts` (cảnh báo khi đổi) |
| E2 | `domain/recurring.test.ts` |
| E3 | `domain/recurring.test.ts`, `services/startup.ts` · `e2e/p1-budget.spec.ts` |
| E4 | `services/snapshots.ts` (đánh dấu stale) · `domain/networth.test.ts` |
| E5 | `db/merge-category.test.ts` (tổng chi không đổi, ngân sách cộng dồn) · `e2e/settings.spec.ts` W15 |
| E6 | `db/migration.test.ts` (rollback) · `services/settings.test.ts` · `e2e/settings.spec.ts` (file hỏng) |
| E7 | TanStack Query `refetchOnWindowFocus` · `db/migration.test.ts` (unique idempotency_key) |
| E8 | `domain/networth.test.ts`, `lib/format.test.ts` |
| E9, E13 | `e2e/settings.spec.ts` (tài khoản rỗng, 360px, mọi trang: không NaN, không cuộn ngang) · 2 project desktop + Pixel 7 · ảnh chụp sáng/tối |
| E10 | `domain/insights.test.ts` |
| E11 | `domain/validation.test.ts` · `e2e/p2-hung.spec.ts` |
| E12 | `domain/networth.test.ts` |
| E14 | `db/migration.test.ts`, `db/groups.test.ts` (RPC một transaction) |
| Hiệu năng | `domain/perf.test.ts`: 10.000 giao dịch, sổ cái + 36 tháng net worth + dòng tiền < 2 giây (thực tế ≈ 60 ms) |

## 6. Hạ tầng test

- Dữ liệu persona được dựng bằng code (`src/data/demo/personas.ts`) → vừa dùng làm dữ liệu demo, vừa để nạp nhanh trong E2E.
- Playwright `page.clock` để giả lập ngày (đáo hạn, định kỳ, đóng tháng).
- E2E không cần Supabase thật: `tests/e2e/fake-backend.ts` đóng vai Supabase (Auth + PostgREST) ngay trong Playwright, nhưng dữ liệu nằm trong **Postgres thật** (PGlite) đã chạy đủ migration — RLS, CHECK, trigger, RPC đều có hiệu lực, nên E2E bắt được cả lỗi ở tầng cơ sở dữ liệu. Kịch bản đọc thẳng Postgres để đối chiếu (VD đúng 16 giao dịch sau khi Lan nhập tháng 8).
- Dữ liệu persona (`src/test/personas.ts`) được nạp qua đúng đường khôi phục sao lưu (`replace_all_data`) để mỗi kịch bản bắt đầu từ trạng thái đã biết.
- Hiện có: `auth.spec.ts` (W19), `p1-lan.spec.ts` (W0 + toàn bộ tháng 8 của P1), `ledger-actions.spec.ts` (W1 hoàn tác, W3, W4, W8, W16, cảnh báo xác nhận), `p1-budget.spec.ts` (W5–W7, W14, W18), `p2-hung.spec.ts` (W9, W12), `p3-mai.spec.ts` (W10, W11, W13), `overview.spec.ts` (D1–D6, R1–R14, what-if), `settings.spec.ts` (W15, W17, demo, xóa toàn bộ, tùy chọn, E9/E13).
- Dữ liệu persona nay nằm ở `src/data/demo/personas.ts` (dùng chung cho test và nút "Dữ liệu demo" trong app); `src/data/demo/index.ts` dời ngày để tháng chính của persona là tháng vừa qua.
- Mỗi kịch bản E2E so sánh **số hiển thị trên UI** với bảng kỳ vọng, không chỉ kiểm tra "không lỗi".
- CI chạy: typecheck → lint → unit + property → build → E2E.
