# 07 — Biểu đồ & insight

Nguyên tắc: **mỗi biểu đồ trả lời đúng một câu hỏi**. Biểu đồ nào không trả lời được câu hỏi của người dùng thì bỏ. Mọi biểu đồ có tooltip số liệu chính xác, bảng số liệu thay thế, trạng thái rỗng có hướng dẫn ("Thêm giao dịch đầu tiên để thấy…").

## 1. Dashboard (trang chủ) — thứ tự từ trên xuống

| # | Thành phần | Câu hỏi trả lời | Dạng |
|---|-----------|-----------------|------|
| D1 | **Thẻ Net worth** | Tôi đang có bao nhiêu? Thay đổi thế nào so với tháng trước? | Số lớn + Δ tháng (₫, %) + sparkline 12 tháng |
| D2 | **Thẻ chỉ số** (4 ô) | Sức khỏe tài chính ra sao? | Tỉ lệ tiết kiệm · Tháng quỹ khẩn cấp · DTI · Nợ/tài sản — màu + nhãn chữ (Tốt/TB/Chú ý) |
| D3 | **Ngân sách tháng này** | Còn được tiêu bao nhiêu? | Thanh tổng (đã chi/kế hoạch + vạch pace) + 5 dòng sát ngưỡng nhất |
| D4 | **Insight** (tối đa 3) | Tôi cần chú ý điều gì? | Thẻ câu văn, có nút đi tới chỗ xử lý |
| D5 | **Sắp tới** | Tuần tới có khoản gì? | Danh sách: kỳ trả nợ, sổ đáo hạn, định kỳ |
| D6 | **Giao dịch gần đây** | Tôi vừa ghi gì? | 5 dòng cuối |

## 2. Trang Báo cáo

| # | Biểu đồ | Câu hỏi | Dạng & chi tiết |
|---|---------|---------|-----------------|
| R1 | **Net worth theo thời gian** | Tôi có đang giàu lên không? | Cột chồng tài sản (dương) / nợ (âm) + đường net worth; chọn 6T / 1N / 3N / Tất cả |
| R2 | **Thác nước biến động NW** | Vì sao net worth tháng này thay đổi? | Waterfall: NW đầu kỳ → + Thu nhập → − Chi tiêu → ± Thị trường/định giá → ± Lãi dồn tích → ± Điều chỉnh → NW cuối kỳ (04 §8) |
| R3 | **Phân bổ tài sản** | Tiền của tôi nằm ở đâu? | Donut theo kind (tiền mặt & NH, quỹ, tiết kiệm, đầu tư, tài sản khác) + drill-down từng account; thêm thanh "thanh khoản vs không thanh khoản" |
| R4 | **Kế hoạch vs thực tế** | Tôi vượt ngân sách ở đâu? | Bar ngang theo danh mục: thanh kế hoạch (nền) + thực tế (đậm), sắp xếp theo mức vượt |
| R5 | **Xu hướng chi tiêu** | Chi tiêu của tôi tăng hay giảm? | Cột chồng theo nhóm danh mục, 12 tháng + đường TB 3 tháng |
| R6 | **Dòng tiền tháng** | Thu nhập đi đâu? | Sankey: Nguồn thu → Thiết yếu / Mong muốn / Tiết kiệm / Trả nợ → danh mục (fallback: bar chồng nếu ít dữ liệu) |
| R7 | **Tỉ lệ tiết kiệm theo tháng** | Tôi tiết kiệm có đều không? | Đường + vùng mục tiêu 20% |
| R8 | **50/30/20 thực tế** | Cơ cấu chi tiêu có cân bằng? | 3 thanh so với mục tiêu |
| R9 | **Lộ trình trả nợ** | Bao giờ hết nợ? | Area dư nợ dự phóng theo từng khoản; mốc "hết nợ"; so sánh kịch bản trả thêm X/tháng |
| R10 | **Gốc vs lãi** | Mỗi khoản trả bao nhiêu là lãi? | Cột chồng gốc/lãi theo kỳ cho 1 khoản vay |
| R11 | **Hiệu quả đầu tư** | Khoản đầu tư nào lãi/lỗ? | Bar lãi/lỗ theo holding (₫ và %), giá vốn vs giá trị thị trường |
| R12 | **Tiến độ quỹ mục tiêu** | Bao giờ đạt mục tiêu? | Thanh tiến độ + dự phóng ngày đạt theo tốc độ góp TB |
| R13 | **Lịch đáo hạn tiết kiệm** | Tiền nào sắp về? | Timeline các sổ, độ lớn = gốc |
| R14 | **Heatmap chi tiêu theo ngày** | Tôi hay tiêu nhiều vào ngày nào? | Lịch tháng tô màu theo tổng chi/ngày |

Bộ lọc chung: khoảng thời gian, account, nhóm danh mục. Bấm vào cột/lát → mở danh sách giao dịch đã lọc tương ứng (drill-through).

## 3. Bộ sinh insight (`domain/insights.ts`)

Mỗi luật = hàm thuần `(dữ liệu) → Insight | null`, có mức độ ưu tiên; Dashboard lấy 3 insight ưu tiên cao nhất.

| Mã | Điều kiện | Câu hiển thị (mẫu) | Ưu tiên |
|----|-----------|--------------------|---------|
| I-OVER | Dòng ngân sách `usage ≥ 1` | "Ăn uống đã vượt 12% (360.000 ₫) ngân sách tháng." | Cao |
| I-PACE | `actual > pace × 1,2` và `usage < 1` | "Với tốc độ hiện tại, Mua sắm sẽ vượt ngân sách vào khoảng ngày 21." | Cao |
| I-EMERG | Tháng quỹ khẩn cấp < 3 | "Quỹ khẩn cấp đủ cho 1,8 tháng. Cần thêm 14,6 tr để đạt 3 tháng." | Cao |
| I-FLAT | Có khoản vay lãi phẳng | "Khoản vay X lãi phẳng 12% tương đương ~21,5%/năm thực tế." | Cao |
| I-CARD | Hạn mức thẻ dùng > 50% hoặc chỉ trả tối thiểu 2 kỳ liên tiếp | "Chỉ trả tối thiểu, dư nợ thẻ sẽ mất ~4 năm để trả hết." | Cao |
| I-MATURE | Sổ đáo hạn ≤ 7 ngày | "Sổ 100 tr tại ABC đáo hạn ngày 01/10 — lãi dự kiến 2,77 tr." | TB |
| I-TREND | Danh mục chi tháng này > TB 3 tháng × 1,3 | "Chi Đi lại tăng 45% so với trung bình 3 tháng." | TB |
| I-SAVE | Tỉ lệ tiết kiệm tháng trước ≥ 20% | "Bạn đã tiết kiệm 24% thu nhập tháng 8 — vượt mục tiêu 20%." | Thấp (tích cực) |
| I-NWHIGH | NW đạt mức cao nhất mọi thời điểm | "Net worth đạt mức cao nhất từ trước đến nay." | Thấp |
| I-PREPAY | Có tiền nhàn rỗi > quỹ khẩn cấp mục tiêu và có nợ lãi cao hơn lãi tiết kiệm | "Trả trước 20 tr khoản vay 14% sẽ tiết kiệm ~X ₫ lãi." (mang tính thông tin, không phải tư vấn) | TB |
| I-STALE | Giá đầu tư chưa cập nhật > 30 ngày | "Giá 3 mã đầu tư đã cũ — net worth có thể chưa chính xác." | TB |
| I-UNBUDGET | Chi tiêu chưa lập ngân sách > 10% tổng chi | "1,2 tr chi tiêu chưa thuộc dòng ngân sách nào." | TB |

Insight nào đã bị người dùng "Ẩn" sẽ không hiện lại trong cùng kỳ.

## 4. Quy ước hiển thị

- Số tiền rút gọn trên trục/nhãn: `1,2 tr`, `3,5 tỷ`; tooltip luôn hiển thị số đầy đủ.
- Màu: tài sản/thu = xanh, nợ/chi = đỏ-cam, trung tính = xám; luôn kèm dấu `+/−` hoặc nhãn chữ.
- Dark mode: dùng token màu, kiểm tra độ tương phản ≥ 4.5:1 cho chữ.
- Mobile: biểu đồ cuộn ngang được khi > 6 cột; donut thay bằng bar ngang dưới 360px.
