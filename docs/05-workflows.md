# 05 — Workflows

Mỗi workflow có: **mục tiêu → các bước → kết quả dữ liệu → edge case**. Mã `W*` dùng lại trong kịch bản kiểm thử (`08`).

## Bản đồ tổng thể

```
               ┌──────────── W0 Onboarding ────────────┐
               ▼                                        │
  ┌───── Chu kỳ tháng ──────────────────────────────┐   │
  │ W5 Lập ngân sách → W1/W2 Ghi giao dịch hằng ngày │   │
  │      → W6 Theo dõi & cảnh báo → W7 Đóng tháng ───┼─► Dashboard / Báo cáo
  └──────────────────────────────────────────────────┘
  Vòng đời tài sản:  W8 Quỹ mục tiêu · W9 Sổ tiết kiệm · W10 Đầu tư · W11 Tài sản khác
  Vòng đời nợ:       W12 Khoản vay · W13 Thẻ tín dụng
  Hỗ trợ:            W3 Sửa/xóa · W4 Đối soát · W14 Định kỳ · W15 Danh mục · W16 Lưu trữ · W17 Sao lưu
  Tài khoản:         W19 Đăng ký · đăng nhập · quên mật khẩu · đăng xuất
  Tác vụ khởi động:  W18 (chạy mỗi lần mở app)
```

---

### W0 — Onboarding (lần đầu đăng nhập) ✅
0. Người dùng đăng ký và xác nhận email (W19). Lần đăng nhập đầu tiên (`settings.onboardingCompleted = false`) → vào onboarding.
1. Màn chào → **"Bắt đầu"**. *("Khôi phục từ file sao lưu" (W17) và "Xem dữ liệu demo" sẽ thêm ở Giai đoạn 7–8.)*
2. Cài đặt cơ bản: ngày bắt đầu kỳ (mặc định 1), chế độ ngân sách (thường / zero-based).
3. Danh mục: chọn bộ mẫu (Cơ bản ~15 danh mục / Chi tiết ~35) — sửa được sau.
4. Thêm tài khoản tiền (ít nhất 1): tên, loại, **số dư hiện tại**, ngày = hôm nay (→ `openingBalance`, `openingDate`).
5. (Tùy chọn, có thể bỏ qua) Thêm quỹ khẩn cấp. *(Sổ tiết kiệm, đầu tư, nợ: thêm ở trang riêng từ Giai đoạn 5.)*
6. Thu nhập dự kiến hằng tháng → tạo ngân sách tháng hiện tại, hiện gợi ý 50/30/20 (phân bổ chi tiết ở trang Ngân sách — Giai đoạn 4).
7. Tới Dashboard, hiện net worth đầu tiên + checklist "Việc tiếp theo".

**Edge:** thoát giữa chừng → lưu tiến độ, lần sau tiếp tục bước dở. Bỏ qua mọi bước tùy chọn vẫn dùng được app.

### W1 — Ghi thu / chi / hoàn tiền (thao tác thường xuyên nhất) ✅
1. Nút "+" → mặc định **Chi**, con trỏ ở ô số tiền (bàn phím số).
2. Nhập số tiền (hỗ trợ gõ tắt `150k`, `2tr`, `2.5tr`), chọn danh mục (gợi ý 5 danh mục dùng gần nhất), tài khoản (nhớ lần trước), ngày (mặc định hôm nay), ghi chú.
3. Lưu → toast "Đã lưu · Ăn uống còn 1.250.000 ₫" + nút **Hoàn tác** 5 giây.
4. Nếu vượt ngưỡng 80%/100% → toast cảnh báo màu tương ứng.

**Edge:** chi bằng thẻ tín dụng làm vượt hạn mức → cảnh báo, vẫn cho lưu. Chi từ TK tiền mặt làm số dư âm → chặn (I7). Ngày trước `openingDate` → chặn (I2). Ngày trong tháng đã đóng → xác nhận (I10). Ngày tương lai → cho phép, gắn nhãn "dự kiến", không tính vào số dư hôm nay.

### W2 — Chuyển khoản ✅
Chọn TK nguồn → TK đích (mọi loại). Hệ thống **tự nhận diện ý nghĩa** và hiển thị câu mô tả:
| Nguồn → Đích | Hiển thị |
|--------------|----------|
| ngân hàng → ví | "Chuyển tiền" |
| ngân hàng → quỹ mục tiêu / sổ TK | "Tiết kiệm vào…" (tính vào dòng ngân sách tiết kiệm) |
| ngân hàng → khoản vay / thẻ | "Trả nợ…" → gợi ý dùng form Trả nợ (W12) để tách lãi |
| khoản vay → ngân hàng | "Giải ngân khoản vay" |

**Edge:** nguồn = đích → chặn. Chuyển vào nợ nhiều hơn dư nợ → chặn, gợi ý số tối đa (I6).

### W3 — Sửa / xóa giao dịch ✅
- Sửa: mở form với dữ liệu cũ; giao dịch thuộc nhóm (`groupId`) mở **form nghiệp vụ gốc** (VD form trả nợ), không cho sửa lẻ từng phần.
- Xóa: xác nhận → xóa (cả nhóm) → toast Hoàn tác. Xóa trade đầu tư mà khiến lệnh bán sau đó bán quá số lượng → chặn, liệt kê lệnh bị ảnh hưởng (I5).
- Sau khi sửa/xóa: snapshot từ tháng đó trở đi `stale` (tự tính lại).

### W4 — Đối soát số dư ✅
Tại account → "Cập nhật số dư thực tế" → nhập số trên app ngân hàng → hiện chênh lệch → chọn:
- **Ghi thành điều chỉnh** (`adjustment`, không tính thu/chi), hoặc
- **Ghi thành chi tiêu "Chi không rõ"** (khi biết chắc là đã tiêu mà quên ghi).

### W5 — Lập ngân sách tháng
1. Vào tháng chưa có ngân sách → 3 lựa chọn: **Sao chép tháng trước** / **Theo mẫu 50/30/20** / **Trống**.
2. Nhập thu nhập dự kiến. Bảng danh mục: cột *Kế hoạch · Chuyển từ tháng trước · Đã chi · Còn lại*.
3. Thêm dòng tiết kiệm/trả nợ thêm (target = account).
4. Thanh "Chưa phân bổ" cập nhật trực tiếp (zero-based: xanh khi = 0, đỏ khi âm).
5. Gợi ý: "TB 3 tháng bạn chi Ăn uống 4,2 tr — đang đặt 3 tr".

**Edge:** đặt ngân sách cho cả cha và con → chặn. Tháng tương lai được lập trước. Danh mục bị lưu trữ vẫn hiển thị ở tháng cũ.

### W6 — Theo dõi trong tháng
Dashboard + trang ngân sách: thanh tiến độ mỗi dòng với **vạch pace** (hôm nay đáng lẽ chi đến đâu). Cảnh báo tập trung trong "Chuông thông báo": vượt ngân sách, sổ TK sắp đáo hạn (7 ngày), kỳ trả nợ sắp đến (3 ngày), giao dịch định kỳ chờ xác nhận, giá đầu tư chưa cập nhật > 30 ngày.

### W7 — Đóng tháng (review)
Kích hoạt khi mở app sau ngày cuối kỳ (hoặc bấm tay):
1. Checklist: giao dịch định kỳ còn chờ? Đã đối soát các TK? Cập nhật giá đầu tư?
2. Báo cáo tháng: thu, chi, tỉ lệ tiết kiệm, top 5 danh mục, dòng vượt ngân sách, ΔNW phân rã.
3. Xử lý số dư các dòng rollover (hiển thị số sẽ chuyển sang tháng sau).
4. Bấm **Đóng tháng** → `status = closed`, lưu snapshot, tạo ngân sách tháng mới (W5).

**Edge:** không đóng tháng vẫn không sao — snapshot vẫn tính (tự động), chỉ là không có bước review.

### W8 — Quỹ mục tiêu
Tạo quỹ (tên, mục tiêu, hạn, có phải quỹ khẩn cấp) → góp tiền bằng transfer (có thể là dòng ngân sách hàng tháng) → hiển thị tiến độ, **số cần góp mỗi tháng** = `(mục tiêu − hiện có) / số tháng còn lại` → đạt mục tiêu → chúc mừng, gợi ý đặt mục tiêu mới hoặc lưu trữ. Rút quỹ = transfer ngược lại (hỏi lý do, tùy chọn).

### W9 — Sổ tiết kiệm có kỳ hạn
1. **Mở sổ:** ngân hàng, gốc, lãi suất, kỳ hạn, ngày mở, hình thức nhận lãi, hành động đáo hạn, TK nguồn tiền → service tạo account + `DepositTerm #1` + transfer TK nguồn → sổ. Hiển thị ngay lãi dự kiến và ngày đáo hạn.
   - Nếu là sổ **đã có từ trước**: không tạo transfer, gốc thành `openingBalance`.
2. **Trong kỳ:** net worth tăng dần theo lãi dồn tích (nếu bật). Lãi tháng (nếu `monthly`) → W18 tạo income mỗi tháng.
3. **Đáo hạn:** W18 phát hiện → thông báo "Sổ X đã đáo hạn" → màn xác nhận: số lãi thực nhận (sửa được), hành động (theo cài đặt, đổi được), lãi suất kỳ mới → service `matureDeposit` (04 §5).
4. **Rút trước hạn:** nhập ngày, lãi thực nhận (điền sẵn theo lãi không kỳ hạn) → income lãi + transfer gốc về TK nhận → kỳ `withdrawn_early`, lưu trữ account.

### W10 — Đầu tư
1. Tạo TK đầu tư (VD "Chứng khoán SSI", "Vàng tích trữ") — số dư tiền mặt ban đầu.
2. Thêm holding (mã, tên, loại, đơn vị). Nếu đang nắm giữ sẵn → trade `buy` với giá vốn hiện có, **không trừ tiền** (cờ "nhập số dư đầu").
3. **Mua/Bán:** ngày, số lượng, giá, phí, thuế, nguồn tiền → service tạo trade + chi phí phí/thuế + transfer (nếu nguồn khác) cùng `groupId`. Bán hiển thị lãi/lỗ thực hiện.
4. **Cập nhật giá:** nhập giá hiện tại cho một/nhiều mã một lúc → PriceQuote ngày hôm nay.
5. **Cổ tức:** tiền → income; cổ phiếu → trade giá 0.

### W11 — Tài sản khác (nhà, xe…)
Thêm (tên, giá trị ước tính, ngày) → định kỳ **Định giá lại** (AssetValuation) → bán: nhập giá bán + TK nhận → transfer giá trị cuối vào TK, chênh lệch ghi là định giá tại ngày bán, lưu trữ account. Mua nhà bằng vay: W12 giải ngân từ khoản vay → tài sản khác.

### W12 — Khoản vay
1. **Thêm:** chọn *Khoản vay mới* (tạo transfer giải ngân khoản vay → TK nhận / tài sản) hoặc *Khoản vay đang trả* (nhập dư nợ hiện tại làm `openingBalance`, số kỳ còn lại).
2. Nhập loại lãi, lãi suất (có thể nhiều giai đoạn), kỳ hạn, ngày trả hằng tháng → xem **lịch trả nợ dự phóng** trước khi lưu.
3. **Trả kỳ:** thông báo đến hạn → form điền sẵn gốc/lãi theo lịch → người dùng sửa theo sao kê → lưu (04 §6).
4. **Trả trước:** nhập số tiền, chọn giảm kỳ hạn / giảm khoản trả, phí → so sánh tiết kiệm được bao nhiêu lãi trước khi xác nhận.
5. **Đổi lãi suất** (hết ưu đãi): thêm `ratePeriod` → lịch dự phóng cập nhật.
6. **Tất toán:** dư nợ = 0 → chúc mừng, account tự lưu trữ (có thể mở lại).

### W13 — Thẻ tín dụng
Chi tiêu chọn TK = thẻ → dư nợ tăng. Đến ngày sao kê: hiển thị dư nợ sao kê, tối thiểu phải trả, hạn thanh toán. Thanh toán: transfer ngân hàng → thẻ (Toàn bộ / Tối thiểu / Số khác). Quá hạn chưa trả đủ → nhắc ghi lãi/phí phát sinh.

### W14 — Giao dịch định kỳ
Tạo từ form giao dịch (công tắc "Lặp lại") hoặc trang riêng. `auto` → tự ghi khi đến ngày; `confirm` → vào hàng chờ, người dùng xác nhận/sửa số tiền/bỏ qua kỳ. `dayOfMonth = 31` → ngày cuối tháng. Tạm dừng, kết thúc.

### W15 — Danh mục
Thêm/sửa/sắp xếp. **Xóa** danh mục có giao dịch → chọn *gộp vào danh mục khác* (chuyển giao dịch + dòng ngân sách, cộng dồn nếu trùng tháng) hoặc *lưu trữ*. Danh mục hệ thống chỉ đổi tên/biểu tượng.

### W16 — Lưu trữ / xóa account ✅
Account có giao dịch → chỉ **lưu trữ** (ẩn khỏi danh sách, vẫn nằm trong lịch sử net worth). Account chưa có giao dịch → xóa được. Lưu trữ account có số dư ≠ 0 → cảnh báo, gợi ý chuyển số dư trước.

### W17 — Sao lưu / khôi phục / xóa dữ liệu
- Xuất JSON (toàn bộ) và CSV (giao dịch, theo khoảng ngày).
- Nhắc sao lưu nếu > 30 ngày chưa xuất.
- Khôi phục: chọn file → validate → tóm tắt → **tự sao lưu dữ liệu hiện tại** → thay thế. File hỏng/sai version → báo lỗi rõ ràng, không đụng dữ liệu hiện có.
- Xóa toàn bộ dữ liệu: gõ xác nhận "XÓA" → gợi ý xuất bản sao lưu trước.

### W18 — Tác vụ khởi động (mỗi lần mở app, idempotent)
1. Chạy migration nếu `schemaVersion` cũ.
2. Sinh giao dịch định kỳ đến hạn (`nextDate ≤ hôm nay`), kể cả các kỳ bị lỡ khi lâu không mở app.
3. Lãi tháng sổ tiết kiệm đến hạn; phát hiện sổ đáo hạn → thông báo.
4. Kỳ trả nợ đến hạn/quá hạn → thông báo.
5. Tính lại snapshot `stale` và tạo snapshot cho các tháng đã kết thúc chưa có.
6. Mọi bước dùng khóa idempotent (VD `recurring:<ruleId>:<date>`), được Postgres đảm bảo bằng unique `(user_id, idempotency_key)` → mở 2 tab, 2 thiết bị hay reload giữa chừng **không tạo trùng**.

### W19 — Tài khoản người dùng
| Luồng | Bước | Edge case |
|-------|------|-----------|
| **Đăng ký** | Email + mật khẩu (≥ 8 ký tự) + nhập lại → thư xác nhận → bấm link → vào app (onboarding) | Email đã tồn tại → báo rõ; mật khẩu yếu/không khớp → báo dưới ô; giới hạn gửi email → báo thử lại sau |
| **Đăng nhập** | Email + mật khẩu → quay về đúng trang định vào trước đó | Sai thông tin → "Email hoặc mật khẩu không đúng" (không tiết lộ email có tồn tại); chưa xác nhận email → nhắc mở thư |
| **Quên mật khẩu** | Nhập email → thư có link → `/reset-password` → mật khẩu mới → vào app | Luôn báo "nếu email đã đăng ký…" (chống dò email); link hết hạn → mời gửi lại |
| **Đăng xuất** | Nút ở thanh bên (desktop) / thanh trên (mobile) → về `/login`, xóa cache dữ liệu | Mở lại trang cũ sau khi đăng xuất → bị chuyển về `/login` |
| **Phiên** | Tải lại trang vẫn đăng nhập; token tự làm mới | Hết phiên khi đang thao tác → lỗi "Phiên đăng nhập đã hết" → đăng nhập lại |
