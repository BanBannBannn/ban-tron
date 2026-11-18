# Bàn Tròn: bảng trắng cộng tác thời gian thực

Bảng trắng vô hạn để cả nhóm cùng vẽ, viết, ghi chú, làm bảng biểu và trò chuyện. Không bắt buộc tài khoản: gửi link là vào được ngay. Có tài khoản thì lưu phòng trên mọi thiết bị. Chat, nội dung bảng và thông tin cá nhân **được mã hoá AES-256**.

**Stack:** Next.js 16 (App Router) · Supabase (Postgres, Auth, Realtime, Storage) · Tiptap · Tailwind CSS 4 · Resend (mail góp ý). Chạy được hoàn toàn trên **Supabase Free + Vercel Hobby**.

> 📄 **[BAO_CAO.md](BAO_CAO.md)**: báo cáo chi tiết cơ chế bảo mật / mã hoá, bảng mối đe doạ, giới hạn, và **hướng dẫn cài đặt đầy đủ** (Supabase cloud, Google, Resend, Vercel, GitHub CI/CD, xoay khoá).

## Tính năng

**Bảng trắng**
- Vẽ tay mượt (perfect-freehand), có lực nhấn khi dùng bút cảm ứng/Apple Pencil, bút dạ quang, tẩy (hình rỗng chỉ bị tẩy khi chạm vào viền).
- Hình khối: chữ nhật, elip, thoi, tam giác. Có màu nền, nét liền/gạch/chấm, và nhãn chữ bên trong (nhấp đúp vào hình).
- Đường thẳng, mũi tên (đầu/cuối), kéo đầu mút để chỉnh, giữ ⇧ để khoá góc 15°.
- **Chữ định dạng (rich text):** tiêu đề H1–H3, đậm/nghiêng/gạch chân/gạch ngang, code, màu chữ, tô nền, căn lề, danh sách, checklist, trích dẫn, liên kết.
- **Bảng biểu:** thêm/xoá hàng và cột, gộp/tách ô, hàng/cột tiêu đề, kéo đổi độ rộng cột. Cũng chèn được bảng vào trong khối chữ hoặc ghi chú.
- Ghi chú dán (sticky note) nhiều màu.
- Ảnh: chọn file, kéo-thả hoặc dán (⌘V). Ảnh tự nén sang WebP rồi lưu trên Supabase Storage.
- Bút laser để thuyết trình (không lưu lại).
- Chọn nhiều phần tử, kéo, đổi kích thước, Alt+kéo để nhân bản, copy/paste, ⌘D, đưa lên trên/xuống dưới, khoá vị trí.
- Undo/redo riêng cho từng người, xoá toàn bộ (có thể hoàn tác), xuất ảnh PNG.
- Canvas vô hạn: zoom bằng ⌘+lăn chuột hoặc pinch, pan bằng Space+kéo hoặc 2 ngón tay. Có nút "xem toàn bộ".

**Cộng tác thời gian thực**
- Thấy con trỏ kèm tên của từng người, nét đang vẽ, phần tử người khác đang chọn và đang sửa (có khoá chỉnh sửa).
- Danh sách người online (presence). Bấm "Đi tới" để bay tới chỗ con trỏ của người đó.
- Tự đồng bộ lại khi mất mạng rồi kết nối lại.

**Chat**
- Tin nhắn realtime, gửi optimistic (có nút thử lại nếu lỗi), báo "đang nhập…", đếm tin chưa đọc, nhóm tin theo người gửi và theo ngày, tự nhận link, chọn emoji, xem tin cũ hơn.
- Mã hoá trong trình duyệt trước khi gửi; tài khoản có dấu ✓ xác thực, không mạo danh được.

**Tài khoản & phòng**
- Dùng như khách, hoặc đăng ký email (có xác nhận email) / đăng nhập Google. Quên mật khẩu, đổi mật khẩu, đăng xuất mọi thiết bị, xoá tài khoản.
- Hồ sơ: tên hiển thị, màu, họ tên / SĐT / ngày sinh (mã hoá, chỉ mình xem được).
- Phòng riêng tư (chỉ ai có link) hoặc công khai (hiện ở trang chủ). Duyệt người vào phòng, mời ra, chặn, xoá phòng.
- "Phòng của tôi" lưu theo tài khoản, ghim phòng. Phòng tạo khi còn là khách tự chuyển sang tài khoản sau khi đăng nhập.

**Góp ý & đánh giá**
- Chấm 1–5 sao, báo lỗi, góp ý tính năng tại `/feedback`. Lưu DB dạng mã hoá và gửi email qua Resend. Chống bot / spam nhiều lớp.

## Chạy trên máy (local)

### Cách 1: Supabase local (cần Docker)

```bash
npm install
supabase start          # tự áp dụng supabase/migrations
openssl rand -base64 32 # tạo khoá mã hoá
npm run dev
```

`.env.local` (xem thêm `.env.example`):
```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
ENCRYPTION_KEY=<chuỗi base64 vừa tạo>
```

Email xác nhận đăng ký ở local xem tại Mailpit: http://127.0.0.1:54324

### Cách 2: Dùng luôn Supabase cloud

Làm bước 1–3 ở phần Deploy bên dưới, điền `.env.local` bằng thông tin project thật, rồi chạy `npm run dev`.

## Deploy miễn phí (Supabase Free + Vercel Hobby)

1. **Tạo project Supabase** tại <https://supabase.com/dashboard>.
2. **Tạo database:** vào *SQL Editor*, chạy **lần lượt** [`20261117000000_init.sql`](supabase/migrations/20261117000000_init.sql) rồi [`20261118000000_accounts_privacy.sql`](supabase/migrations/20261118000000_accounts_privacy.sql).
   (Hoặc dùng CLI: `supabase link --project-ref <ref>` rồi `supabase db push`.)
3. **Cấu hình Auth:** bật *Allow anonymous sign-ins*, *Confirm email*, mật khẩu ≥ 8 ký tự có chữ và số, thêm Redirect URL `https://<domain>/**`, cấu hình **SMTP riêng** (không có thì người dùng không nhận được mail xác nhận). Chi tiết: [BAO_CAO.md mục 5.2](BAO_CAO.md).
4. **Realtime → Settings:** chỉ cho phép private channels.
5. Lấy **Project URL** và **Publishable key** ở *Project Settings → API Keys*.
6. Đẩy code lên GitHub. Trên <https://vercel.com/new>, **Import** repo, thêm biến môi trường `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, **`ENCRYPTION_KEY`** (và tuỳ chọn Google / Resend, xem `.env.example`), rồi bấm **Deploy**.

> ⚠️ **Mất `ENCRYPTION_KEY` = mất toàn bộ chat, bảng vẽ, hồ sơ đã mã hoá.** Lưu bản sao trong trình quản lý mật khẩu.

Vậy là xong. Mở trang, bấm **Tạo phòng mới**, rồi bấm **Mời** để copy link gửi bạn bè.

## Lưu ý về gói miễn phí

- **Supabase Free tự tạm dừng project sau khoảng 1 tuần không có truy cập.** Vào dashboard bấm *Restore* là chạy lại, dữ liệu vẫn còn.
- **Realtime có hạn mức** về số kết nối đồng thời và số tin nhắn mỗi tháng (xem <https://supabase.com/pricing>). App đã tiết kiệm sẵn:
  - Con trỏ gửi tối đa ~20 lần/giây.
  - Kéo thả và nét vẽ được gom gói ~16 lần/giây.
  - Chat dùng Postgres Changes.
  - Phần tử được lưu DB theo lô (debounce 350ms).
- **Storage Free khoảng 1GB.** Ảnh đã được nén WebP, tối đa 1800px, mỗi file tối đa 5MB.
- **Đăng nhập ẩn danh bị giới hạn số lượt tạo mới mỗi giờ theo IP** (mặc định ~30/giờ). Nếu public rộng rãi, nên bật CAPTCHA (Cloudflare Turnstile) trong *Authentication → Attack Protection*.
- **Vercel Hobby chỉ dùng cho mục đích phi thương mại.**

## Bảo mật

Tóm tắt (chi tiết và bảng mối đe doạ ở [BAO_CAO.md](BAO_CAO.md)):

- **RLS trên mọi bảng.** Chỉ thành viên *đã được duyệt* mới đọc/ghi/nghe được phòng. Hồ sơ chỉ chủ hồ sơ đọc được. Client không ghi thẳng vào `room_members` hay `feedback`, chỉ qua RPC có kiểm tra quyền.
- **Mã hoá AES-256-GCM:**
  - Chat và nội dung bảng được mã hoá trong trình duyệt bằng khoá riêng của từng phòng.
  - Hồ sơ cá nhân và góp ý được mã hoá ở server.
  - DB chỉ chấp nhận bản mã (ràng buộc CHECK).
  - Khoá chính nằm ở biến môi trường server, tách khỏi DB.
  - Mời ra / chặn thì đổi thế hệ khoá phòng.
- **Kênh realtime private** + policy trên `realtime.messages`. Dữ liệu từ người khác luôn được làm sạch (sanitize) trước khi hiển thị.
- **Tài khoản:** xác nhận email, mật khẩu mạnh, OAuth PKCE, chống dò email, chống open redirect, đổi mật khẩu phải nhập mật khẩu cũ.
- **Chống spam:** rate limit trong DB cho tin nhắn, phần tử, tạo phòng, dò mã phòng, hồ sơ, góp ý (theo người dùng, theo IP, trần hệ thống) → HTTP 429.
- **Header:** CSP, chống clickjacking, HSTS, nosniff.
- Các cột `created_by`, `user_id`, `created_at`, tên tác giả tin nhắn của tài khoản do trigger phía DB gán, client không giả mạo được.

## Kiểm thử

**168 test** (Playwright): 74 unit, 65 bảo mật (tấn công thẳng API như hacker), 29 e2e (2 trình duyệt thật).

```bash
supabase start            # cần Docker
npm test                  # toàn bộ; tự build & chạy app ở cổng 3100
npm run test:unit | test:security | test:e2e
npm run lint && npm run typecheck
```

**CI/CD:**
- GitHub Actions (`.github/workflows/ci.yml`) chạy lint, typecheck, `npm audit` và toàn bộ test (dựng Supabase local trong CI) cho mỗi push / PR.
- `deploy-db.yml` đẩy migration lên Supabase cloud khi có secret.
- Vercel tự deploy frontend.

## Phím tắt

| Phím | Chức năng |
|---|---|
| V / H | Chọn / Kéo bảng (hoặc giữ Space) |
| P / M / E | Bút / Dạ quang / Tẩy |
| R / O / D | Chữ nhật / Elip / Thoi |
| L / A | Đường thẳng / Mũi tên |
| T / N / B | Chữ / Ghi chú / Bảng biểu |
| I / K | Chèn ảnh / Laser |
| ⌘Z / ⌘⇧Z | Hoàn tác / Làm lại |
| ⌘C / ⌘V / ⌘D | Sao chép / Dán / Nhân bản |
| ⌘] / ⌘[ | Lên trên cùng / Xuống dưới cùng |
| ⌘+ / ⌘− / ⌘0 / ⇧1 | Phóng to / Thu nhỏ / 100% / Xem toàn bộ |
| Enter / Esc / Del | Sửa chữ / Thoát / Xoá |
| ? | Bảng phím tắt |

## Cấu trúc mã nguồn

```
src/
  app/                    # trang chủ, /r/[slug], layout, CSS
  components/
    board/                # Board (tương tác), ElementView, RichEditor, Overlays, Toolbar, StylePanel
    chat/ChatPanel.tsx
    room/                 # Room, RoomHeader, RoomSettings (duyệt / chặn), NameDialog
    home/                 # trang chủ, Phòng của tôi, Phòng công khai
    auth/                 # đăng nhập, callback, đặt lại mật khẩu, hồ sơ
    feedback/ legal/      # góp ý, điều khoản / quyền riêng tư
  lib/
    board/store.ts        # nguồn dữ liệu bảng: undo/redo, broadcast, lưu DB theo lô
    board/camera.ts       # pan/zoom ngoài React state (60fps)
    realtime.ts           # channel Supabase: Broadcast + Presence + Postgres Changes
    supabase.ts           # client + đăng nhập ẩn danh
    auth.ts               # phiên đăng nhập, đồng bộ hồ sơ, chuyển dữ liệu khách
    crypto.ts             # mã hoá AES-GCM trong trình duyệt
    server/keys.ts        # khoá chính + HKDF (chỉ server)
  app/api/                # rooms/[id]/keys, profile, feedback
supabase/migrations/      # schema, RLS, trigger, rate limit, storage bucket
tests/                    # unit / security / e2e
scripts/read-feedback.ts  # đọc góp ý đã mã hoá
```

## Giấy phép và bản quyền

Copyright © 2026 BanBannBannn. Mọi quyền được bảo lưu theo các điều khoản dưới đây.

Dự án phát hành theo giấy phép **GNU Affero General Public License v3.0 trở lên** (AGPL-3.0-or-later). Toàn văn ở file [LICENSE](LICENSE).

Tóm tắt (không thay thế văn bản giấy phép):

- Bạn được dùng, sửa và phân phối lại mã nguồn.
- Nếu bạn sửa đổi rồi chạy thành dịch vụ cho người khác dùng qua mạng, bạn phải công bố mã nguồn bản sửa đổi đó dưới cùng giấy phép AGPL.
- Phải giữ nguyên dòng bản quyền và thông báo giấy phép.
- Phần mềm được cung cấp "nguyên trạng", không bảo hành.

Thư viện bên thứ ba giữ giấy phép riêng của chúng (xem `package.json` và thư mục `node_modules`). Tên "Bàn Tròn" và biểu tượng của dự án không được cấp phép sử dụng làm nhãn hiệu.
