# Bàn giao (cập nhật 2026-11-18)

Báo cáo đầy đủ phiên này: **[BAO_CAO.md](BAO_CAO.md)** (đã làm gì, cơ chế bảo mật, giới hạn, hướng dẫn cài đặt).

## Trạng thái hiện tại
- `npm test` → **168/168 pass**: 74 unit, 65 security (API thật), 29 e2e (2 trình duyệt). Đã chạy trên DB dựng mới từ migration.
- Yêu cầu: Docker + `supabase start`. `.env.local` gồm `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, **`ENCRYPTION_KEY`**.
- Test tự lấy secret key local qua `supabase status -o env` (không lưu file). Helper từ chối chạy admin với Supabase không phải local.
- `supabase/config.toml` (chỉ local): bật xác nhận email (xem mail ở Mailpit :54324), mật khẩu ≥ 8 có chữ và số, `email_sent = 1000` / anonymous 5000 mỗi giờ cho test, Google tắt sẵn.
- Code **chưa commit** (người dùng tự commit).

## Đã làm trong phiên 18/11
- Xong toàn bộ tồn đọng cũ: test IME tiếng Việt (Telex/VNI/Unikey), cảm ứng, mất mạng; rate limit; README.
- Tài khoản email + Google (PKCE), xác nhận email, quên / đổi mật khẩu, đăng xuất mọi thiết bị, xoá tài khoản, chuyển dữ liệu khách sang tài khoản (`create_guest_claim` / `claim_guest`).
- Hồ sơ mã hoá ở server (`/api/profile`, `src/lib/server/keys.ts`, HKDF theo user, AAD theo trường).
- Chat và phần tử bảng mã hoá trong trình duyệt (`src/lib/crypto.ts`). Khoá phòng lấy qua `/api/rooms/[id]/keys`; thế hệ khoá `rooms.key_epoch` tăng khi mời ra / chặn.
- Phòng riêng tư / công khai, duyệt người vào (`room_members.status` = active/pending/banned), `moderate_member`, `list_my_rooms`, `list_public_rooms`, ghim phòng, rời phòng, xoá phòng.
- Góp ý & đánh giá `/feedback` → `/api/feedback` → RPC `submit_feedback` (mã hoá, rate limit user/IP/toàn hệ thống, quota mail) + Resend. Đọc góp ý: `npm run feedback:read`.
- `/terms`, `/privacy`, mục "Riêng tư theo mặc định" trên trang chủ.
- CSP + header bảo mật (`next.config.ts`).
- CI/CD: `.github/workflows/ci.yml`, `deploy-db.yml`, `dependabot.yml`.

## Việc tiếp theo
1. **LICENSE / bản quyền:** người dùng sẽ push git rồi nhờ làm. Cần hỏi: mở mã nguồn (MIT / AGPL…) hay giữ bản quyền đóng.
2. Người dùng điền `[Tên cá nhân / đơn vị vận hành]`, `[email liên hệ]` trong `src/app/terms/page.tsx` và `src/app/privacy/page.tsx`.
3. Chưa test: dán ảnh từ clipboard, hiệu năng khi có hơn 1000 phần tử, `keepalive` vượt 64KB.
4. Tuỳ chọn: bucket ảnh private + signed URL; CAPTCHA Turnstile; SMTP riêng (Resend + domain) cho mail xác nhận trên cloud.
5. Còn treo từ trước: cảnh báo "bounce" của ba chấm đang gõ (`globals.css`), chờ người dùng xác nhận.

## Lưu ý kỹ thuật (dễ vấp)
- Regex trong CHECK của Postgres: số lần lặp tối đa 255 (`{22,1200}` sẽ lỗi `2201B`).
- supabase-js không hiểu errcode `PT503`; dùng `PT429` + `hint`.
- Next 16 (cacheComponents): không dùng `new Date()` trong component được prerender.
- Next có sẵn phần tử `role="alert"` (route announcer), nên selector test phải cụ thể (`p[role="alert"]`).
- Công cụ Write có thể biến `\uXXXX` trong nội dung thành ký tự thật. Với regex ký tự ẩn, hãy dựng chuỗi bằng `String.fromCharCode` hoặc kiểm tra lại bằng `od -c`.
- Xoá nhiều id bằng `.in()` phải chia lô (URL quá dài thì lỗi âm thầm).

## Lệnh hay dùng
```bash
supabase start                 # DB local (Docker)
supabase db reset --local      # áp dụng lại migration, XOÁ dữ liệu local
npm run dev                    # http://localhost:3000
npm test                       # toàn bộ test
npm run lint && npm run typecheck
npx playwright show-trace test-results/<thư mục>/trace.zip
```
