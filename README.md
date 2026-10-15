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
migrations/           # migration D1 (0001 ... 0005)
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

## Tài khoản quản trị

Có một tài khoản admin duy nhất (không tạo hay tham gia nhóm như người thường). Đăng nhập ở trang
đăng nhập bình thường, hệ thống tự chuyển sang `/admin` với ba tab:

- **Tài khoản**: cấp lại mật khẩu (để trống để tạo ngẫu nhiên; mật khẩu chỉ hiện một lần, mọi phiên
  cũ bị đăng xuất), **khóa / mở khóa** tài khoản (kèm lý do; bị khóa là đăng xuất ngay và không đăng
  nhập lại được, dữ liệu giữ nguyên), huy hiệu "Spam 24 giờ qua".
- **Nhóm**: xem mọi nhóm, **mở** một nhóm để xem và sửa dữ liệu (chi tiêu, thành viên, mục mẫu), đổi
  tên, **xóa mềm** và **khôi phục**. Mọi thay đổi của admin ghi vào nhật ký của nhóm dưới tên
  "Quản trị viên", và vào bảng `admin_audit`.
- **IP & spam**: danh sách IP đang bị chặn (thủ công và tự động), IP nghi vấn spam kèm nút chặn,
  chặn một IP theo thời hạn (24 giờ, 7 ngày, vĩnh viễn) và bỏ chặn.

Tài khoản admin **không** tạo được qua đăng ký. Tạo (hoặc đổi mật khẩu) bằng script cục bộ, script
chỉ ghi file SQL, bạn tự áp lên D1:

```bash
node scripts/create-admin.mjs --out admin.sql --password-out admin-password.txt
# hoặc tự chọn mật khẩu (>= 12 ký tự): ADMIN_PASSWORD='...' node scripts/create-admin.mjs --out admin.sql
```

Chạy lại script với cùng tên đăng nhập là đổi mật khẩu admin; nó không bao giờ ghi đè một tài khoản
người dùng thường trùng tên. Giữ file mật khẩu ngoài repo và xóa sau khi lưu vào trình quản lý mật khẩu.

## Chống spam và tấn công

Thứ tự kiểm tra cho mọi request `/api`, tất cả trước khi đụng tới D1:

| Lớp | Quy tắc |
|---|---|
| IP bị chặn | 403 ngay (kể cả đăng nhập, đăng ký). Danh sách đọc từ D1 tối đa 1 lần/phút/isolate, lưu trong bộ nhớ |
| Giới hạn theo IP | đăng nhập/đăng ký 10 lần/phút, API khác 120 lần/phút |
| Giới hạn ghi theo phiên | tối đa 30 thao tác ghi/phút cho mỗi phiên đăng nhập |
| Tự chặn IP | từ **3 tài khoản khác nhau** cùng một IP vượt giới hạn ghi trong 30 phút thì IP đó bị chặn **24 giờ**; các tài khoản chỉ bị đánh dấu cho admin xem, không bị khóa tự động |
| Chặn đăng ký hàng loạt | tối đa 10 tài khoản mới mỗi IP mỗi 24 giờ |
| Giới hạn kích thước | body JSON tối đa 32 KB |

Các hằng số nằm ở `lib/guard.ts` (`ABUSE`) và `lib/rate-limit.ts`. Chi phí D1 được giữ thấp: sự kiện
spam chỉ ghi khi vượt giới hạn, tối đa một dòng cho mỗi tài khoản mỗi 10 phút mỗi isolate, tự xóa sau
7 ngày; token phiên không tồn tại được nhớ 60 giây để cookie rác không tốn một lần đọc D1 mỗi request.

**Giới hạn cần biết:**

- Đây là lớp chặn sớm ở tầng ứng dụng, **không phải** chống DDoS tầng mạng. Lưu lượng DDoS L3/L4/L7
  quy mô lớn được lớp giảm thiểu luôn bật của Cloudflare xử lý trước khi tới Worker; ứng dụng chỉ từ
  chối rẻ và sớm những gì đã tới được.
- Bộ đếm theo từng vị trí Cloudflare / từng isolate, không toàn cầu; chặn hoặc bỏ chặn có thể mất tới
  khoảng 60 giây mới có hiệu lực ở mọi nơi.
- Nhiều người có thể dùng chung một IP (cùng wifi, mạng di động): chặn IP có thể ảnh hưởng người vô
  tội, nên tự động chỉ chặn 24 giờ và admin bỏ chặn sớm được.
- Admin vẫn dùng được `/api/admin/*` từ IP bị chặn, nhưng không đăng nhập được từ IP đó (đăng nhập
  cũng là API): hãy đăng nhập từ một mạng khác.

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
- Rate limit theo IP và theo phiên (xem mục Chống spam): binding `ratelimits` trong `wrangler.jsonc`
  (`RL_AUTH`, `RL_API`, `RL_WRITE`), có dự phòng trong bộ nhớ.
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
