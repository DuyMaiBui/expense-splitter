# Chia tiền nhóm

Ứng dụng chia sẻ chi tiêu trong nhóm, giao diện tiếng Việt. Người dùng đăng ký bằng
tên đăng nhập và mật khẩu, tham gia nhiều nhóm, thêm bạn bè vào nhóm, ghi lại các khoản chi
chia đều cho những thành viên được chọn, xem nhật ký hoạt động đầy đủ theo thời gian và xem
trang tất toán (ai trả ai bao nhiêu).

Chạy trên **Cloudflare Workers + D1** (serverless) thông qua **Next.js App Router** và
`@opennextjs/cloudflare`.

## Yêu cầu

- Node.js 20 trở lên (khuyến nghị 22+; đã phát triển và kiểm thử trên Node 26)
- npm 10 trở lên
- Một tài khoản Cloudflare (chỉ cần khi triển khai thật)

## Cài đặt

```bash
npm install
```

## Chạy ở máy cục bộ

```bash
# 1. Tạo cơ sở dữ liệu D1 mô phỏng ở máy và áp dụng migration
npm run db:migrate:local

# 2. Chạy máy chủ phát triển
npm run dev
```

Mở http://localhost:3000. Ứng dụng tự chuyển hướng `/` sang `/groups`, và `/groups` yêu cầu
đăng nhập nên bạn sẽ được đưa tới `/login`.

`next dev` đọc các binding trong `wrangler.jsonc` nhờ `initOpenNextCloudflareForDev()` trong
`next.config.ts`, nên binding D1 tên `DB` có sẵn ngay khi phát triển cục bộ.

## Kiểm thử và kiểm tra kiểu

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
```

## Cấu trúc dự án

```
app/                  # Next.js App Router (trang, layout, CSS toàn cục)
components/           # AppHeader, GroupNav
lib/                  # types, errors, http, validate, db, auth, activity, api-client, format
migrations/           # migration D1 (0001_init.sql)
docs/CONTRACT.md      # hợp đồng tích hợp API (nguồn chân lý)
wrangler.jsonc        # cấu hình Worker + binding D1 + thư mục migration
proxy.ts              # chặn truy cập chưa đăng nhập (quy ước "proxy" của Next.js 16)
```

## Triển khai lên Cloudflare

### 1. Đăng nhập

```bash
npx wrangler login
```

### 2. Tạo cơ sở dữ liệu D1

```bash
npx wrangler d1 create expense-splitter
```

Lệnh này in ra một `database_id`. Sao chép giá trị đó vào `wrangler.jsonc`, thay cho
`database_id` đang là giá trị tạm `00000000-0000-0000-0000-000000000000`.

> Migration cục bộ (`--local`) chạy được với giá trị tạm, nhưng triển khai thật thì bắt buộc
> phải có `database_id` chính xác.

### 3. Áp dụng migration lên cơ sở dữ liệu thật

```bash
npm run db:migrate:remote
```

Kiểm tra lại bằng:

```bash
npx wrangler d1 execute expense-splitter --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

### 4. Triển khai

```bash
npm run deploy
```

`npm run deploy` chạy `opennextjs-cloudflare build` rồi `opennextjs-cloudflare deploy`.

Để xem trước bản dựng trong môi trường Workers ngay trên máy:

```bash
npm run preview
```

## Ghi chú kỹ thuật

- **Tiền tệ** là số nguyên đồng (VND), không bao giờ dùng số thập phân; hiển thị dạng
  `120.000đ`.
- **Chia đều**: hoà giải phần lẻ bằng cách cộng 1 đồng cho những thành viên đầu tiên theo thứ
  tự id tăng dần, nên tổng các phần luôn bằng đúng số tiền của khoản chi.
- **Xoá mềm**: thành viên bị xoá (`removed_at`) và khoản chi bị xoá (`deleted_at`) vẫn được giữ
  lại để nhật ký và lịch sử vẫn đọc được.
- **Mật khẩu** được băm bằng PBKDF2-SHA256 (100.000 vòng lặp) qua WebCrypto, mỗi mật khẩu có
  muối riêng. Cơ sở dữ liệu chỉ lưu mã băm SHA-256 của token phiên, không lưu token gốc.
- **Nhật ký hoạt động**: mỗi thao tác thay đổi dữ liệu ghi thêm một dòng vào `activity_log`
  trong cùng một batch D1 với thao tác đó, nên nhật ký luôn khớp với dữ liệu.
- Chi tiết đầy đủ về API, mã lỗi và lược đồ dữ liệu: xem [`docs/CONTRACT.md`](docs/CONTRACT.md).
