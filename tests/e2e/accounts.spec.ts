/** Luồng tài khoản, hồ sơ mã hoá, duyệt người vào phòng, chat mã hoá — chạy trên trình duyệt thật. */
import { test, expect, type Browser } from "@playwright/test";
import {
  adminClient,
  createRoomUI,
  cryptoFor,
  encMessage,
  fakeCipher,
  joinRoom,
  joinRoomUI,
  newAccount,
  newUser,
  openHome,
  randomEmail,
  trackErrors,
  waitConnected,
  waitForEmailLink,
} from "../helpers";

test.describe.configure({ mode: "serial" });

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  return { ctx, page, errors: trackErrors(page) };
}

test("khách tạo phòng → đăng ký email → xác nhận qua email → phòng chuyển sang tài khoản", async ({ browser }) => {
  const A = await openHome(browser, "Khách An");
  const roomUrl = await createRoomUI(A.page, "Phòng khách tạo");
  const a = A.page;

  await a.goto("/login?mode=signup");
  const email = randomEmail("signup");
  await a.fill("#au-name", "An Đăng Ký");
  await a.fill("#au-email", email);
  await a.fill("#au-pw", "yeu");
  await a.fill("#au-pw2", "yeu");
  await a.click('button[type="submit"]');
  await expect(a.locator('p[role="alert"]')).toContainText("ít nhất 8 ký tự");

  await a.fill("#au-pw", "matkhau123");
  await a.fill("#au-pw2", "matkhau124");
  await a.click('button[type="submit"]');
  await expect(a.locator('p[role="alert"]')).toContainText("không khớp");

  await a.fill("#au-pw2", "matkhau123");
  await a.click('button[type="submit"]');
  await expect(a.getByTestId("auth-sent")).toBeVisible();

  // Chưa xác nhận email thì chưa đăng nhập được
  const link = await waitForEmailLink(email);
  await a.goto(link);
  await a.waitForURL((u) => u.pathname === "/", { timeout: 15_000 });
  await expect(a.getByLabel("Tài khoản")).toBeVisible();
  await expect(a.getByTestId("my-rooms")).toContainText("Phòng khách tạo");

  // vẫn là chủ phòng (thấy nút cài đặt)
  await a.goto(roomUrl);
  await waitConnected(a);
  await expect(a.getByRole("button", { name: "Cài đặt phòng" })).toBeVisible();
  expect(A.errors).toEqual([]);
});

test("hồ sơ: lưu thông tin cá nhân → DB chỉ có bản mã, tải lại vẫn đúng; đăng xuất / đăng nhập lại", async ({ browser }) => {
  const acc = await newAccount("Chi Lê");
  const P = await newPage(browser);
  const p = P.page;

  await p.goto("/login");
  await p.fill("#au-email", acc.email!);
  await p.fill("#au-pw", "sai-mat-khau-1");
  await p.click('button[type="submit"]');
  await expect(p.locator('p[role="alert"]')).toContainText("Email hoặc mật khẩu không đúng");
  await p.fill("#au-pw", acc.password!);
  await p.click('button[type="submit"]');
  await p.waitForURL((u) => u.pathname === "/");

  await p.goto("/account");
  await expect(p.locator("#ac-name")).toHaveValue("Chi Lê");
  await p.fill("#ac-full", "Lê Thị Chi");
  await p.fill("#ac-phone", "abc");
  await p.click("text=Lưu hồ sơ");
  await expect(p.getByText("Số điện thoại không hợp lệ")).toBeVisible();
  await p.fill("#ac-phone", "0912 345 678");
  await p.fill("#ac-bd", "1998-03-15");
  await p.click("text=Lưu hồ sơ");
  await expect(p.getByText("Đã lưu hồ sơ")).toBeVisible();

  const raw = (await adminClient().from("profiles").select("*").eq("id", acc.id).single()).data!;
  expect(raw.phone_enc).toMatch(/^s1\./);
  expect(JSON.stringify(raw)).not.toContain("0912");
  expect(JSON.stringify(raw)).not.toContain("Lê Thị Chi");

  await p.reload();
  await expect(p.locator("#ac-full")).toHaveValue("Lê Thị Chi");
  await expect(p.locator("#ac-phone")).toHaveValue("0912 345 678");
  await expect(p.locator("#ac-bd")).toHaveValue("1998-03-15");

  await p.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await p.waitForURL((u) => u.pathname === "/");
  await expect(p.getByRole("link", { name: "Đăng nhập", exact: true })).toBeVisible();
  // vào thẳng /account khi chưa đăng nhập → chuyển về trang đăng nhập
  await p.goto("/account");
  await p.waitForURL(/\/login/);
  // 400 duy nhất là lần cố tình đăng nhập sai mật khẩu ở trên
  expect(P.errors.filter((e) => !e.includes("status of 400"))).toEqual([]);
});

test("open redirect: ?next=//evil.test sau khi đăng nhập vẫn ở lại trang mình", async ({ browser }) => {
  const acc = await newAccount("Dũng");
  const P = await newPage(browser);
  for (const evil of ["//evil.test", "https://evil.test", "/\\evil.test"]) {
    await P.page.goto(`/login?next=${encodeURIComponent(evil)}`);
    if (await P.page.locator("#au-email").isVisible()) {
      await P.page.fill("#au-email", acc.email!);
      await P.page.fill("#au-pw", acc.password!);
      await P.page.click('button[type="submit"]');
    } else {
      await P.page.getByRole("link", { name: "Tiếp tục" }).click();
    }
    await P.page.waitForLoadState();
    await P.page.waitForTimeout(500);
    expect(new URL(P.page.url()).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  }
});

test("duyệt người vào phòng: chờ duyệt → được duyệt → bị chặn → không vào lại được", async ({ browser }) => {
  const A = await openHome(browser, "Chủ phòng An");
  const a = A.page;
  await a.getByLabel("Duyệt người vào phòng").check();
  const url = await createRoomUI(a, "Phòng kín");
  await a.keyboard.press("r");
  await a.mouse.move(600, 300);
  await a.mouse.down();
  await a.mouse.move(800, 450, { steps: 4 });
  await a.mouse.up();

  const B = await newPage(browser);
  const b = B.page;
  await b.goto(url);
  await expect(b.getByText("Đang chờ chủ phòng duyệt")).toBeVisible();
  await expect(b.locator("div[data-el]")).toHaveCount(0);
  await b.fill("#pending-name", "Bình xin vào");
  await b.click("text=Lưu");

  await expect(a.getByTestId("pending-badge")).toHaveText("1", { timeout: 15_000 });
  await a.getByRole("button", { name: "Cài đặt phòng" }).click();
  const row = a.getByTestId("pending-row");
  await expect(row).toContainText("Bình xin vào", { timeout: 10_000 });
  await row.getByRole("button", { name: "Duyệt" }).click();

  await waitConnected(b);
  await expect.poll(() => b.locator("div[data-el]").count(), { timeout: 10_000 }).toBe(1);

  // chặn
  await a.getByRole("button", { name: "Chặn Bình xin vào" }).click();
  await expect(b.getByText("Bạn đã được mời ra khỏi phòng")).toBeVisible({ timeout: 15_000 });
  await b.reload();
  await expect(b.getByText("Bạn không thể vào phòng này")).toBeVisible();
  expect(A.errors).toEqual([]);
  expect(B.errors.filter((e) => !/403|Failed to load resource/.test(e))).toEqual([]);
});

test("chat mã hoá: người kia đọc được, DB chỉ có bản mã; tin rác bị đánh dấu không giải mã được", async ({ browser }) => {
  const A = await openHome(browser, "An");
  const url = await createRoomUI(A.page, "Phòng chat");
  const B = await joinRoomUI(browser, url, "Bình");
  const a = A.page;
  const b = B.page;
  const slug = url.split("/r/")[1];

  await a.getByRole("button", { name: "Trò chuyện" }).click();
  await expect(a.locator("aside").getByText("Mã hoá")).toBeVisible();
  await a.fill('textarea[placeholder="Nhắn gì đó…"]', "Mật khẩu wifi: banTron2026");
  await a.keyboard.press("Enter");
  await b.getByRole("button", { name: "Trò chuyện" }).click();
  await expect(b.locator("aside").getByText("Mật khẩu wifi: banTron2026")).toBeVisible();
  await expect(b.locator("aside").getByText("· khách")).toBeVisible();

  const room = (await adminClient().from("rooms").select("id").eq("slug", slug).single()).data!;
  const { data: rows } = await adminClient().from("messages").select("content").eq("room_id", room.id);
  expect(rows!.length).toBe(1);
  expect(rows![0].content).toMatch(/^e1\./);
  expect(rows![0].content).not.toContain("wifi");

  // thành viên xấu chèn bản mã giả / bản mã chép từ tin khác
  const evil = await newUser();
  await joinRoom(evil, slug);
  const c = await cryptoFor(evil, room.id);
  const real = await encMessage(c, room.id, "ok");
  await evil.sb.from("messages").insert({ ...real, id: crypto.randomUUID() }); // sai AAD
  await evil.sb.from("messages").insert({ room_id: room.id, author_name: "x", author_color: "#000000", content: fakeCipher() });
  await expect(b.locator("aside").getByText("Không giải mã được tin nhắn này")).toHaveCount(2);
  expect(B.errors).toEqual([]);
});

test("tài khoản tạo phòng công khai → người khác thấy trong danh sách và vào được", async ({ browser }) => {
  const acc = await newAccount("Giáo viên");
  const tag = `Lớp ${Date.now().toString(36)}`;
  const slug = `pub-${Date.now().toString(36)}`;
  expect((await acc.sb.from("rooms").insert({ slug, name: tag, visibility: "public" })).error).toBeNull();

  const V = await newPage(browser);
  await V.page.goto("/");
  await V.page.getByLabel("Tìm phòng công khai").fill(tag);
  await V.page.getByTestId("public-rooms").getByText(tag).click();
  await V.page.waitForURL(new RegExp(`/r/${slug}$`));
  await expect(V.page.getByText("Chào bạn 👋")).toBeVisible();
});

test("góp ý & đánh giá: kiểm tra lỗi, gửi thành công; bot điền ô bẫy thì không được lưu", async ({ browser }) => {
  const P = await newPage(browser);
  const p = P.page;
  await p.setExtraHTTPHeaders({ "x-real-ip": `203.0.113.${Math.floor(Math.random() * 250)}` });
  const total = async () => (await adminClient().from("feedback").select("id", { count: "exact", head: true })).count ?? 0;

  await p.goto("/feedback?from=/r/abc-defg-hij");
  await p.getByRole("button", { name: "Gửi góp ý" }).click();
  await expect(p.getByText("Hãy chọn số sao")).toBeVisible();

  await p.getByRole("radio", { name: "Báo lỗi" }).click();
  await p.fill("#fb-msg", "ngắn");
  await p.getByRole("button", { name: "Gửi góp ý" }).click();
  await expect(p.getByText("ít nhất 10 ký tự")).toBeVisible();

  const before = await total();
  await p.getByRole("radio", { name: "Đánh giá chung" }).click();
  await p.getByRole("radio", { name: "5 sao" }).click();
  await p.fill("#fb-msg", "Bảng vẽ mượt, <b>rất thích</b> phần chat!");
  await p.waitForTimeout(2600); // người thật cần vài giây để điền form
  await p.getByRole("button", { name: "Gửi góp ý" }).click();
  await expect(p.getByTestId("feedback-done")).toBeVisible();
  await expect.poll(total).toBe(before + 1);

  // bot: điền ô ẩn → vẫn thấy "Cảm ơn" nhưng DB không đổi
  await p.getByRole("button", { name: "Gửi góp ý khác" }).click();
  await p.getByRole("radio", { name: "4 sao" }).click();
  await p.fill("#fb-website", "http://spam.test");
  await p.waitForTimeout(2600);
  await p.getByRole("button", { name: "Gửi góp ý" }).click();
  await expect(p.getByTestId("feedback-done")).toBeVisible();
  await p.waitForTimeout(500);
  expect(await total()).toBe(before + 1);
  expect(P.errors).toEqual([]);
});
