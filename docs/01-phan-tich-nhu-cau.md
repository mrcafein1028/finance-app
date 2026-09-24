# 01 — Phân tích nhu cầu

## 1. Bài toán

Người dùng cá nhân tại Việt Nam thường có tiền nằm rải rác: tiền mặt, 2–3 tài khoản ngân hàng, ví điện tử, sổ tiết kiệm có kỳ hạn, chứng chỉ quỹ, cổ phiếu, vàng, có thể có thêm khoản vay mua nhà/xe, thẻ tín dụng, vay tiêu dùng. Họ gặp ba vấn đề:

| Vấn đề | Câu hỏi người dùng muốn trả lời |
|--------|--------------------------------|
| **Không kiểm soát chi tiêu** | "Tháng này tôi còn được tiêu bao nhiêu cho ăn uống?" "Tôi hay vượt ngân sách ở đâu?" |
| **Không thấy bức tranh tổng** | "Tổng cộng tôi đang có bao nhiêu? Nợ bao nhiêu? Tôi giàu lên hay nghèo đi?" |
| **Không biết tiến độ** | "Quỹ khẩn cấp đủ mấy tháng? Bao giờ trả hết nợ? Tỉ lệ tiết kiệm của tôi là bao nhiêu?" |

## 2. Người dùng mục tiêu (persona)

| Persona | Mô tả | Nhu cầu nổi bật |
|---------|-------|-----------------|
| **P1 — Lan, 26t, nhân viên văn phòng** | Lương cố định 18 tr/tháng, thuê nhà, chưa có nợ, muốn xây quỹ khẩn cấp | Ngân sách đơn giản, theo dõi quỹ mục tiêu |
| **P2 — Hùng, 35t, đã lập gia đình** | Thu nhập 2 vợ chồng 45 tr, vay mua nhà 1,2 tỷ, có sổ tiết kiệm + chứng chỉ quỹ | Lịch trả nợ, net worth theo thời gian, phân bổ tài sản |
| **P3 — Mai, 30t, freelancer** | Thu nhập không đều (10–60 tr), đầu tư cổ phiếu, thẻ tín dụng | Ngân sách linh hoạt theo thu nhập thực tế, dòng tiền, cảnh báo |

## 3. Phạm vi chức năng

### 3.1 MVP (bắt buộc)

**A. Tài khoản người dùng, thiết lập & danh mục**
- Đăng ký / đăng nhập bằng email + mật khẩu, xác nhận email, quên & đặt lại mật khẩu, đăng xuất. Dữ liệu gắn với tài khoản, dùng được trên mọi thiết bị.
- Onboarding lần đầu: đơn vị tiền tệ (mặc định VND), ngày bắt đầu tháng tài chính (mặc định ngày 1), bộ danh mục mẫu.
- Quản lý danh mục thu/chi 2 cấp (nhóm → danh mục), gắn nhãn **Thiết yếu / Mong muốn / Tiết kiệm-Đầu tư** (phục vụ quy tắc 50/30/20).

**B. Tài khoản & tài sản**
- Tài khoản tiền: tiền mặt, ngân hàng, ví điện tử.
- **Quỹ mục tiêu** (quỹ khẩn cấp, quỹ du lịch, quỹ mua xe…): có số tiền mục tiêu, hạn, tiến độ.
- **Tiết kiệm có kỳ hạn**: gốc, lãi suất, kỳ hạn, ngày mở, hình thức nhận lãi, hành động khi đáo hạn.
- **Đầu tư**: cổ phiếu, chứng chỉ quỹ, vàng, crypto, bất động sản, khác — theo dõi số lượng, giá vốn, giá hiện tại, lãi/lỗ.
- Tài sản khác (xe, đồ giá trị) — nhập giá trị ước tính.

**C. Nợ**
- Loại: vay mua nhà, vay mua xe, vay tiêu dùng, thẻ tín dụng, vay người thân, trả góp (BNPL).
- Phương pháp tính lãi: **dư nợ giảm dần** hoặc **lãi phẳng (flat)** — rất phổ biến ở vay tiêu dùng VN.
- Lịch trả nợ dự kiến, ghi nhận trả nợ (tách gốc/lãi), trả trước hạn, tất toán.

**D. Ngân sách tháng**
- Lập ngân sách theo danh mục cho từng tháng; sao chép từ tháng trước.
- Chế độ **zero-based** (mặc định, có thể chuyển sang ngân sách thường): mọi đồng thu nhập dự kiến đều được giao việc → hiển thị "Chưa phân bổ".
- Chuyển dư/thâm hụt sang tháng sau (rollover) theo từng danh mục.
- Theo dõi thực tế vs kế hoạch, cảnh báo 80% / 100%.

**E. Giao dịch**
- Thu, Chi, Chuyển khoản (giữa mọi loại tài khoản/tài sản/nợ), Trả nợ, Cập nhật giá trị tài sản.
- Lọc, tìm kiếm, sửa, xóa (có xác nhận), giao dịch định kỳ (lương, tiền nhà, trả góp).

**F. Net worth & báo cáo**
- Net worth hiện tại, snapshot cuối mỗi tháng, lịch sử theo thời gian.
- Dashboard + biểu đồ insight (xem `07`).
- Chỉ số sức khỏe tài chính: tỉ lệ tiết kiệm, số tháng quỹ khẩn cấp, tỉ lệ nợ/tài sản, tỉ lệ trả nợ/thu nhập (DTI).

**G. Dữ liệu**
- Lưu trên **Supabase (Postgres)** theo từng tài khoản; **xuất/nhập JSON** để sao lưu, xuất CSV giao dịch; file người dùng (sao lưu, ảnh hóa đơn) lưu ở Supabase Storage.

**H. Mô phỏng "what-if"** *(đưa vào MVP theo xác nhận 24/09/2026)*
- Dự phóng net worth 1–10 năm theo tốc độ tiết kiệm, lợi suất giả định, lịch trả nợ hiện tại.
- Kịch bản so sánh: tăng/giảm tiết kiệm hàng tháng, trả nợ thêm X/tháng, trả trước một lần, thay đổi lợi suất → xem chênh lệch net worth và ngày hết nợ.

### 3.2 Để sau (Phase 2+)
- Đa tiền tệ với tỉ giá.
- Đăng nhập bằng Google / magic link; xóa tài khoản tự phục vụ (cần Edge Function).
- Nhập sao kê ngân hàng (CSV) và tự phân loại.
- Chia sẻ ngân sách hộ gia đình nhiều người.
- Lấy giá cổ phiếu/vàng tự động qua API.

### 3.3 Ngoài phạm vi
- Kết nối trực tiếp tài khoản ngân hàng, thực hiện giao dịch tài chính thật, tư vấn đầu tư.

## 4. Yêu cầu phi chức năng

| Nhóm | Yêu cầu |
|------|---------|
| **Chính xác** | Tiền lưu số nguyên (đồng). Mọi công thức có unit test với số liệu kỳ vọng. Tổng các phần luôn bằng tổng thể (không lệch 1 đồng do làm tròn). |
| **Riêng tư & bảo mật** | Mọi bảng bật Row Level Security: người dùng chỉ đọc/ghi dữ liệu của mình. Trình duyệt chỉ giữ publishable key. Không analytics bên thứ ba. |
| **Toàn vẹn** | Không cho xóa thực thể còn được tham chiếu nếu không chọn cách xử lý (gộp/chuyển). Mọi thao tác ghi nhiều bảng chạy trong transaction DB. |
| **Hiệu năng** | 10.000 giao dịch vẫn mở dashboard < 1s. |
| **Khả dụng** | Tiếng Việt, định dạng `1.234.567 ₫`, ngày `dd/MM/yyyy`. Responsive (điện thoại là màn hình chính khi nhập giao dịch). Chế độ sáng/tối. |
| **Tiếp cận** | Biểu đồ luôn có bảng số liệu thay thế; không chỉ dùng màu để phân biệt. |
| **Bền vững** | Schema DB có version + migration; file backup có `schemaVersion`. |

## 5. Giả định đã chốt (người dùng xác nhận 24/09/2026)

| # | Giả định | Lý do |
|---|----------|-------|
| G1 | **"Quỹ"** = quỹ mục tiêu/quỹ dự phòng (tiền để riêng cho một mục đích). **Chứng chỉ quỹ đầu tư** thuộc nhóm *Đầu tư*. | Tiếng Việt dùng "quỹ" cho cả hai nghĩa |
| G2 | Một tiền tệ duy nhất (VND) ở MVP | Giảm độ phức tạp; cấu trúc dữ liệu vẫn chừa trường `currency` |
| G3 | ~~Một người dùng, local-first~~ → **Nhiều người dùng, mỗi người một tài khoản** (Supabase Auth), dữ liệu trên cloud, đồng bộ mọi thiết bị; deploy Vercel | Người dùng đổi hướng 24/09/2026: GitHub + Vercel free + Supabase |
| G4 | Tiết kiệm có kỳ hạn tính vào net worth theo **gốc + lãi dồn tích đến hôm nay** (có tùy chọn "chỉ tính gốc" – thận trọng) | Phản ánh đúng giá trị kinh tế |
| G5 | Ngân sách theo **tháng dương lịch**, có tùy chọn ngày bắt đầu kỳ (VD ngày 5 – ngày nhận lương) | Nhiều người nhận lương giữa tháng |
| G6 | Ngân sách mặc định **zero-based**: mọi đồng thu nhập dự kiến đều được phân bổ | Người dùng chọn |
