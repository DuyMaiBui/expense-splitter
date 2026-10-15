# Chia tiền nhóm

Ứng dụng chia sẻ chi tiêu trong nhóm, giao diện tiếng Việt. Người dùng đăng ký bằng
tên đăng nhập và mật khẩu, tham gia nhiều nhóm, thêm bạn bè vào nhóm, ghi lại các khoản chi
chia đều cho những thành viên được chọn, xem nhật ký hoạt động đầy đủ theo thời gian và xem
trang tất toán (ai trả ai bao nhiêu).

Chạy trên **Cloudflare Workers + D1** (serverless) thông qua **Next.js App Router** và
`@opennextjs/cloudflare`.

## Yêu cầu

- Node.js 22.5 trở lên (script migrate local dùng `node:sqlite`; đã kiểm thử trên Node 26)
- npm 10 trở lên
- Một tài khoản Cloudflare (chỉ cần khi triển khai thật)

## Chạy ở máy cục bộ

```bash
npm install
npm run dev                 # mở http://localhost:3000 một lần để tạo DB D1 mô phỏng
npm run db:migrate:local    # áp migrations/*.sql vào DB local (chỉ local, không đụng Cloudflare)
```

Từ đó `/` chuyển sang `/groups`, và chưa đăng nhập sẽ được đưa tới `/login`.
`next dev` đọc binding D1 `DB` từ `wrangler.jsonc` nhờ `initOpenNextCloudflareForDev()`.

## Kiểm thử

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run (xác thực, validate, chia tiền, tất toán)
npm run build       # next build
npm run build:worker  # đóng gói Worker bằng OpenNext -> .open-next/worker.js
```

## Cấu trúc dự án

```
app/                  # Next.js App Router: trang + API route
components/           # AppHeader, GroupNav, ExpenseForm
lib/                  # types, errors, http, validate, db, auth, activity, api-client, format,
                      # group-queries, expenses, split (chia tiền), settle (tất toán)
migrations/           # migration D1 (0001_init.sql)
scripts/              # migrate-local.mjs
docs/CONTRACT.md      # hợp đồng API (nguồn chân lý)
proxy.ts              # chặn truy cập chưa đăng nhập (quy ước "proxy" của Next.js 16)
```

## Triển khai lên Cloudflare

Ứng dụng chạy trên Workers (OpenNext) với D1. Cách đang dùng: kết nối repo GitHub vào
Workers Builds trong dashboard Cloudflare (build `npx opennextjs-cloudflare build`, deploy
`npx opennextjs-cloudflare deploy`, biến `NODE_VERSION=22`); mỗi lần push lên `main` là tự deploy.

- Migration áp lên D1 thật theo thứ tự `migrations/0001_*.sql`, `0002_*.sql`, ... (dán vào
  console D1 của dashboard, hoặc dùng `cf d1` trong môi trường studio, nơi hook chặn `wrangler`).
- `database_id` trong `wrangler.jsonc` là D1 thật của dự án.
- Cục bộ: `npm run dev`, rồi `npm run db:migrate:local` để tạo bảng và index trên D1 giả lập.

## Mục mẫu (đơn giá có sẵn)

Mỗi nhóm có danh sách mục mẫu: tên và giá một đơn vị (ví dụ "Quả cầu lông" 29.000đ). Trong form
thêm chi tiêu, chọn mục mẫu rồi nhập số lượng thì số tiền tự tính; vẫn nhập thẳng số tiền được
như bình thường. Trang **Mục mẫu** cho thêm, sửa, xóa và **đồng bộ từ nhóm khác** mà bạn đã tham
gia (mục trùng tên được giữ nguyên, tùy chọn cập nhật giá). Bảng `expense_presets` nằm trong
`migrations/0003_presets.sql`.

## Giới hạn Cloudflare Free và cách app tiết kiệm

Gói Free tính **theo ngày**, reset lúc 00:00 UTC (7 giờ sáng giờ Việt Nam), không có hạn mức tháng:

| Tài nguyên | Giới hạn Free mỗi ngày |
|---|---|
| Worker requests | 100.000 (vượt thì lỗi 1027 tới 00:00 UTC) |
| CPU mỗi request | 10 ms |
| D1 rows read | 5.000.000 |
| D1 rows written | 100.000 |
| D1 storage | 5 GB tổng |

File tĩnh (JS, CSS) không tính vào hạn mức request của Worker. App giảm số request như sau:

- Client cache GET 30 giây, gộp GET trùng, chỉ xóa cache sau thao tác ghi liên quan.
- Trang chi tiêu trả cả danh sách lẫn thành viên trong **một** request, tối đa 300 khoản mới nhất.
- Mọi `<Link>` đặt `prefetch={false}` để không tự gọi Worker khi rê chuột.
- Session cache 30 giây mỗi isolate; kiểm tra thành viên nhóm là một truy vấn.
- Rate limit theo IP: đăng nhập/đăng ký 10 lần/phút, API khác 120 lần/phút (binding
  `ratelimits` trong `wrangler.jsonc`, có dự phòng trong bộ nhớ).
- `0002_indexes.sql` thêm index cho danh sách chi tiêu và bỏ hai index thừa.

## Ghi chú kỹ thuật

- **Tiền tệ** là số nguyên đồng (VND), không dùng số thập phân; hiển thị dạng `120.000đ`.
- **Chia đều**: phần lẻ được cộng 1 đồng cho những thành viên đầu tiên theo thứ tự id tăng dần,
  nên tổng các phần luôn bằng đúng số tiền của khoản chi.
- **Xoá mềm**: thành viên bị xoá (`removed_at`) và khoản chi bị xoá (`deleted_at`) vẫn được giữ
  để nhật ký và lịch sử đọc được; thành viên đã xoá vẫn có mặt trong tất toán nếu còn số dư.
- **Mật khẩu** băm PBKDF2-SHA256 (100.000 vòng) qua WebCrypto, mỗi mật khẩu một muối riêng.
  DB chỉ lưu SHA-256 của token phiên, không lưu token gốc.
- **Nhật ký hoạt động**: mỗi thao tác ghi một dòng `activity_log` trong cùng batch D1 với thao
  tác đó, nên nhật ký luôn khớp dữ liệu.
- Chi tiết API, mã lỗi, lược đồ dữ liệu: [`docs/CONTRACT.md`](docs/CONTRACT.md).
