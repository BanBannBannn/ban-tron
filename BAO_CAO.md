# Báo cáo phiên 18/11/2026: tài khoản, mã hoá, duyệt phòng, góp ý, CI/CD

> Đọc nhanh: mục **0** (tóm tắt) và mục **5** (hướng dẫn cài đặt). Các mục còn lại giải thích chi tiết đã làm gì, làm thế nào và vì sao.

---

## 0. Tóm tắt

- **Kết quả test: 168/168 pass** (chạy trên DB dựng mới hoàn toàn từ 2 file migration).

  | Nhóm | Số test | Nội dung |
  |---|---|---|
  | Unit | 74 | Kiểm tra dữ liệu, mã hoá/giải mã, xoay khoá, chống open redirect, escape email... |
  | Bảo mật | 65 | Gọi thẳng API Supabase / API Next.js như kẻ tấn công: IDOR, leo quyền, nghe lén, spam |
  | E2E | 29 | 2 trình duyệt thật: đăng ký qua email, duyệt người vào phòng, chat mã hoá, tiếng Việt, cảm ứng, mất mạng |

- **Đã làm xong toàn bộ việc tồn đọng trong HANDOFF:** gõ tiếng Việt (Telex/VNI/Unikey), cảm ứng (vẽ 1 ngón, chụm 2 ngón để zoom), mất mạng rồi kết nối lại, chống spam, README.
- **Tính năng mới:**
  - Đăng ký / đăng nhập bằng email hoặc Google. Có xác nhận email, quên mật khẩu, đổi mật khẩu, đăng xuất mọi thiết bị, xoá tài khoản.
  - Hồ sơ cá nhân: họ tên, SĐT, ngày sinh được **mã hoá AES-256-GCM**.
  - **Chat và bảng vẽ được mã hoá ngay trong trình duyệt** trước khi lưu DB.
  - **Duyệt người vào phòng**, mời ra, chặn; phòng **riêng tư / công khai**; **lưu (ghim) phòng** theo tài khoản; xoá phòng, rời phòng.
  - Khách đã tạo phòng rồi mới đăng nhập thì phòng **tự chuyển sang tài khoản**.
  - **Góp ý & đánh giá** (1–5 sao), gửi email qua Resend (miễn phí), chống bot và spam nhiều lớp.
  - Trang **Điều khoản sử dụng** (`/terms`) và **Quyền riêng tư** (`/privacy`); trang chủ có mục giới thiệu mã hoá để người dùng an tâm.
  - **CI/CD** bằng GitHub Actions: lint, typecheck, audit thư viện, chạy toàn bộ test; workflow đẩy migration lên Supabase; Dependabot.
- **Cần bạn làm khi deploy:** chạy file migration mới, đặt biến `ENCRYPTION_KEY` (**mất khoá = mất dữ liệu đã mã hoá**), cấu hình Auth trên Supabase (xem mục 5).
- **Code vẫn chưa commit**, bạn tự commit. Phần LICENSE / bản quyền để bạn push git xong rồi gọi mình làm tiếp.

---

## 1. Đã làm gì, làm thế nào

### 1.1 Việc tồn đọng từ phiên trước

| Việc | Cách làm / kết quả | Test |
|---|---|---|
| Gõ tiếng Việt qua IME | Mô phỏng bộ gõ thật bằng Chrome DevTools Protocol (`Input.imeSetComposition`), gồm Telex, VNI và kiểu Unikey (xoá lùi rồi thay chữ có dấu). Kiểm tra ngay sau nhấp đúp (bộ đệm phím), trong chat, ghi chú và khối chữ. Không phát hiện lỗi. | `tests/e2e/input-network.spec.ts` |
| Enter khi đang ghép chữ | Enter lúc bộ gõ chưa chốt chữ **không** gửi tin nhắn. | như trên |
| Cảm ứng | Vẽ bằng 1 ngón tay; chụm 2 ngón để zoom mà không sinh nét vẽ thừa. | như trên |
| Mất mạng | Vẽ khi offline thì có mạng lại tự lưu DB; chat lỗi có nút thử lại; rớt websocket thì kết nối lại tự tải phần bị lỡ. | như trên |
| Rate limit | Xem mục 1.7. | `tests/security/*` |
| README | Đã cập nhật. | |

### 1.2 Tài khoản

- **Đăng ký email + mật khẩu** (`/login`):
  - Mật khẩu ≥ 8 ký tự, có cả chữ và số. Supabase kiểm tra lại phía server và băm bằng bcrypt.
  - **Bắt buộc xác nhận email** (`enable_confirmations = true`), nên không ai đăng ký được bằng email của người khác.
  - Đăng ký bằng email đã tồn tại vẫn hiện "kiểm tra hộp thư" như bình thường, nên không dò được email nào đã có tài khoản.
- **Đăng nhập Google:** dùng OAuth với **PKCE**, nên URL chỉ chứa mã dùng 1 lần, không chứa token. Nút Google chỉ hiện khi `NEXT_PUBLIC_AUTH_GOOGLE=true`.
- **Quên mật khẩu** (`/auth/reset`): luôn báo "nếu email có tài khoản thì đã gửi link", nên không dò được email.
- **Đổi mật khẩu:** phải nhập mật khẩu hiện tại. Nhờ vậy kẻ chiếm được phiên đăng nhập (ví dụ máy để quên) không đổi được mật khẩu. Đã bật thêm `secure_password_change`.
- **Đăng xuất mọi thiết bị:** `signOut({ scope: "global" })`.
- **Xoá tài khoản:** gõ "XOÁ" để xác nhận. Xoá hồ sơ, các phòng mình tạo (kèm nội dung) và tin nhắn mình đã gửi ở phòng khác.
- **Chống open redirect:** tham số `?next=` chỉ nhận đường dẫn nội bộ (`src/lib/safe-next.ts`). Các dạng `//evil.com`, `https://evil.com`, `/\evil.com` đều bị chặn.
- **Chuyển dữ liệu khách sang tài khoản:**
  - Trước khi đăng nhập, phiên khách tạo một mã bí mật 256-bit (DB chỉ lưu bản băm SHA-256, hết hạn sau 30 phút).
  - Sau khi đăng nhập, tài khoản dùng mã đó để nhận lại phòng, thành viên và tin nhắn. Mã chỉ dùng được 1 lần, sau đó user khách bị xoá.
  - Người đang bị chặn thì vẫn bị chặn sau khi chuyển sang tài khoản.

### 1.3 Hồ sơ cá nhân mã hoá (`/account`)

```
Trình duyệt ──HTTPS──▶ /api/profile (server Next.js) ──▶ Supabase DB
   bản rõ                mã hoá AES-256-GCM               chỉ lưu "s1.<kid>.<iv>.<ciphertext>"
                         khoá = HKDF(ENCRYPTION_KEY, "profile:<userId>")
                         AAD  = "profile:<userId>:<tên trường>"
```

- **Khoá chính `ENCRYPTION_KEY` chỉ nằm trên server** (Vercel env / `.env.local`), không nằm trong DB. Nếu chỉ DB bị lộ thì vẫn không đọc được.
- **Mỗi người dùng có khoá riêng**, dẫn xuất bằng HKDF-SHA256.
- **AAD gắn bản mã với đúng người và đúng trường.** Đã test: chép bản mã SĐT của A vào hồ sơ B thì B nhận về `null` chứ không đọc được dữ liệu của A.
- **DB có ràng buộc định dạng** trên các cột `*_enc`. Dù client có lỗi, DB cũng không bao giờ nhận bản rõ.
- **RLS:** chỉ chủ hồ sơ đọc/sửa được hồ sơ của mình; người cùng phòng cũng không xem được.
- **Server dùng JWT của chính người dùng, không dùng service role.** Mọi truy vấn vẫn đi qua RLS, nên server không thể vô tình đọc nhầm hồ sơ người khác.
- **API chặn dữ liệu xấu:**
  - Trường lạ (mass assignment như `id`, `email`, `full_name_enc`).
  - Sai Content-Type, body quá 8KB.
  - SĐT / ngày sinh sai định dạng.
  - Ký tự điều khiển và ký tự đảo chiều chữ (dùng để giả tên).
- **Tên hiển thị của tài khoản lấy từ hồ sơ** (trigger trong DB). Tin nhắn có dấu ✓ "đã xác thực", khách bị gắn nhãn "· khách". **Đã sửa rủi ro mạo danh trong chat** ghi trong HANDOFF cũ.

### 1.4 Mã hoá chat và bảng vẽ

```
Thành viên đã duyệt ──GET /api/rooms/:id/keys (kèm JWT)──▶ server kiểm tra quyền (RPC room_key_epoch, qua RLS)
                    ◀── khoá phòng = HKDF(ENCRYPTION_KEY, "room:<id>:<thế hệ>") ──┘
Trình duyệt: AES-256-GCM (WebCrypto, khoá không xuất được, chỉ nằm trong RAM)
   tin nhắn → "e1.<kid>.<iv>.<ct>"   AAD = "msg:<id tin nhắn>"
   phần tử  → { "enc": "e1...." }    AAD = "el:<id phần tử>:<loại>"
DB: ràng buộc CHECK chỉ nhận dạng mã hoá → không thể lưu bản rõ
```

- Người lạ, người đang chờ duyệt và người bị chặn đều nhận **403** từ API khoá.
- **Mời ra / chặn thì tăng "thế hệ khoá"** của phòng. Người bị mời ra chỉ còn khoá cũ, nên không giải mã được nội dung mới. Thành viên còn lại được cấp đủ khoá các thế hệ, nên vẫn đọc được lịch sử.
- **Xoay vòng khoá chính:** đặt khoá mới vào `ENCRYPTION_KEY`, khoá cũ vào `ENCRYPTION_KEY_PREVIOUS`. Dữ liệu cũ vẫn đọc được; hồ sơ được tự mã hoá lại khi đọc.
- **Dữ liệu hỏng / bị sửa / chép sang chỗ khác:** GCM phát hiện. Tin nhắn hiện "🔒 Không giải mã được tin nhắn này", phần tử hỏng bị bỏ qua, trang không bị sập.
- Thành viên xấu (có khoá hợp lệ) vẫn có thể mã hoá dữ liệu độc hại hợp lệ. Lớp `sanitize` cũ vẫn lọc sau khi giải mã, và test injection cũ đã được chuyển sang chèn dữ liệu đã mã hoá.

### 1.5 Phòng: riêng tư / công khai, duyệt, lưu phòng

| Tính năng | Cách hoạt động |
|---|---|
| Riêng tư (mặc định) | Chỉ ai có link mới vào được, như trước. |
| Công khai | Hiện ở mục "Phòng công khai" trên trang chủ (có ô tìm kiếm). **Chỉ tài khoản đã đăng nhập** mới bật được (DB chặn, nên khách không dùng để spam được). Danh sách chỉ lộ slug, tên, số người; không lộ id hay chủ phòng. |
| Duyệt người vào | Người mới mở link thì ở trạng thái `pending`: chỉ thấy tên phòng, không đọc/ghi/nghe được gì (DB, realtime, storage, API khoá đều chặn). Chủ phòng thấy huy hiệu số người chờ cùng thông báo, bấm Duyệt / Từ chối. Tối đa 50 yêu cầu chờ mỗi phòng. |
| Mời ra / Chặn | Mời ra: mất quyền ngay; nếu phòng không bật duyệt thì có thể vào lại bằng link. Chặn: không vào lại được, không tự "rời phòng" để gỡ chặn, không lộ tên phòng. Cả hai đều đổi thế hệ khoá. |
| Lưu phòng | Tài khoản có mục "Phòng của tôi" trên trang chủ, đồng bộ mọi thiết bị, ghim ⭐ lên đầu. Khách vẫn có "Phòng gần đây" lưu trong trình duyệt. |
| Xoá phòng / Rời phòng | Chỉ chủ phòng xoá được (xoá kèm nội dung). Chủ phòng không "rời" được, để tránh phòng không có chủ. |
| Thông báo cho chủ phòng | Hỏi DB định kỳ 5 giây/lần (không dùng Postgres Changes trên `room_members`, vì sự kiện DELETE của Realtime không lọc theo RLS, sẽ lộ id thành viên). |
| Bị mời ra khi đang online | Broadcast `member` chỉ là "chuông báo". Client tự hỏi lại DB (giới hạn 1 lần / 3 giây, chống bị lợi dụng spam), không tin nội dung broadcast. |

Đã sửa một rủi ro trong HANDOFF cũ: `join_room` trả về `is_owner` thay cho `created_by` (uuid chủ phòng).

### 1.6 Góp ý & đánh giá (`/feedback`)

- Người dùng chọn chủ đề (Đánh giá chung / Báo lỗi / Góp ý tính năng / Khác), chấm 1–5 sao, viết nội dung và để lại email nếu muốn. Trang hiển thị điểm trung bình.
- Có link tại chân trang chủ, menu tài khoản, menu phòng và hộp thoại cài đặt phòng.
- **Luôn lưu vào DB trước:** nội dung và email liên hệ được mã hoá (`scope:feedback`). Nhờ vậy dù mail lỗi, góp ý cũng không mất. Đọc lại bằng `npm run feedback:read`.
- **Gửi mail qua Resend**, giống repo gamehub của bạn (gói miễn phí: 3.000 mail/tháng, 100 mail/ngày). Không có `RESEND_API_KEY` thì chỉ lưu DB.
- **Chống spam nhiều lớp:**
  1. Ô bẫy (honeypot) ẩn: bot điền vào thì nhận 200 giả, không lưu.
  2. Gửi trong vòng dưới 2,5 giây sau khi mở form: coi là bot, xử lý như trên.
  3. Mỗi người dùng: 3 lần / 10 phút, 10 lần / ngày.
  4. Mỗi IP: 10 lần / giờ. IP được băm kèm bí mật server, DB không lưu IP thật.
  5. Toàn hệ thống: 500 góp ý / ngày (chống bot tạo hàng loạt tài khoản khách).
  6. Quota mail: tối đa 90 mail / ngày, để không vượt gói miễn phí. Quá ngưỡng thì vẫn lưu DB nhưng không gửi mail.
- **Chống chèn HTML / header:**
  - Mọi giá trị trong mail đều được escape.
  - Tiêu đề chỉ ghép từ danh sách giá trị cố định.
  - Email liên hệ chứa xuống dòng (kiểu `a@b.com\r\nBcc: ...`) bị từ chối.
  - Đường dẫn trang nguồn chỉ nhận đường nội bộ.

### 1.7 Chống spam (rate limit phía DB)

Bộ đếm nằm trong schema `private`, client không đọc hay reset được. Vượt ngưỡng thì nhận **HTTP 429**.

| Thao tác | Giới hạn |
|---|---|
| Gửi tin nhắn | 12 / 10 giây và 300 / 10 phút |
| Ghi phần tử bảng | 3000 / phút; tối đa 10.000 phần tử / phòng |
| Tạo phòng | 20 / giờ |
| Vào phòng (`join_room`, chống dò mã phòng) | 60 / phút |
| Lấy khoá phòng | 120 / phút |
| Sửa hồ sơ | 30 / 10 phút |
| Duyệt / mời ra | 200 / phút |
| Mã chuyển dữ liệu khách | 20 / giờ |
| Góp ý | xem 1.6 |

Xoá dây chuyền (xoá phòng, xoá tài khoản) không bị tính vào rate limit (`pg_trigger_depth`).

### 1.8 Header bảo mật (`next.config.ts`)

| Header | Tác dụng |
|---|---|
| CSP | Chỉ cho kết nối tới chính trang và Supabase. Dù bị chèn HTML, trình duyệt cũng không tải script hay gửi dữ liệu ra domain lạ. |
| `frame-ancestors 'none'` + `X-Frame-Options: DENY` | Chống clickjacking (nhúng trang vào iframe lừa người bấm). |
| `nosniff`, `Referrer-Policy`, `Permissions-Policy` | Chặn trình duyệt đoán sai kiểu file, hạn chế lộ URL khi chuyển trang, tắt camera / micro / vị trí. |
| HSTS | Buộc dùng HTTPS. |
| Ẩn `X-Powered-By` | Không lộ công nghệ máy chủ. |
| API trả `Cache-Control: no-store` | Khoá và dữ liệu cá nhân không bị cache. |

### 1.9 Pháp lý & giới thiệu cho người dùng

- `/terms` (Điều khoản sử dụng) và `/privacy` (Quyền riêng tư & bảo mật). Trang `/privacy` nói rõ cơ chế mã hoá **và cả giới hạn của nó**.
- **Bạn cần sửa 2 chỗ** `[Tên cá nhân / đơn vị vận hành]` và `[email liên hệ]` ở đầu 2 file `src/app/terms/page.tsx` và `src/app/privacy/page.tsx`. Đây là văn bản mẫu, nên nhờ người có chuyên môn pháp lý rà soát trước khi chạy thương mại.
- Trang chủ có mục **"Riêng tư theo mặc định"** (4 điểm về mã hoá). Khung chat có nhãn 🔒 "Mã hoá", trang hồ sơ có hộp giải thích. Form đăng ký có dòng "bạn đồng ý với Điều khoản...".

### 1.10 CI/CD (`.github/`)

| File | Làm gì |
|---|---|
| `workflows/ci.yml` | Mỗi push / PR: `npm ci` → lint → typecheck → `npm audit` (lỗ hổng mức high) → dựng Supabase local trong CI → chạy **toàn bộ 168 test**. Test lỗi thì tải trace về xem lại. |
| `workflows/deploy-db.yml` | Push lên `main` có migration mới (hoặc bấm tay) thì `supabase db push` lên cloud. Tự bỏ qua nếu chưa khai báo secret. |
| `dependabot.yml` | Mỗi tuần tự mở PR cập nhật thư viện (CI sẽ test từng PR). |

Frontend do **Vercel tự deploy** khi push (Git integration), không cần workflow riêng.

---

## 2. Bảng mối đe doạ → cách chặn → test kiểm chứng

| Tấn công | Chặn bằng | Test |
|---|---|---|
| Người lạ đọc phòng / tin nhắn / hồ sơ người khác bằng id (IDOR) | RLS trên mọi bảng | `api.spec` "IDOR", `accounts.spec` "IDOR" |
| Người chờ duyệt tự duyệt mình / sửa thẳng `room_members` | Không cấp quyền ghi; RPC kiểm tra chủ phòng | "người chờ duyệt không tự duyệt mình" |
| Thành viên thường duyệt / chặn / mời ra người khác (kể cả chủ phòng) | `moderate_member` chỉ cho chủ phòng | "IDOR: thành viên thường / người lạ..." |
| Khách bật phòng công khai để spam danh sách | Trigger kiểm tra `is_anonymous` | "khách không bật được công khai" |
| Đặt lại thế hệ khoá / đổi slug / đổi chủ phòng | GRANT theo cột | "không đổi được cài đặt phòng" |
| Lấy khoá giải mã khi không phải thành viên | API khoá kiểm tra qua RLS, trả 401/403 | "API khoá phòng..." |
| Nghe lén realtime khi đang chờ duyệt | Policy `realtime.messages` chỉ cho `active` | "người mới vào → pending..." |
| DB bị lộ | Chat, bảng vẽ, hồ sơ, góp ý đều là bản mã; khoá nằm ở server | "DB chỉ chứa bản mã" |
| Chép bản mã sang tin / phòng / người khác | AES-GCM + AAD + khoá riêng từng phòng / người | "AAD", "tráo bản mã của A sang B" |
| Người bị chặn đọc nội dung mới | Đổi thế hệ khoá + RLS | "bị chặn → mất quyền lấy khoá" |
| Mạo danh trong chat | Tên lấy từ hồ sơ + dấu xác thực | "tin nhắn của tài khoản: tên lấy từ hồ sơ" |
| Mass assignment vào hồ sơ | Danh sách trường cho phép | "API từ chối dữ liệu xấu" |
| Dùng lại / đoán mã chuyển dữ liệu khách | 256-bit, băm, 1 lần, 30 phút | "mã nhận dữ liệu" |
| Spam chat / phòng / dò mã phòng / góp ý | Rate limit trong DB, honeypot, trần hệ thống | "Rate limit", `feedback.spec` |
| Chèn HTML / header vào email góp ý | Escape + danh sách cho phép | `unit/feedback.spec` |
| Open redirect sau đăng nhập | `safeNext` | unit + e2e "open redirect" |
| XSS / clickjacking | Sanitize (cũ) + CSP + `frame-ancestors` | `injection.spec`, "header bảo mật" |
| SQL injection qua ô tìm phòng | Tham số hoá + escape `%`, `_` | "phòng công khai: ... ký tự %, _" |

---

## 3. Giới hạn (nói thẳng để bạn quyết định)

1. **Không phải mã hoá đầu-cuối tuyệt đối.** Server giữ khoá chính để cấp cho thành viên, nên người vận hành server (bạn, hoặc ai chiếm được Vercel env) về lý thuyết giải mã được. Đổi lại, cách này dùng được với duyệt thành viên, nhiều thiết bị và khách mà không bắt ai giữ khoá riêng. Lộ **chỉ DB** thì an toàn; lộ **cả DB lẫn `ENCRYPTION_KEY`** thì không. Trang `/privacy` đã ghi rõ điều này.
2. **Ảnh trên bảng không mã hoá.** Bucket public, đường dẫn gồm 2 UUID ngẫu nhiên nên rất khó đoán. Muốn chặt hơn: chuyển bucket sang private và tải ảnh qua signed URL.
3. **Những gì không mã hoá bằng khoá của mình** (Supabase vẫn mã hoá ổ đĩa): tên phòng, tên hiển thị, email đăng nhập (Supabase Auth cần để đăng nhập), loại phần tử và thứ tự z. Broadcast realtime đi qua TLS và kênh private, không lưu lại.
4. **Người bị mời ra đang online:** DB và khoá mới bị chặn ngay. Riêng kênh realtime đã mở có thể vẫn nhận broadcast tạm thời (nét vẽ đang kéo, con trỏ) cho tới khi kết nối lại hoặc token hết hạn (≤ 1 giờ). Client "tử tế" tự thoát ngay.
5. **Rate limit theo IP** tin header `x-real-ip` / `x-forwarded-for`. Trên Vercel các header này do Vercel ghi đè nên đáng tin; nếu tự host thì phải để reverse proxy ghi đè chúng.
6. **Rate limit realtime broadcast** (con trỏ, nét vẽ) chỉ có giới hạn sẵn của Supabase, mình không tự đếm được.
7. **Mất `ENCRYPTION_KEY` là mất vĩnh viễn** chat, bảng vẽ, hồ sơ và góp ý đã mã hoá. Hãy lưu bản sao trong trình quản lý mật khẩu.

---

## 4. Bug tìm thấy & đã sửa trong phiên này

| Bug | Phát hiện nhờ | Sửa |
|---|---|---|
| Ràng buộc regex `{22,1200}` vượt giới hạn lặp 255 của Postgres, nên **mọi lần lưu hồ sơ đều lỗi** | test bảo mật hồ sơ | `char_length() <= 1400` + `{22,}` |
| Trang chủ không build được vì `new Date()` trong chân trang (Next 16 cấm giá trị thay đổi khi prerender) | build | năm cố định |
| Ô trang nguồn góp ý nhận `//evil.test` | unit test | chặn cả ở app lẫn DB |
| `PT503` không được supabase-js hiểu (trả "Something went wrong") | test trần hệ thống | `PT429` + hint |
| Bị mời ra nhưng store vẫn thử lưu mãi ở nền | rà code | `store.dispose()` |
| Broadcast `member` có thể bị lợi dụng để spam API | rà code | giới hạn 1 lần / 3 giây |
| `room_key_epoch` chưa có rate limit | rà code | 120 / phút |
| Mạo danh tên trong chat (rủi ro cũ) | HANDOFF | tên lấy từ hồ sơ + dấu ✓ |
| `join_room` lộ uuid chủ phòng (rủi ro cũ) | HANDOFF | trả `is_owner` |

---

## 5. Hướng dẫn cài đặt

### 5.1 Chạy trên máy (local)

```bash
npm install
supabase start                     # Docker; tự áp dụng 2 file migration
openssl rand -base64 32            # tạo khoá mã hoá
```

Tạo `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...      # lấy ở `supabase status`
ENCRYPTION_KEY=<chuỗi vừa tạo>
```

Rồi `npm run dev` và mở http://localhost:3000.

- **Email xác nhận khi đăng ký** ở local: xem tại **Mailpit** http://127.0.0.1:54324.
- Sửa `supabase/config.toml` thì phải `supabase stop && supabase start`.
- Sửa migration thì chạy `supabase db reset --local` (**xoá dữ liệu local**).

### 5.2 Supabase cloud

1. **Database:** chạy **lần lượt** 2 file trong *SQL Editor*:
   `supabase/migrations/20261117000000_init.sql`, rồi `20261118000000_accounts_privacy.sql`.
   Hoặc dùng CLI: `supabase link --project-ref <ref>` rồi `supabase db push`.
2. **Authentication → Sign In / Providers:**
   - Bật **Allow anonymous sign-ins** (cho khách).
   - Bật **Email** + **Confirm email**.
   - **Minimum password length = 8**, **Password requirements = Letters and digits**.
   - Bật **Secure password change**. Nếu có gói Pro thì bật thêm **Leaked password protection**.
3. **Authentication → URL Configuration:**
   - **Site URL** = `https://<domain-của-bạn>`.
   - **Redirect URLs:** thêm `https://<domain>/**` (link email và Google chỉ quay về các địa chỉ này).
4. **Authentication → Emails → SMTP (quan trọng):** SMTP mặc định của Supabase chỉ gửi được rất ít mail mỗi giờ, và chỉ tới email thành viên trong team. Người dùng thật sẽ **không nhận được mail xác nhận** nếu không cấu hình SMTP riêng. Cách miễn phí:
   - **Resend SMTP:** host `smtp.resend.com`, port `465`, user `resend`, password = API key. Cần **verify một domain** của bạn trên resend.com/domains thì mới gửi tới người lạ được.
   - Hoặc Brevo (300 mail/ngày miễn phí).
5. **Authentication → Attack Protection:** bật **CAPTCHA (Cloudflare Turnstile, miễn phí)** nếu mở rộng công khai.
6. **Realtime → Settings:** tắt *Allow public access*, chỉ cho phép private channels.

### 5.3 Đăng nhập Google

1. Vào https://console.cloud.google.com, tạo project, rồi mở *APIs & Services → OAuth consent screen*. Điền tên app và email hỗ trợ; scope chỉ cần `email`, `profile`, `openid`.
2. Mở *Credentials → Create credentials → OAuth client ID → Web application*.
   - **Authorized redirect URIs:** `https://<project-ref>.supabase.co/auth/v1/callback` (local: `http://127.0.0.1:54321/auth/v1/callback`).
3. Trên Supabase, mở *Authentication → Providers → Google*: bật lên, dán Client ID + Client Secret.
4. Đặt biến môi trường `NEXT_PUBLIC_AUTH_GOOGLE=true` để hiện nút Google.
5. Muốn dùng Google ở local:

   ```bash
   export SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=...
   export SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=...
   ```

   Sau đó sửa `enabled = true` ở mục `[auth.external.google]` trong `supabase/config.toml`, rồi `supabase stop && supabase start`.

### 5.4 Email góp ý (Resend, miễn phí)

1. Đăng ký https://resend.com, tạo API key (quyền *Sending access*).
2. Đặt biến môi trường:
   - `RESEND_API_KEY=re_...`
   - `FEEDBACK_TO_EMAIL=<email nhận góp ý>`. Khi **chưa verify domain**, đây phải là đúng email đã đăng ký Resend; được dùng dạng `ten+bantron@gmail.com`.
   - `FEEDBACK_FROM_EMAIL`: để trống thì dùng `onboarding@resend.dev`. Khi đã verify domain thì đặt `Bàn Tròn <gopy@domain-cua-ban.com>`.
3. Thử: mở `/feedback`, gửi một góp ý, rồi kiểm tra hộp thư. Lỗi gửi mail được ghi log trên Vercel (*Logs*, tìm `[feedback]`).
4. Xem góp ý lưu trong DB (kể cả khi mail lỗi):

   ```bash
   SUPABASE_SECRET_KEY=<secret key> npm run feedback:read      # 20 góp ý mới nhất
   ```

   Secret key lấy ở *Supabase → Project Settings → API Keys*. **Tuyệt đối không** đặt nó thành biến `NEXT_PUBLIC_`.

### 5.5 Vercel (biến môi trường)

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | publishable / anon key |
| `ENCRYPTION_KEY` | ✅ | `openssl rand -base64 32`. **Không** có tiền tố `NEXT_PUBLIC_`. Lưu bản sao an toàn. |
| `ENCRYPTION_KEY_PREVIOUS` | | Chỉ khi xoay khoá (mục 5.7) |
| `NEXT_PUBLIC_AUTH_GOOGLE` | | `true` để hiện nút Google |
| `RESEND_API_KEY`, `FEEDBACK_TO_EMAIL`, `FEEDBACK_FROM_EMAIL` | | Gửi mail góp ý |

Sau khi đổi biến môi trường phải **Redeploy**: các biến `NEXT_PUBLIC_*` và CSP được gắn vào lúc build.

### 5.6 GitHub CI/CD

1. Push repo lên GitHub. Tab *Actions* sẽ tự chạy **CI** (khoảng 6–10 phút, phần lớn là thời gian dựng Supabase).
2. **Settings → Branches → Add rule** cho `main`: bật *Require status checks to pass*, chọn `Lint & typecheck` và `Tests`. Nhờ vậy code lỗi không vào được `main`.
3. (Tuỳ chọn) Tự động đẩy migration: *Settings → Secrets and variables → Actions* thêm `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`.
4. Vercel: *Import* repo, khai báo biến môi trường như mục 5.5. Mỗi lần push, Vercel tự deploy (PR có link preview riêng).

### 5.7 Xoay vòng khoá mã hoá (khi nghi lộ khoá)

1. Tạo khoá mới. Đặt `ENCRYPTION_KEY_PREVIOUS=<khoá cũ>`, `ENCRYPTION_KEY=<khoá mới>`, rồi Redeploy.
2. Dữ liệu mới dùng khoá mới, dữ liệu cũ vẫn đọc được. Hồ sơ tự mã hoá lại khi chủ hồ sơ mở trang hồ sơ.
3. **Đừng xoá `ENCRYPTION_KEY_PREVIOUS`** khi vẫn còn dữ liệu cũ cần đọc. Chat và bảng vẽ cũ vẫn dùng khoá cũ cho tới khi được sửa.

---

## 6. Chạy test

```bash
supabase start          # cần Docker
npm test                # toàn bộ (tự build và chạy app ở cổng 3100)
npm run test:unit       # nhanh, không cần trình duyệt
npm run test:security   # tấn công API
npm run test:e2e        # 2 trình duyệt thật
npm run lint && npm run typecheck
```

- Test tự lấy secret key **local** từ `supabase status`, không lưu vào file nào. Helper chỉ cho chạy với Supabase local, không chạy vào DB thật.
- Test lỗi thì xem lại bằng: `npx playwright show-trace test-results/<thư mục>/trace.zip`.

---

## 7. File mới / thay đổi chính

```
supabase/migrations/20261118000000_accounts_privacy.sql   # toàn bộ DB mới (hồ sơ, duyệt, rate limit, góp ý...)
supabase/config.toml                                      # auth: xác nhận email, mật khẩu mạnh, Google, redirect
next.config.ts                                            # CSP + header bảo mật
src/lib/server/keys.ts        # khoá chính, HKDF, mã hoá phía server (chỉ dùng ở server)
src/lib/server/supabase.ts    # client theo JWT người dùng cho API
src/lib/crypto.ts             # mã hoá phía trình duyệt (WebCrypto)
src/lib/auth.ts, safe-next.ts # phiên đăng nhập, chuyển dữ liệu khách, chống open redirect
src/lib/profile.ts, feedback.ts
src/app/api/rooms/[id]/keys   # cấp khoá phòng
src/app/api/profile           # hồ sơ mã hoá
src/app/api/feedback          # góp ý + Resend
src/app/{login,account,auth/callback,auth/reset,feedback,terms,privacy}
src/components/auth/*, feedback/*, legal/*, room/RoomSettings.tsx, home/{AccountButton,RoomLists}.tsx
scripts/read-feedback.ts      # đọc góp ý đã mã hoá
.github/workflows/{ci,deploy-db}.yml, .github/dependabot.yml
tests/unit/{accounts,feedback}.spec.ts
tests/security/{accounts,feedback}.spec.ts
tests/e2e/{accounts,input-network}.spec.ts
```

---

## 8. Việc nên làm tiếp

1. **LICENSE / bản quyền:** bạn push git xong thì gọi mình. Cần bạn chọn mở mã nguồn (MIT, AGPL...) hay giữ bản quyền đóng.
2. Điền thông tin vận hành vào `/terms` và `/privacy`, và nhờ người có chuyên môn pháp lý rà soát.
3. Verify domain trên Resend để dùng chung cho SMTP Supabase (mail xác nhận) và mail góp ý.
4. Chuyển bucket ảnh sang private + signed URL nếu cần riêng tư cho ảnh.
5. Bật CAPTCHA Turnstile trước khi quảng bá rộng.
6. Chưa test: dán ảnh từ clipboard, hiệu năng khi bảng có hơn 1000 phần tử, request `keepalive` vượt 64KB.
