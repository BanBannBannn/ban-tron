/**
 * Các mục còn treo từ phiên trước: gõ tiếng Việt qua bộ gõ (IME Telex/VNI), cảm ứng trên mobile,
 * mất mạng rồi kết nối lại.
 */
import { test, expect, type Page, type CDPSession } from "@playwright/test";
import { adminClient, createRoomUI, drag, elementCount, joinRoomUI, openHome, waitConnected } from "../helpers";

/**
 * Mô phỏng bộ gõ kiểu macOS / ibus (có "composition"): từng bước Telex gõ "V-i-e-e-j-t"
 * hiển thị chữ đang ghép, cuối cùng chốt chữ hoàn chỉnh.
 */
async function imeType(cdp: CDPSession, steps: string[], commit: string) {
  for (const s of steps) {
    await cdp.send("Input.imeSetComposition", { text: s, selectionStart: s.length, selectionEnd: s.length });
  }
  await cdp.send("Input.insertText", { text: commit });
}

/** Mô phỏng Unikey / EVKey (không có composition): gõ chữ thường, xoá lùi rồi thay bằng chữ có dấu. */
async function unikeyType(page: Page, word: string) {
  // "Việt" theo Telex: V i e e j t → Unikey gửi "Vie", rồi Backspace + "ê", Backspace + "ệ", rồi "t"
  if (word !== "Việt") throw new Error("chỉ hỗ trợ ví dụ Việt");
  await page.keyboard.type("Vie");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("ê");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("ệ");
  await page.keyboard.type("t");
}

test.describe("Gõ tiếng Việt (IME)", () => {
  test("chat: gõ Telex qua IME ra đúng chữ, Enter khi đang ghép chữ KHÔNG gửi tin", async ({ browser }) => {
    const A = await openHome(browser, "An");
    await createRoomUI(A.page);
    const a = A.page;
    const cdp = await a.context().newCDPSession(a);
    await a.getByRole("button", { name: "Trò chuyện" }).click();
    const input = a.locator('textarea[placeholder="Nhắn gì đó…"]');
    await input.click();

    await imeType(cdp, ["X", "Xi", "Xin"], "Xin");
    await a.keyboard.insertText(" ");
    await imeType(cdp, ["c", "ch", "cha", "chao", "chaof", "chào"], "chào");
    await a.keyboard.insertText(" ");
    await imeType(cdp, ["V", "Vi", "Vie", "Viê", "Việ", "Việt"], "Việt");
    await expect(input).toHaveValue("Xin chào Việt");

    // Enter trong lúc bộ gõ đang ghép chữ (isComposing) → chỉ chốt chữ, không gửi
    await input.evaluate((el) =>
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true })),
    );
    await a.waitForTimeout(300);
    await expect(input).toHaveValue("Xin chào Việt");
    await a.keyboard.press("Enter");
    await expect(a.locator("aside").getByText("Xin chào Việt")).toBeVisible();
    await expect(input).toHaveValue("");
    expect(A.errors).toEqual([]);
  });

  test("khối chữ: nhấp đúp rồi gõ IME ngay lập tức → không mất chữ, không lọt phím tắt", async ({ browser }) => {
    const A = await openHome(browser, "An");
    const url = await createRoomUI(A.page);
    const a = A.page;
    const cdp = await a.context().newCDPSession(a);

    await a.mouse.dblclick(500, 400);
    // không chờ: gõ ngay sau nhấp đúp như người dùng thật
    await imeType(cdp, ["T", "Ti", "Tie", "Tieé", "Tiế", "Tiến", "Tiếng"], "Tiếng");
    await a.keyboard.insertText(" ");
    await imeType(cdp, ["V", "Vi", "Việ", "Việt"], "Việt");
    await a.keyboard.press("Escape");
    await expect(a.locator("div[data-el]").filter({ hasText: "Tiếng Việt" })).toHaveCount(1);
    expect(await elementCount(a)).toBe(1); // không tạo phần tử rác do phím tắt (t = chữ, v = chọn...)

    const B = await joinRoomUI(a.context().browser()!, url, "Bình");
    await expect(B.page.locator("div[data-el]").filter({ hasText: "Tiếng Việt" })).toHaveCount(1);
  });

  test("khối chữ & ghi chú: kiểu Unikey (xoá lùi + thay chữ) và VNI ra đúng chữ", async ({ browser }) => {
    const A = await openHome(browser, "An");
    await createRoomUI(A.page);
    const a = A.page;
    const cdp = await a.context().newCDPSession(a);

    await a.mouse.dblclick(500, 400);
    await unikeyType(a, "Việt");
    await a.keyboard.press("Escape");
    await expect(a.locator("div[data-el]").filter({ hasText: /^Việt$/ })).toHaveCount(1);

    // VNI qua IME: V i e 6 5 t
    await a.keyboard.press("n");
    await a.mouse.click(900, 400);
    await imeType(cdp, ["V", "Vi", "Vie", "Vie6", "Viê", "Viê5", "Việ", "Việt"], "Việt");
    await a.keyboard.insertText(" Nam");
    await a.keyboard.press("Escape");
    await expect(a.locator("div[data-el]").filter({ hasText: "Việt Nam" })).toHaveCount(1);
    expect(await elementCount(a)).toBe(2);
    expect(A.errors).toEqual([]);
  });
});

test.describe("Cảm ứng (mobile / máy tính bảng)", () => {
  async function touch(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", points: [number, number][]) {
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 0.5 })),
    });
  }

  test("vẽ bằng 1 ngón tay; chụm 2 ngón để zoom mà không tạo nét vẽ thừa", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    const a = await ctx.newPage();
    await a.goto("/");
    await a.fill("#h-name", "Cảm ứng");
    await createRoomUI(a);
    const cdp = await ctx.newCDPSession(a);

    await a.keyboard.press("p");
    await touch(cdp, "touchStart", [[300, 300]]);
    for (let i = 1; i <= 10; i++) await touch(cdp, "touchMove", [[300 + i * 20, 300 + Math.sin(i) * 30]]);
    await touch(cdp, "touchEnd", []);
    await expect.poll(() => elementCount(a)).toBe(1);

    const zoom = () => a.locator('button[title="Về 100%"]').innerText().then((t) => parseInt(t));
    const z0 = await zoom();
    // 2 ngón đặt gần nhau rồi kéo ra xa
    await touch(cdp, "touchStart", [[500, 400]]);
    await touch(cdp, "touchStart", [[500, 400], [560, 400]]);
    for (let i = 1; i <= 8; i++) await touch(cdp, "touchMove", [[500 - i * 20, 400], [560 + i * 20, 400]]);
    await touch(cdp, "touchEnd", []);
    await expect.poll(zoom).toBeGreaterThan(z0);
    await a.waitForTimeout(400);
    expect(await elementCount(a), "chụm ngón tạo ra nét vẽ thừa").toBe(1);
    await ctx.close();
  });
});

test.describe("Mất mạng rồi kết nối lại", () => {
  test("vẽ khi mất mạng → có mạng lại thì tự lưu DB; người khác tải lại vẫn thấy", async ({ browser }) => {
    const A = await openHome(browser, "An");
    const url = await createRoomUI(A.page);
    const a = A.page;
    const slug = url.split("/r/")[1];
    const room = (await adminClient().from("rooms").select("id").eq("slug", slug).single()).data!;
    const count = async () =>
      (await adminClient().from("elements").select("id", { count: "exact", head: true }).eq("room_id", room.id)).count;

    await a.context().setOffline(true);
    await a.keyboard.press("r");
    await drag(a, [[500, 300], [700, 450]]);
    await a.keyboard.press("p");
    await drag(a, [[300, 600], [400, 650], [500, 600]]);
    await a.waitForTimeout(1500);
    expect(await count(), "lúc mất mạng mà vẫn lưu được?").toBe(0);

    await a.context().setOffline(false);
    await expect.poll(count, { timeout: 25_000 }).toBe(2);

    const B = await joinRoomUI(browser, url, "Bình");
    await expect.poll(() => elementCount(B.page)).toBe(2);
    expect(A.errors.filter((e) => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|lưu thất bại|net::/i.test(e))).toEqual([]);
  });

  test("chat khi mất mạng → báo lỗi, có mạng lại bấm thử lại → gửi được", async ({ browser }) => {
    const A = await openHome(browser, "An");
    const url = await createRoomUI(A.page);
    const a = A.page;
    const B = await joinRoomUI(browser, url, "Bình");
    await a.getByRole("button", { name: "Trò chuyện" }).click();

    await a.context().setOffline(true);
    await a.fill('textarea[placeholder="Nhắn gì đó…"]', "gửi lúc mất mạng");
    await a.keyboard.press("Enter");
    await expect(a.getByText(/Gửi lỗi · thử lại/)).toBeVisible({ timeout: 15_000 });

    await a.context().setOffline(false);
    await a.getByText(/Gửi lỗi · thử lại/).click();
    await expect(a.getByText(/Gửi lỗi · thử lại/)).toHaveCount(0);
    await B.page.getByRole("button", { name: "Trò chuyện" }).click();
    await expect(B.page.locator("aside").getByText("gửi lúc mất mạng")).toHaveCount(1);
  });

  test("mất kết nối realtime rồi nối lại → tự tải lại thay đổi bị lỡ", async ({ browser }) => {
    const A = await openHome(browser, "An");
    const url = await createRoomUI(A.page);
    const a = A.page;

    // B ghi lại các websocket để có thể "rút dây mạng" (giả lập rớt wifi / laptop ngủ)
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      const W = window.WebSocket;
      const list: WebSocket[] = [];
      (window as unknown as { __sockets: WebSocket[] }).__sockets = list;
      window.WebSocket = class extends W {
        constructor(...args: ConstructorParameters<typeof WebSocket>) {
          super(...args);
          list.push(this);
        }
      } as typeof WebSocket;
    });
    const b = await ctx.newPage();
    await b.goto(url);
    await b.fill("#nd-name", "Bình");
    await b.click("text=Vào phòng");
    await waitConnected(b);

    await ctx.setOffline(true);
    await b.evaluate(() => {
      for (const ws of (window as unknown as { __sockets: WebSocket[] }).__sockets) ws.close();
    });
    await expect(b.locator('[data-tip="Mất kết nối, đang thử lại…"]')).toBeVisible({ timeout: 15_000 });

    await a.keyboard.press("r");
    await drag(a, [[500, 300], [700, 450]]);
    await a.waitForTimeout(1500); // A đã lưu DB; B đang offline nên lỡ broadcast
    expect(await elementCount(b)).toBe(0);

    await ctx.setOffline(false);
    await waitConnected(b);
    await expect.poll(() => elementCount(b), { timeout: 30_000 }).toBe(1);
    await ctx.close();
  });
});
