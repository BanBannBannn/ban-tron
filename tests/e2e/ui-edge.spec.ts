/** Các tình huống "dị" dễ gây bug giao diện. */
import { test, expect } from "@playwright/test";
import { centerOf, createRoomUI, drag, elementCount, joinRoomUI, openHome, trackErrors, waitConnected } from "../helpers";

test("xoá phần tử khi người khác đang kéo nó → không bị 'sống lại'", async ({ browser }) => {
  const A = await openHome(browser, "An");
  const url = await createRoomUI(A.page);
  const a = A.page;
  await a.keyboard.press("r");
  await drag(a, [[600, 300], [800, 450]]);
  const B = await joinRoomUI(browser, url, "Bình");
  const b = B.page;
  await expect.poll(() => elementCount(b)).toBe(1);

  // B bắt đầu kéo (giữ chuột) ...
  const c = await centerOf(b, "div[data-el]");
  await b.mouse.move(c.x, c.y);
  await b.mouse.down();
  await b.mouse.move(c.x + 30, c.y + 30, { steps: 3 });
  // ... thì A xoá hình
  await a.keyboard.press("Delete");
  await a.waitForTimeout(800);
  await b.mouse.move(c.x + 80, c.y + 60, { steps: 3 });
  await b.mouse.up();
  await b.waitForTimeout(1200);

  expect(await elementCount(a), "hình bị xoá lại hiện ra ở A").toBe(0);
  expect(await elementCount(b), "hình bị xoá vẫn còn ở B").toBe(0);
  await a.reload();
  await waitConnected(a);
  await a.waitForTimeout(800);
  expect(await elementCount(a), "hình bị xoá được lưu lại vào DB").toBe(0);
});

test("hai người cùng sửa một khối chữ → người thứ hai bị chặn (khoá)", async ({ browser }) => {
  const A = await openHome(browser, "An");
  const url = await createRoomUI(A.page);
  const a = A.page;
  await a.mouse.dblclick(500, 400);
  await a.keyboard.type("Nội dung của An");
  const B = await joinRoomUI(browser, url, "Bình");
  const b = B.page;
  await expect(b.getByText("An đang sửa…")).toBeVisible();
  const tc = await centerOf(b, ".rt-text");
  await b.mouse.dblclick(tc.x, tc.y);
  await expect(b.getByText("An đang sửa phần tử này")).toBeVisible();
  await expect(b.locator("[data-editing]")).toHaveCount(0);
  await a.keyboard.press("Escape");
  await expect(b.getByText("An đang sửa…")).toHaveCount(0);
});

test("đang sửa chữ: Delete/Backspace không xoá phần tử, Esc thoát, khối rỗng tự biến mất", async ({ browser }) => {
  const A = await openHome(browser, "An");
  await createRoomUI(A.page);
  const a = A.page;
  await a.mouse.dblclick(500, 400);
  await a.keyboard.type("abc");
  await a.keyboard.press("Backspace");
  await a.keyboard.press("Delete");
  await expect(a.locator("[data-editing]")).toHaveCount(1);
  await a.keyboard.press("Escape");
  await expect.poll(() => elementCount(a)).toBe(1);
  await expect(a.getByText("ab", { exact: true })).toBeVisible();

  // khối chữ rỗng → biến mất khi thoát
  await a.mouse.dblclick(500, 600);
  await a.keyboard.press("Escape");
  await expect.poll(() => elementCount(a)).toBe(1);
  // phím tắt không lọt vào khi gõ chữ: gõ "p" không đổi công cụ
  await a.mouse.dblclick(800, 600);
  await a.keyboard.type("pe");
  await a.keyboard.press("Escape");
  await expect(a.locator('[data-tip="Chọn · V"]')).toHaveAttribute("aria-pressed", "true");
});

test("mở bảng phím tắt rồi bấm phím → không đổi công cụ phía sau", async ({ browser }) => {
  const A = await openHome(browser, "An");
  await createRoomUI(A.page);
  const a = A.page;
  await a.keyboard.press("?");
  await expect(a.getByRole("heading", { name: "Phím tắt" })).toBeVisible();
  await a.keyboard.press("p");
  await a.keyboard.press("Escape");
  await expect(a.getByRole("heading", { name: "Phím tắt" })).toHaveCount(0);
  await expect(a.locator('[data-tip="Chọn · V"]')).toHaveAttribute("aria-pressed", "true");
});

test("bôi đen chữ trong khung chat rồi ⌘C → copy đúng chữ, không copy phần tử trên bảng", async ({ browser }) => {
  const A = await openHome(browser, "An");
  await createRoomUI(A.page);
  const a = A.page;
  await a.keyboard.press("r");
  await drag(a, [[500, 300], [700, 450]]); // hình đang được chọn
  await a.click('[data-tip="Trò chuyện"]');
  await a.fill('textarea[placeholder="Nhắn gì đó…"]', "đoạn chữ cần copy");
  await a.keyboard.press("Enter");
  await expect(a.locator("aside").getByText("đoạn chữ cần copy")).toBeVisible();
  // chọn lại hình rồi bôi đen chữ trong chat
  await a.locator("aside").getByText("đoạn chữ cần copy").dblclick();
  await a.locator("aside").getByText("đoạn chữ cần copy").selectText();
  await a.keyboard.press("ControlOrMeta+c");
  const clip = await a.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe("đoạn chữ cần copy");
});

test("vẽ xong tải lại trang ngay lập tức → nét vẽ không bị mất", async ({ browser }) => {
  const A = await openHome(browser, "An");
  await createRoomUI(A.page);
  const a = A.page;
  a.on("dialog", (d) => void d.accept());
  await a.keyboard.press("p");
  await drag(a, [[400, 400], [500, 450], [600, 400]]);
  await a.reload(); // không chờ debounce lưu
  await waitConnected(a);
  await expect.poll(() => elementCount(a), { timeout: 8000 }).toBe(1);
});

test("20 nét vẽ liên tiếp rồi hoàn tác hết → cả 2 phía đều sạch", async ({ browser }) => {
  const A = await openHome(browser, "An");
  const url = await createRoomUI(A.page);
  const a = A.page;
  const B = await joinRoomUI(browser, url, "Bình");
  await a.keyboard.press("p");
  for (let i = 0; i < 20; i++) {
    const y = 150 + i * 30;
    await drag(a, [[300, y], [500, y + 10], [700, y]]);
  }
  await expect.poll(() => elementCount(B.page)).toBe(20);
  for (let i = 0; i < 20; i++) await a.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => elementCount(a)).toBe(0);
  await expect.poll(() => elementCount(B.page)).toBe(0);
  await a.waitForTimeout(800);
  await a.reload();
  await waitConnected(a);
  await a.waitForTimeout(800);
  expect(await elementCount(a)).toBe(0);
});

test("tên có emoji / ký tự đặc biệt: avatar không vỡ ký tự, không chạy HTML", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = trackErrors(page);
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await page.goto("/");
  await page.fill("#h-name", "😀 <img src=x onerror=alert(1)>");
  await page.locator("#h-name").blur();
  const avatarText = await page.locator('button[aria-label="Đổi màu"] span').innerText();
  const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  expect(avatarText, "avatar chứa nửa ký tự emoji (surrogate lẻ)").not.toMatch(LONE);
  expect(avatarText.startsWith("😀")).toBe(true);
  await createRoomUI(page);
  const peersText = await page.locator('[aria-label="Người trong phòng"]').innerText();
  expect(peersText).not.toMatch(LONE);
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
});

test("zoom cực đại / cực tiểu bị giới hạn 10%–500%", async ({ browser }) => {
  const A = await openHome(browser, "An");
  await createRoomUI(A.page);
  const a = A.page;
  await a.mouse.move(700, 450);
  await a.keyboard.down("Control");
  for (let i = 0; i < 20; i++) await a.mouse.wheel(0, -800);
  await a.keyboard.up("Control");
  const zoomText = () => a.locator('button[title="Về 100%"]').innerText();
  expect(parseInt(await zoomText())).toBeLessThanOrEqual(500);
  await a.keyboard.down("Control");
  for (let i = 0; i < 40; i++) await a.mouse.wheel(0, 800);
  await a.keyboard.up("Control");
  expect(parseInt(await zoomText())).toBeGreaterThanOrEqual(10);
});

test("mã phòng lạ / không tồn tại → trang báo lỗi gọn gàng, không crash", async ({ page }) => {
  const errors = trackErrors(page);
  for (const path of ["/r/khong-ton-tai-123", "/r/ABC-DEFG-HIJ", "/r/%3Cscript%3E", "/r/" + "a".repeat(200)]) {
    await page.goto(path);
    await expect(page.getByText(/Không tìm thấy phòng|Có lỗi xảy ra/)).toBeVisible();
  }
  expect(errors.filter((e) => !e.includes("400"))).toEqual([]);
});

test("mobile: không bị tràn ngang, thanh công cụ không đè header", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/");
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "trang chủ tràn ngang").toBeLessThanOrEqual(0);
  await page.fill('input[placeholder="Tên phòng (không bắt buộc)"]', "Một cái tên phòng rất là dài dài dài dài dài");
  await page.click("text=Tạo phòng mới");
  await page.waitForURL(/\/r\//);
  await waitConnected(page);
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "phòng tràn ngang").toBeLessThanOrEqual(0);
  const left = await page.locator('a[aria-label="Trang chủ"]').locator("xpath=../..").boundingBox();
  const right = await page.locator('[aria-label="Người trong phòng"]').boundingBox();
  expect(left!.x + left!.width, "tên phòng đè lên cụm avatar").toBeLessThanOrEqual(right!.x);
});
