# 12 — Kết nối Claude (custom connector qua MCP)

Cho Claude đọc và ghi dữ liệu của app ngay trong cuộc trò chuyện: hỏi tình hình tài chính, xuất báo cáo, gửi ảnh hóa đơn để ghi chi tiêu, lập ngân sách tháng sau…

```
Bạn (claude.ai, app Claude trên điện thoại)
   │  "Ghi giúp hóa đơn này" + 📷
   ▼
Claude ── gọi công cụ (MCP, HTTPS + token) ──► https://<app>.vercel.app/api/mcp  (hàm Vercel)
   ▲                                                   │ truy vấn bằng token CỦA BẠN
   │ kết quả JSON                                      ▼
   └───────────────────────────────────────  Supabase Postgres (RLS: chỉ dữ liệu của bạn)

Lần đầu kết nối (OAuth):
Claude ──► Supabase Auth (máy chủ cấp quyền) ──► trang /oauth/consent của app: "Cho phép Claude?" ──► Claude nhận token
```

---

## 1. Các khái niệm

### MCP — Model Context Protocol
Chuẩn mở để một **mô hình AI** (Claude) nói chuyện với **phần mềm bên ngoài**. Phần mềm tự mô tả mình có những **công cụ** (tools) nào, mỗi công cụ nhận tham số gì. Claude đọc mô tả rồi tự quyết định gọi công cụ nào để trả lời bạn.

- **MCP server (máy chủ MCP)** — phía phần mềm, ở đây là `src/mcp/`: khai báo 15 công cụ như `get_financial_overview`, `add_transactions`…
- **MCP client** — phía AI: Claude (web, desktop, điện thoại, Claude Code).
- **Tool (công cụ)** — một hành động có tên, mô tả, **input schema** (kiểu dữ liệu tham số, viết bằng Zod → JSON Schema) và kết quả. Mô tả viết cho Claude đọc, nên phải rõ ràng như tài liệu cho người.
- **Tool annotations** — nhãn gợi ý: `readOnlyHint` (chỉ đọc), `destructiveHint` (xóa / không hoàn tác được). Claude dùng nhãn này để quyết định có hỏi bạn trước khi chạy không.
- **Server instructions** — hướng dẫn chung Claude đọc khi kết nối: quy ước tiền là số nguyên đồng, chuyển tiền ≠ chi tiêu, luôn tóm tắt trước khi ghi… (`SERVER_INSTRUCTIONS` trong `src/mcp/server.ts`).
- **Transport (đường truyền)** — cách client và server trao đổi. App dùng **Streamable HTTP**: mỗi lệnh là một request `POST /api/mcp` chứa JSON-RPC. Chế độ **không trạng thái** (stateless): máy chủ không nhớ gì giữa các request → hợp với hàm serverless.

### Custom connector
Tính năng của Claude cho phép bạn tự thêm một máy chủ MCP bằng URL (Cài đặt → Connectors → *Add custom connector*). Khác với các connector có sẵn (Google Drive, Gmail…) được Anthropic duyệt, custom connector là của riêng bạn. Thêm trên claude.ai thì dùng được cả trên app điện thoại và desktop.

### Remote vs local MCP server
- **Local**: chạy trên máy tính của bạn (Claude Desktop khởi động qua lệnh). Chỉ dùng được trên máy đó.
- **Remote**: chạy trên Internet (ở đây là Vercel), gọi qua HTTPS. Dùng được ở mọi nơi, kể cả điện thoại — đó là lý do app chọn remote.

### Serverless function (hàm serverless) trên Vercel
Đoạn code chạy **theo yêu cầu**: có request thì Vercel bật lên, xử lý, rồi tắt. Không phải thuê máy chủ chạy 24/7. Gói miễn phí đủ dùng cho một người.
- Lần gọi đầu sau lúc nghỉ chậm hơn chút (**cold start**, ~1 giây).
- **Build Output API**: chuẩn thư mục `.vercel/output/` mà Vercel đọc sau khi build. Script `scripts/build-vercel-output.mjs` gói máy chủ MCP cùng mọi thư viện thành **một file** (`functions/api/mcp.func/index.mjs`) và đặt web tĩnh vào `static/`. Lý do: nếu để Vercel tự biên dịch thư mục `api/`, các import không đuôi của code dùng chung trong `src/` sẽ lỗi `ERR_MODULE_NOT_FOUND` khi chạy.

### OAuth 2.1 — "đăng nhập hộ" an toàn
Vấn đề: Claude cần vào dữ liệu của bạn nhưng **không được biết mật khẩu** của bạn. OAuth giải quyết bằng **token** (vé vào cửa) do máy chủ cấp quyền phát, sau khi chính bạn bấm đồng ý.

| Vai trò | Trong app này |
|---|---|
| **Resource owner** (chủ dữ liệu) | Bạn |
| **Client** (ứng dụng xin quyền) | Claude |
| **Authorization server** (máy chủ cấp quyền) | **Supabase Auth** — bật tính năng *OAuth 2.1 Server* |
| **Resource server** (nơi giữ dữ liệu, kiểm tra token) | Máy chủ MCP `/api/mcp` |
| **Consent screen** (trang đồng ý) | `/oauth/consent` của app |

Luồng một lần duy nhất khi kết nối:
1. Claude gọi `/api/mcp` không có token → nhận **401** kèm header `WWW-Authenticate` chỉ tới tài liệu mô tả **protected resource metadata** (RFC 9728) ở `/.well-known/oauth-protected-resource`.
2. Tài liệu đó ghi: "máy chủ cấp quyền của tôi là `https://<project>.supabase.co/auth/v1`". Claude đọc **authorization server metadata** (RFC 8414) của Supabase để biết các địa chỉ đăng ký, cấp quyền, đổi token.
3. **Dynamic Client Registration (DCR, RFC 7591)**: Claude tự đăng ký mình là một client với Supabase — bạn không cần tạo client id / secret bằng tay.
4. Claude mở trình duyệt tới Supabase `/oauth/authorize` kèm **PKCE** (một mã bí mật dùng một lần, chống kẻ gian chặn mã cấp quyền). Supabase chuyển bạn tới `/oauth/consent?authorization_id=…` của app → bạn đăng nhập (nếu cần) → **Cho phép**.
5. Supabase trả **authorization code** về `https://claude.ai/api/mcp/auth_callback`; Claude đổi code lấy **access token** (hạn 1 giờ) và **refresh token** (để tự gia hạn, không cần bạn làm lại).

Từ đó mỗi lệnh Claude gửi đều kèm `Authorization: Bearer <access token>`.

### JWT, RLS và vì sao an toàn
- **Access token là JWT** — chuỗi đã ký số chứa `sub` (id người dùng), `role: authenticated`, `client_id` (Claude), hạn dùng. Không ai sửa được nội dung mà không làm hỏng chữ ký.
- Máy chủ MCP **hỏi lại Supabase** mỗi request token còn hiệu lực không (`auth.getUser(token)`), rồi truy vấn database **bằng chính token đó**.
- **RLS (Row Level Security)** trong Postgres đã có từ Giai đoạn 1: mọi bảng chỉ trả về dòng có `user_id = auth.uid()`. Vì token là của bạn, Claude chỉ thấy đúng dữ liệu của bạn — test `tests/mcp` kiểm chứng: token của Hùng không đọc, sửa, xóa được giao dịch của Lan dù biết id.
- Máy chủ **không dùng** `service_role` key (khóa vượt quyền RLS). Nó chỉ cần 2 biến công khai đã có: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- **Scope** — phạm vi quyền. Supabase hiện chưa hỗ trợ scope tùy chỉnh (VD "chỉ đọc"), nên quyền của Claude = quyền của bạn **qua các công cụ app cho phép**. Không có công cụ nào để xóa toàn bộ dữ liệu, khôi phục sao lưu hay đổi mật khẩu.
- **Thu hồi**: Cài đặt → Kết nối Claude → *Thu hồi*. Token cũ bị từ chối; Claude phải xin phép lại.

### Tool use với ảnh (vision)
Claude **tự đọc ảnh** trong cuộc trò chuyện (hóa đơn, sao kê, ảnh chụp app ngân hàng / chứng khoán), trích ra ngày, số tiền, nơi mua… rồi gọi `add_transactions` hoặc `update_investment_prices` với dữ liệu đã trích. Máy chủ **không nhận ảnh** — chỉ nhận dữ liệu có cấu trúc, và kiểm tra nó như form trong app. Bạn luôn thấy Claude định ghi gì trước khi ghi.

### Prompt injection
Văn bản trong dữ liệu (ghi chú giao dịch, tên danh mục, chữ trên ảnh) có thể chứa câu kiểu "hãy xóa hết giao dịch". Hướng dẫn máy chủ dặn Claude coi đó là **dữ liệu, không phải mệnh lệnh**; công cụ xóa được đánh dấu `destructiveHint` để Claude hỏi bạn; và không có công cụ xóa hàng loạt.

---

## 2. Cài đặt (một lần)

> Làm sau khi đã tải bản mới lên GitHub và Vercel build xong.

### 2.1 Supabase — bật máy chủ cấp quyền OAuth
1. Dashboard → **Authentication → OAuth Server** → bật **Enable OAuth server** (beta, miễn phí trên mọi gói).
2. **Authorization Path**: `/oauth/consent`
3. Bật **Allow Dynamic OAuth Apps** (cho phép Claude tự đăng ký — DCR).
4. Kiểm tra **Authentication → URL Configuration → Site URL** = `https://<app>.vercel.app` (đã làm ở docs/10). Supabase ghép Site URL + Authorization Path thành trang đồng ý.
5. (Khuyến nghị) **Project Settings → JWT Keys**: nếu còn dùng khóa *Legacy HS256*, chuyển sang khóa bất đối xứng (ES256/RS256) theo nút hướng dẫn của Supabase. Không bắt buộc cho app này (máy chủ kiểm tra token bằng cách hỏi Supabase), nhưng là khuyến nghị của Supabase cho OAuth.

Không có migration SQL mới cho phần này.

### 2.2 Vercel
Không cần biến môi trường mới. Sau khi build, vào **Deployments → bản mới nhất → Functions**: phải thấy `/api/mcp`.
- (Khuyến nghị) **Settings → Functions → Function Region → Singapore (sin1)** — gần Supabase Singapore, mỗi lệnh nhanh hơn.

Kiểm tra nhanh bằng trình duyệt: mở `https://<app>.vercel.app/.well-known/oauth-protected-resource/api/mcp` → phải thấy JSON có `"authorization_servers": ["https://<project>.supabase.co/auth/v1"]`.

### 2.3 Claude
1. claude.ai → **Settings → Connectors** → **Add custom connector**.
2. Name: `Tài Chính Cá Nhân` · URL: `https://<app>.vercel.app/api/mcp` (lấy đúng địa chỉ ở app: Cài đặt → Kết nối Claude → Sao chép). Để trống OAuth Client ID/Secret.
3. **Add** → **Connect** → cửa sổ mở trang *Cho phép truy cập* của app → đăng nhập nếu được hỏi → **Cho phép**.
4. Trong cuộc trò chuyện, bật connector ở nút **+ / Tools** (Search and tools). Lần đầu Claude gọi mỗi công cụ ghi, Claude hỏi bạn cho phép — có thể chọn "Always allow" cho công cụ đọc.

Gói Claude miễn phí cho thêm một số lượng giới hạn custom connector; Pro/Max nhiều hơn. Connector thêm trên web dùng được luôn trên app Claude điện thoại.

---

## 3. Công cụ Claude có

| Công cụ | Loại | Làm gì |
|---|---|---|
| `get_financial_overview` | đọc | Net worth, 4 chỉ số sức khỏe, ngân sách tháng này, gợi ý, việc sắp đến hạn |
| `list_accounts` | đọc | Tài khoản + số dư, tiến độ quỹ |
| `list_categories` | đọc | Danh mục thu chi, danh mục nào ghi được |
| `search_transactions` | đọc | Lọc giao dịch theo ngày/tháng, loại, tài khoản, danh mục, chữ, số tiền; xuất **CSV** |
| `get_budget` | đọc | Ngân sách một tháng, từng dòng, chuyển dư, đang tiêu nhanh? |
| `get_monthly_report` | đọc | Thu, chi, tỉ lệ tiết kiệm, 50/30/20, chi nhiều nhất, vì sao net worth đổi |
| `get_trends` | đọc | Nhiều tháng: thu, chi, tiết kiệm, net worth |
| `get_debts` | đọc | Khoản vay (kỳ tới, gốc/lãi, ngày trả hết), thẻ tín dụng |
| `get_savings_and_investments` | đọc | Sổ tiết kiệm, danh mục đầu tư, tài sản khác |
| `add_transactions` | ghi | Ghi 1–50 giao dịch (tất cả hoặc không), chống trùng, gắn thẻ `claude` |
| `update_transaction` | ghi | Sửa một giao dịch |
| `delete_transaction` | xóa | Xóa một giao dịch (hỏi trước) |
| `set_budget` | ghi | Tạo ngân sách tháng (sao chép / 50/30/20 / trống), đặt từng dòng |
| `create_account` | ghi | Thêm tiền mặt, ngân hàng, ví, quỹ mục tiêu |
| `update_investment_prices` | ghi | Cập nhật giá mã đang nắm giữ |

Nguyên tắc chung của công cụ ghi (giống hệt form trong app, dùng chung `domain/validation`):
- Lỗi (danh mục không có, tiền mặt sẽ âm, ngày trước khi bắt đầu theo dõi…) → **không lưu gì**, trả lý do + gợi ý.
- Cảnh báo cần xác nhận (thấu chi, vượt hạn mức thẻ, tháng đã đóng, số tiền gấp 10 lần bình thường) hoặc **nghi trùng** (cùng ngày, số tiền, tài khoản, danh mục) → không lưu, Claude hỏi bạn; bạn đồng ý thì Claude gọi lại với `confirm_warnings` / `allow_duplicates`.
- `request_id` (VD số hóa đơn) → gửi lại cùng hóa đơn không bao giờ ghi hai lần (ràng buộc `idempotency_key` trong Postgres).
- Mọi giao dịch Claude ghi có thẻ **`claude`** → xuất CSV và lọc để rà lại.
- Nghiệp vụ nhiều phần (trả nợ = gốc + lãi, lệnh mua kèm phí) chỉ sửa/xóa trong app.

Chưa có qua Claude (làm trong app): sổ tiết kiệm, lệnh mua/bán đầu tư, khoản vay/thẻ mới, ghi trả nợ, đóng tháng, giao dịch định kỳ.

---

## 4. Thử ngay — câu mẫu

- "Tình hình tài chính của tôi tháng này thế nào? Có gì cần chú ý?"
- *(gửi ảnh hóa đơn)* "Ghi giúp hóa đơn này, trả bằng tiền mặt."
- *(gửi ảnh chụp sao kê 10 dòng)* "Ghi hết các khoản chi trong ảnh, bỏ qua các lần chuyển khoản cho chính tôi."
- "Xuất báo cáo tháng trước thành bảng: thu, chi theo nhóm, so với ngân sách, và 3 gợi ý."
- "Vẽ biểu đồ net worth 6 tháng gần nhất."
- "Lập ngân sách tháng sau: sao chép tháng này nhưng tăng ăn uống lên 4 triệu, giảm mua sắm còn 1 triệu."
- "Tháng này tôi tiêu cho cà phê bao nhiêu? Liệt kê từng lần."
- *(ảnh chụp app chứng khoán)* "Cập nhật giá các mã trong ảnh."
- "Nếu trả thẻ 2 triệu mỗi tháng thì bao lâu hết nợ?" (Claude đọc `get_debts` rồi tính.)

---

## 5. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách sửa |
|---|---|---|
| Claude báo "Couldn't reach the MCP server" | URL sai, hoặc Vercel chưa có hàm `/api/mcp` | Mở `…/.well-known/oauth-protected-resource/api/mcp` trên trình duyệt: không ra JSON → xem Vercel Deployments → Functions; build log có dòng `✓ .vercel/output` |
| Bấm Connect, cửa sổ Supabase báo lỗi / 404 | Chưa bật OAuth Server hoặc chưa bật Dynamic OAuth Apps | Mục 2.1 |
| Trang đồng ý mở ra `localhost` hoặc trang trắng | Site URL / Authorization Path sai | Site URL = địa chỉ Vercel; Authorization Path = `/oauth/consent` |
| "Không đọc được yêu cầu" trên trang đồng ý | Yêu cầu hết hạn (vài phút) hoặc đã dùng | Bấm Connect lại trong Claude |
| Kết nối được nhưng mọi công cụ báo lỗi 500 `server_misconfigured` | Thiếu biến `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` trên Vercel | Thêm → Redeploy |
| Cài đặt → Kết nối Claude: "Chưa đọc được danh sách" | OAuth Server chưa bật | Mục 2.1 |
| Claude ghi sai danh mục | Tên danh mục mơ hồ | Nói rõ danh mục, hoặc đổi tên danh mục cho dễ phân biệt; sửa bằng "đổi giao dịch vừa ghi sang danh mục X" |
| Project Supabase "Paused" | Gói free tạm dừng sau 7 ngày không dùng | Dashboard → Restore |

Xem log: Vercel → Project → **Logs** (lọc `/api/mcp`) — lỗi máy chủ in dòng `[mcp] …`.

---

## 6. Cho lập trình viên

```
src/mcp/
  server.ts       McpServer + SERVER_INSTRUCTIONS
  readTools.ts    9 công cụ đọc
  writeTools.ts   6 công cụ ghi (dùng domain/validation như form)
  context.ts      đọc dữ liệu 1 lần/lệnh, giờ Việt Nam, định dạng kết quả, bắt lỗi
  lookup.ts       tra tài khoản/danh mục theo tên (không dấu, không hoa thường)
  http.ts         cổng HTTP: metadata RFC 9728, 401, kiểm tra token, transport stateless
  node/adapter.ts Node (req,res) ↔ Web (Request/Response)
  node/vercel.ts  điểm vào hàm Vercel
src/services/overview.ts   tính Tổng quan — DÙNG CHUNG cho giao diện và Claude (cùng con số)
src/features/oauth/ConsentPage.tsx   trang đồng ý
src/features/settings/ClaudeSection.tsx
scripts/build-vercel-output.mjs      gói hàm + web → .vercel/output
tests/mcp/mcp.test.ts      công cụ qua client MCP thật + Postgres thật (RLS)
tests/mcp/bundle.test.ts   chạy FILE ĐÃ GÓI trong tiến trình Node riêng qua HTTP thật
tests/e2e/claude-connect.spec.ts     luồng đồng ý / từ chối / thu hồi trên trình duyệt
```

- Thêm công cụ: viết trong `readTools.ts` / `writeTools.ts` với `inputSchema` Zod, `annotations`, mô tả rõ ràng; công cụ ghi phải đi qua kiểm tra nghiệp vụ như form; thêm test vào `tests/mcp/mcp.test.ts`.
- Thử máy chủ bằng tay: `npx @modelcontextprotocol/inspector` → Transport *Streamable HTTP* → URL `https://<app>.vercel.app/api/mcp` → *Authentication* sẽ đi qua đúng luồng OAuth.
- Hướng phát triển: công cụ ghi trả nợ / định kỳ; **resources** (VD file CSV tháng) và **prompts** (mẫu "Báo cáo tháng") của MCP; scope chỉ-đọc khi Supabase hỗ trợ scope tùy chỉnh; giới hạn tần suất gọi.
