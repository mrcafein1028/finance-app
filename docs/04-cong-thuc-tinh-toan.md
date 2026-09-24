# 04 — Công thức tính toán

Tất cả nằm trong `src/domain/` dưới dạng hàm thuần (đã hiện thực ở Giai đoạn 2, mỗi công thức có test với đúng số liệu dưới đây). Ký hiệu: `round()` = làm tròn nửa lên về **đồng**; `r` = lãi suất năm dạng thập phân (9% → 0,09).

## 1. Tiền & làm tròn

- `Money` = số nguyên đồng. Phép nhân với tỉ lệ/lãi suất → tính bằng decimal → `round()` **một lần ở cuối** mỗi kỳ.
- **Chia không lệch (largest remainder):** chia 1.000.000 cho 3 kỳ → `[333.334, 333.333, 333.333]`, tổng luôn đúng bằng số gốc. Dùng cho: chia gốc vay theo kỳ, phân bổ ngân sách năm → tháng.
- Kỳ cuối của lịch trả nợ **hấp thụ toàn bộ phần lệch** để dư nợ về đúng 0.

## 2. Kỳ ngân sách

Với `periodStartDay = s` và tháng `M` (dạng `YYYY-MM`):
```
start(M) = ngày s của tháng M
end(M)   = start(M+1) − 1 ngày
```
- `s = 1` → tháng dương lịch. `s = 5` → kỳ "2026-09" = 05/09 → 04/10.
- `s` giới hạn 1–28 để mọi tháng đều tồn tại ngày đó.

## 3. Số dư account tại ngày D

```
balance(A, D) = A.openingBalance + Σ effect(t, A)   với mọi t có t.date ≤ D
```
`effect` theo ma trận ở `03 §3.5`. Giá trị dùng cho net worth:

| kind | value(A, D) |
|------|-------------|
| cash, bank, ewallet, goal_fund, loan, credit_card, bnpl, personal_debt | `balance(A, D)` |
| term_deposit | `balance(A, D)` + (nếu `includeAccruedInterest`) `accrued(kỳ đang active, D)` |
| investment | `cashBalance(A, D)` + Σ<sub>holding</sub> `qty(h, D) × price(h.symbol, D)` |
| other_asset | định giá gần nhất `≤ D`, không có thì `openingBalance` |

`cashBalance` của TK đầu tư = `balance(A, D)` − Σ mua `qty×price` + Σ bán `qty×price` (trade đến ngày D, bỏ qua trade `isOpening`).
`price(symbol, D)` = PriceQuote gần nhất `≤ D`; nếu chưa có → dùng giá vốn bình quân (và UI gắn nhãn "chưa cập nhật giá").

## 4. Ngân sách tháng

Cho mỗi dòng ngân sách `L` trong tháng `M`:

```
actual(L)    = category: Σ expense − Σ refund   (danh mục L và các con, trong kỳ M)
               account : Σ transfer vào L.accountId từ account thanh khoản − Σ transfer ngược lại
carryIn(L)   = L.rollover ? available(cùng target, M−1) : 0
available(L) = planned(L) + carryIn(L) − actual(L)
usage(L)     = actual / (planned + carryIn)          (mẫu = 0 → "không có ngân sách")
pace(L, D)   = (planned + carryIn) × daysElapsed / daysInPeriod    // "đáng lẽ chỉ nên tiêu đến"
```
- `carryIn` có thể âm (tháng trước vượt → tháng này bị trừ). Người dùng có thể tắt "chuyển âm" trong cài đặt.
- **Trạng thái dòng:** `usage < 0,8` bình thường · `0,8 ≤ usage < 1` cảnh báo · `= 1` vừa hết · `> 1` vượt · `actual > pace` "đang tiêu nhanh hơn kế hoạch".

**Tổng hợp tháng:**
```
totalPlanned      = Σ planned (mọi dòng, gồm dòng tiết kiệm/trả nợ thêm)
unassigned        = expectedIncome − totalPlanned            // zero-based mục tiêu = 0; < 0 là "phân bổ lố"
actualIncome      = Σ income trong kỳ
actualExpense     = Σ expense − Σ refund trong kỳ
unbudgetedSpend   = actualExpense của các danh mục không có dòng ngân sách (hiện nhóm "Chưa lập ngân sách")
netCashFlow       = actualIncome − actualExpense
```

**Sao chép tháng trước:** copy mọi dòng (planned, rollover); `expectedIncome` = tháng trước hoặc TB thu nhập 3 tháng (người dùng chọn).

## 5. Tiết kiệm có kỳ hạn

```
maturityDate = startDate + termMonths   (nếu ngày không tồn tại → ngày cuối tháng; 31/01 + 1 tháng = 28/02)
days         = maturityDate − startDate
interest     = round(P × r × days / 365)                   // trả cuối kỳ
accrued(D)   = round(P × r × min(D − startDate, days) / 365)
earlyPayout  = round(P × rEarly × (D − startDate) / 365)    // rút trước hạn: mất lãi kỳ hạn
monthlyPart  = round(P × r × daysInSubPeriod / 365)         // trả lãi hàng tháng, mỗi tháng một khoản
```
**Ví dụ:** 100.000.000 ₫, 5,5%/năm, 6 tháng từ 01/03/2026 → đáo hạn 01/09/2026, 184 ngày
→ lãi = 100.000.000 × 0,055 × 184 / 365 = **2.772.603 ₫**.
Rút trước hạn ngày 01/06/2026 (92 ngày) với 0,1%/năm → 100.000.000 × 0,001 × 92/365 = **25.205 ₫**.

**Khi đáo hạn (service `matureDeposit`):**
1. Tạo `income` "Lãi tiết kiệm" = lãi kỳ (vào sổ nếu `renew_with_interest`, còn lại vào `payoutAccountId`).
2. `renew_principal` / `renew_with_interest` → đóng kỳ cũ, mở `DepositTerm` mới (lãi suất mới người dùng xác nhận).
3. `withdraw` → `transfer` gốc sổ → `payoutAccountId`, lưu trữ account.

## 6. Khoản vay

Ký hiệu `P` gốc, `n` số kỳ, `i = r/12` lãi tháng (dùng cho **dự phóng**; khoản trả thực tế người dùng nhập theo sao kê ngân hàng).

| rateType | Gốc kỳ k | Lãi kỳ k | Tổng trả kỳ k |
|----------|----------|----------|---------------|
| `equal_principal` | `P/n` (chia không lệch) | `round(dư nợ đầu kỳ × i)` | giảm dần |
| `annuity` | `PMT − lãi` | `round(dư nợ đầu kỳ × i)` | `PMT = P·i / (1 − (1+i)^−n)` |
| `flat` | `P/n` | `round(P × i)` (cố định trên gốc ban đầu) | cố định |
| `zero` | `P/n` | 0 | cố định |

- **Ngày đến hạn kỳ k** = ngày `paymentDay` của tháng thứ k sau tháng giải ngân (giải ngân 01/08, trả ngày 10 → kỳ 1 là 10/09).
- Khoản vay đang trả: số kỳ còn lại = số ngày đến hạn sau ngày bắt đầu theo dõi; lịch lập trên dư nợ hiện tại.
- `ratePeriods`: lãi kỳ k dùng `annualRate` của giai đoạn chứa ngày đến hạn; khi đổi lãi suất, `annuity` **tính lại PMT** trên dư nợ và số kỳ còn lại.

**Ví dụ kiểm chứng:**
- Annuity 500.000.000 ₫, 10%/năm, 240 tháng → PMT ≈ **4.825.108 ₫/tháng**.
- Gốc đều 1.200.000.000 ₫, 9%/năm, 240 tháng → gốc 5.000.000 ₫/tháng; kỳ 1 lãi 9.000.000 → trả **14.000.000 ₫**; kỳ 240 lãi 37.500 → trả **5.037.500 ₫**.
- Lãi phẳng 12%/năm, 12 tháng ≈ lãi thực (APR) **~21,5%/năm** → hiện insight cảnh báo. APR tính bằng IRR của dòng tiền (Newton–Raphson).

**Ghi nhận một kỳ trả nợ (service `recordLoanPayment`)** — form điền sẵn theo lịch, người dùng sửa theo thực tế:
```
transfer  TK nguồn → khoản vay        amount = principalPart       (dư nợ giảm, không phải chi tiêu)
expense   TK nguồn, "Lãi vay"          amount = interestPart        (chi phí thật)
expense   TK nguồn, "Phí trả nợ trước hạn" (nếu có)
→ cùng groupId; xóa/sửa là xóa/sửa cả nhóm.
```
**Trả trước hạn:** chọn *giảm kỳ hạn* (giữ khoản trả, tính lại n) hoặc *giảm khoản trả* (giữ n, tính lại PMT/gốc kỳ). Phí = `round(số trả trước × prepaymentFeeRate)`.

**Thẻ tín dụng:** chi tiêu quẹt thẻ = `expense` trên account thẻ (dư nợ tăng). Thanh toán thẻ = `transfer` ngân hàng → thẻ. Lãi/phí thẻ ghi `expense` trên thẻ. Tối thiểu phải trả = `round(dư nợ sao kê × minPaymentRate)`. Dự phóng số tháng trả hết với khoản trả cố định `A`: `n = −ln(1 − B·i / A) / ln(1 + i)` (vô nghiệm nếu `A ≤ B·i` — kể cả trả **đúng bằng** tiền lãi — → cảnh báo "không bao giờ trả hết"; so sánh bằng Decimal để không sai vì số thực).

**Ngày trả hết dự kiến** = ngày đến hạn của kỳ cuối trong lịch dự phóng tính từ dư nợ hiện tại.

## 7. Đầu tư (giá vốn bình quân)

```
Mua q_b giá p_b:   avg' = (q × avg + q_b × p_b) / (q + q_b);   q' = q + q_b
Bán q_s giá p_s:   realized = round(q_s × (p_s − avg));        q' = q − q_s;  avg giữ nguyên
marketValue        = round(q × price(D))
costBasis          = round(q × avg)
unrealized         = marketValue − costBasis
returnPct          = unrealized / costBasis
```
Phí/thuế **không** cộng vào giá vốn (đã ghi thành chi phí riêng), UI hiển thị thêm "Lãi/lỗ sau phí" = realized + unrealized − Σ phí & thuế.
Cổ tức tiền mặt = `income` "Cổ tức & lãi đầu tư" vào TK đầu tư hoặc ngân hàng. Cổ tức cổ phiếu = trade `buy` giá 0 (giá vốn bình quân giảm tự nhiên).

## 8. Net worth

```
totalAssets(D)      = Σ value(A, D)  với A.class = asset,     includeInNetWorth, chưa lưu trữ tại D
totalLiabilities(D) = Σ value(A, D)  với A.class = liability, includeInNetWorth
netWorth(D)         = totalAssets − totalLiabilities
liquidAssets(D)     = Σ value(A, D)  với A.isLiquid
```

- **Thấu chi / trả thừa:** tài khoản tài sản có số dư âm được cộng vào `totalLiabilities`; khoản nợ có dư nợ âm được cộng vào `totalAssets`. Net worth không đổi, các tổng luôn ≥ 0; `byAccount`/`byKind` giữ giá trị có dấu.
- Account lưu trữ: không tính từ ngày lưu trữ trở đi; account `includeInNetWorth = false`: không bao giờ tính.

**Phân rã biến động net worth trong kỳ** (cho biểu đồ thác nước):
```
ΔNW = (Σ income − Σ expense + Σ refund)       ← dòng tiền ròng (do bạn kiếm & tiêu)
    + Σ adjustment (±)                         ← điều chỉnh số dư
    + Σ_A [ Δvalue(A) − Σ effect giao dịch lên A ]   ← thay đổi giá thị trường, định giá, lãi dồn tích
```
Transfer triệt tiêu nhau (TS→TS: −x +x; TS→Nợ: TS −x, nợ −x ⇒ NW không đổi), nên đẳng thức luôn đúng → **đây là một test bất biến bắt buộc**.

Các mục hiển thị trên biểu đồ R2 (`explainNetWorthChange`):

| Mục | Nguồn |
|-----|-------|
| Số dư ban đầu | account bắt đầu theo dõi trong kỳ (VD thêm thẻ tín dụng đang nợ 20 tr → −20 tr) |
| Thu nhập / Chi tiêu / Hoàn tiền / Điều chỉnh | giao dịch cùng loại |
| Chuyển ra ngoài | chuyển tiền với account không tính vào NW |
| Thị trường | phần dư của account đầu tư (giá thay đổi) |
| Định giá lại | phần dư của tài sản khác |
| Lãi dồn tích | phần dư của sổ tiết kiệm |
| Khác | account lưu trữ giữa kỳ; với dữ liệu hợp lệ các account tiền luôn = 0 (đã kiểm chứng bằng property test) |

## 9. Chỉ số sức khỏe tài chính

"TB 3 tháng" = trung bình 3 kỳ ngân sách **đã kết thúc** gần nhất (ít hơn 3 thì dùng số kỳ có).

| Chỉ số | Công thức | Tốt | Trung bình | Cần chú ý |
|--------|-----------|-----|------------|-----------|
| Tỉ lệ tiết kiệm | `netCashFlow / actualIncome` | ≥ 20% | 10–20% | < 10% |
| Số tháng quỹ khẩn cấp | `Σ value(isEmergencyFund)` ÷ TB 3 tháng chi *Thiết yếu* (nếu chưa đánh dấu quỹ → dùng `liquidAssets`) | ≥ 6 | 3–6 | < 3 |
| DTI (nợ/thu nhập) | Σ khoản phải trả hàng tháng theo lịch ÷ TB 3 tháng thu nhập | ≤ 30% | 30–40% | > 40% |
| Nợ/tài sản | `totalLiabilities / totalAssets` | ≤ 30% | 30–50% | > 50% |
| Sử dụng hạn mức thẻ | Σ dư nợ thẻ ÷ Σ hạn mức | < 30% | 30–50% | > 50% |
| 50/30/20 | tỉ trọng chi Thiết yếu / Mong muốn / (Tiết kiệm = netCashFlow) trên thu nhập | lệch ≤ 5 điểm % | 5–15 | > 15 |
| Tăng trưởng NW | `(NW_cuối − NW_đầu) / |NW_đầu|` theo tháng, năm | > 0 | ≈ 0 | < 0 |

Chia cho 0 (chưa có thu nhập/chi tiêu) → trả `null`, UI hiện "Chưa đủ dữ liệu", **không bao giờ hiện NaN/∞**.
