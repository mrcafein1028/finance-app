# 06 — Forms & validation

Mỗi form có **một Zod schema** trong `src/schemas/` — dùng chung cho form, import file và kiểm tra ở service (không tin dữ liệu từ UI). Lỗi hiển thị dưới từng trường, tiếng Việt, nói rõ cách sửa.

## Quy ước chung

| Thành phần | Quy tắc |
|------------|---------|
| `MoneyInput` | Tự định dạng `1.234.567`; hiểu `150k`, `2tr`, `2,5tr`, `1ty`; chỉ số nguyên ≥ 0; tối đa 999.999.999.999.999 |
| `RateInput` | Nhập `%/năm` (VD `5,5`) → lưu `0.055`; khoảng 0–100 |
| `DatePicker` | Hiển thị `dd/MM/yyyy`, lưu `YYYY-MM-DD` |
| `AccountSelect` | Nhóm theo loại, hiện số dư hiện tại, ẩn account đã lưu trữ |
| `CategorySelect` | Cây 2 cấp, chỉ chọn được danh mục lá, lọc theo type, ưu tiên dùng gần đây |
| Hành vi | Nút Lưu tắt khi form chưa hợp lệ; Enter = lưu; Esc = đóng (hỏi nếu có thay đổi chưa lưu); không mất dữ liệu khi lỗi |

## Danh sách form

### F1. Giao dịch (Thu / Chi / Hoàn tiền / Chuyển khoản)
| Trường | Bắt buộc | Quy tắc |
|--------|----------|---------|
| type | ✔ | tab chọn |
| amount | ✔ | > 0 |
| date | ✔ | ≥ openingDate của account liên quan |
| accountId | ✔ | chưa lưu trữ; income không được là nợ |
| toAccountId | transfer | ≠ accountId; nếu là nợ: amount ≤ dư nợ |
| categoryId | thu/chi/hoàn | danh mục lá, đúng type |
| note | | ≤ 200 ký tự |
| tags | | ≤ 10 thẻ |
| repeat | | bật → hiện trường của F10 |

Kiểm tra mềm (cảnh báo, không chặn): số dư ngân hàng/ví âm, vượt hạn mức thẻ, số tiền > 10 lần TB danh mục ("Có gõ nhầm số 0?"), trùng giao dịch cùng ngày-số tiền-danh mục trong 2 phút.

### F2. Tài khoản tiền / Quỹ mục tiêu
name (✔, 1–50, duy nhất) · kind (✔) · openingBalance (✔, ≥ 0) · openingDate (✔, ≤ hôm nay) · isEmergencyFund · goal.targetAmount (> 0 nếu có) · goal.targetDate (> hôm nay) · icon, color.

### F3. Sổ tiết kiệm
bankName (✔) · principal (✔, > 0) · annualRate (✔, 0 < r ≤ 20%) · termMonths (✔, chọn 1/3/6/9/12/13/18/24/36 hoặc tùy chỉnh 1–120) · startDate (✔) · interestPayout (✔) · maturityAction (✔) · payoutAccountId (✔, TK thanh khoản) · earlyWithdrawalRate (mặc định 0,1%) · sourceAccountId (✔ nếu "sổ mới"; số dư đủ) · **Xem trước:** ngày đáo hạn, lãi dự kiến.

### F4. Tài khoản đầu tư & Holding
Account: name, platform, tiền mặt ban đầu. Holding: symbol (✔, viết hoa, duy nhất trong account), name, assetType (✔), unit (✔), quantityDecimals (0–8).

### F5. Lệnh mua/bán
holdingId (✔) · side (✔) · date (✔) · quantity (✔, > 0, đúng số chữ số thập phân; bán ≤ số đang nắm tại ngày đó) · price (✔, ≥ 0; = 0 chỉ khi cổ tức cổ phiếu) · fee, tax (≥ 0) · cashAccountId (✔; mua: số dư tiền đủ → nếu không đủ cảnh báo) · **Xem trước:** tổng tiền, giá vốn mới / lãi-lỗ thực hiện.

### F6. Cập nhật giá (hàng loạt)
Bảng các mã đang nắm: giá cũ + ngày → ô giá mới. Chỉ lưu dòng có thay đổi. date mặc định hôm nay. Giá lệch > 50% so với giá cũ → cảnh báo.

### F7. Tài sản khác & Định giá
name, giá trị (✔ ≥ 0), ngày (✔), ghi chú. Định giá: date (✔, > định giá gần nhất hoặc cho phép chèn giữa), value (✔).

### F8. Khoản vay
kind (✔ loan/bnpl/personal_debt) · name (✔) · lender · mode: mới / đang trả (✔) · originalPrincipal (✔ > 0) · currentBalance (✔ nếu đang trả, ≤ originalPrincipal) · rateType (✔) · ratePeriods (≥ 1 dòng; ngày tăng dần; dòng đầu = startDate; 0 ≤ r ≤ 60%) · termMonths (✔ 1–420) · startDate (✔) · paymentDay (✔ 1–28) · prepaymentFeeRate (0–10%) · disbursementAccountId (✔ nếu mới) · **Xem trước:** khoản trả kỳ đầu, tổng lãi, ngày trả hết, APR nếu lãi phẳng.

### F9. Trả nợ
loanId (✔) · date (✔) · sourceAccountId (✔) · principalPart (✔ ≥ 0, ≤ dư nợ) · interestPart (✔ ≥ 0) · feePart (≥ 0) · tổng > 0 · Trả trước: option giảm kỳ hạn/giảm khoản trả (✔). Điền sẵn từ lịch; lệch > 20% so với lịch → cảnh báo nhẹ.

### F10. Thẻ tín dụng
name, issuer, creditLimit (✔ > 0), currentBalance (✔ ≥ 0), statementDay, dueDay (✔ 1–28), annualRate, minPaymentRate (mặc định 5%).

### F11. Ngân sách tháng
expectedIncome (✔ ≥ 0) · mode · mỗi dòng: target (✔, không trùng, không cùng lúc cha+con), planned (✔ ≥ 0), rollover. Chế độ zero-based: cảnh báo khi `unassigned ≠ 0`, không chặn.

### F12. Giao dịch định kỳ
name (✔) · template (theo F1) · frequency (✔) · interval (✔ 1–12) · dayOfMonth (1–31, 31 = cuối tháng) · startDate (✔) · endDate (> startDate) · mode auto/confirm.

### F13. Danh mục
name (✔ 1–40, duy nhất trong cha) · type (✔, không đổi được khi đã có giao dịch) · parentId (cha phải cùng type, cha không được là con) · bucket (expense).

### F14. Cài đặt & Sao lưu
periodStartDay (1–28; đổi → cảnh báo "các kỳ ngân sách cũ giữ nguyên, kỳ mới áp dụng từ tháng sau") · includeAccruedInterest · emergencyTargetMonths (1–24) · theme · Import file (≤ 50MB, JSON đúng `app` + `schemaVersion`).

### F15. Tài khoản người dùng (`src/schemas/auth.ts`)
| Form | Trường & quy tắc |
|------|------------------|
| Đăng nhập | email (✔, hợp lệ, tự bỏ khoảng trắng) · password (✔) |
| Đăng ký | email (✔) · password (✔ 8–72 ký tự) · confirmPassword (✔ khớp password) |
| Quên mật khẩu | email (✔) |
| Đặt lại mật khẩu | password (✔ 8–72) · confirmPassword (✔ khớp) |

Lỗi từ Supabase Auth được đổi sang tiếng Việt tại `src/features/auth/authErrors.ts`; lỗi chung của form hiển thị trong hộp `role="alert"` đầu form.
