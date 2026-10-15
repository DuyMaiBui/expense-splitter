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

Phần đóng gói (`npm run build:worker`) đã kiểm chứng chạy được. Việc đẩy lên Cloudflare thì
cần tài khoản của bạn và có một điểm cần lưu ý về công cụ:

- **Trong môi trường studio** chỉ được dùng CLI `cf` (hook chặn `wrangler`). `cf` build bằng
  Vite và `cf migrate` cần wrangler cục bộ, nên chưa có đường chính thức cho Next.js qua
  OpenNext. Đây là một gap cần báo cho owner của skill `t1k-cloudflare`, không lách bằng
  wrangler.
- **Ngoài môi trường studio**, các bước dưới đây hoạt động bình thường.

```bash
npx wrangler login
npx wrangler d1 create expense-splitter     # chép database_id in ra vào wrangler.jsonc
npm run db:migrate:remote                   # áp migration lên D1 thật
npm run deploy                              # opennextjs-cloudflare build + deploy
```

`database_id` trong `wrangler.jsonc` đang là giá trị tạm, deploy thật bắt buộc phải thay.

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
