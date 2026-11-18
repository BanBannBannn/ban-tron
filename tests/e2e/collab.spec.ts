/** Luồng chính: 2 người cùng vẽ, sửa, chat trong một phòng. */
import { test, expect } from "@playwright/test";
import { centerOf, createRoomUI, drag, elementCount, joinRoomUI, openHome, waitConnected } from "../helpers";

test.describe.configure({ mode: "serial" });

test("tạo phòng, vẽ đủ loại phần tử, người thứ hai thấy đúng & đồng bộ realtime", async ({ browser }) => {
  const A = await openHome(browser, "An Nguyễn");
  const url = await createRoomUI(A.page, "Họp nhóm");
  const a = A.page;
  await expect(a.getByText("Bảng đang trống")).toBeVisible();

  // bút
  await a.keyboard.press("p");
  await drag(a, [[380, 300], [420, 260], [470, 320], [520, 270], [570, 330]]);
  // hình chữ nhật
  await a.keyboard.press("r");
  await drag(a, [[700, 250], [900, 380]]);
  // mũi tên
  await a.keyboard.press("a");
  await drag(a, [[900, 320], [1050, 420]]);
  // chữ (nhấp đúp chỗ trống)
  await a.keyboard.press("v");
  await a.mouse.dblclick(400, 480);
  await a.keyboard.type("Xin chào cả nhóm 👋");
  await a.keyboard.press("Escape");
  // ghi chú
  await a.keyboard.press("n");
  await a.mouse.click(1150, 250);
  await a.keyboard.type("Việc cần làm");
  await a.keyboard.press("Escape");
  // bảng: gõ vào ô đầu tiên rồi Tab sang ô kế
  await a.keyboard.press("b");
  await a.mouse.click(700, 600);
  await a.keyboard.type("Thiết kế");
  await a.keyboard.press("Tab");
  await a.keyboard.type("Lan");
  await a.keyboard.press("Escape");
  await a.mouse.click(1300, 840);
  await expect.poll(() => elementCount(a)).toBe(6);

  const B = await joinRoomUI(browser, url, "Bình Trần");
  const b = B.page;
  await expect.poll(() => elementCount(b)).toBe(6);
  const firstRow = (await b.locator(".rt-table tr").nth(1).innerText()).replace(/\s+/g, " ").trim();
  expect(firstRow.startsWith("Thiết kế Lan")).toBe(true);
  await expect(b.getByText("Xin chào cả nhóm 👋")).toBeVisible();

  // presence + con trỏ
  await expect(a.locator('[aria-label="Người trong phòng"] [title="Bình Trần"]')).toBeVisible();
  await b.mouse.move(600, 500);
  await b.mouse.move(650, 520, { steps: 5 });
  await expect
    .poll(() =>
      a.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".remote-cursor")).some(
          (n) => n.style.opacity === "1" && n.textContent?.includes("Bình"),
        ),
      ),
    )
    .toBe(true);

  // B vẽ → A thấy
  await b.keyboard.press("p");
  await drag(b, [[300, 760], [350, 800], [420, 760]]);
  await expect.poll(() => elementCount(a)).toBe(7);

  // B kéo hình chữ nhật → A thấy vị trí mới
  await b.keyboard.press("v");
  const rectSel = "div[data-el]:has(> svg rect)";
  const before = await a.locator(rectSel).evaluate((n) => (n as HTMLElement).style.left);
  const rc = await centerOf(b, rectSel);
  await drag(b, [[rc.x, rc.y], [rc.x + 60, rc.y + 40], [rc.x + 90, rc.y + 60]]);
  await expect.poll(() => a.locator(rectSel).evaluate((n) => (n as HTMLElement).style.left)).not.toBe(before);

  // sửa chữ: in đậm → B thấy
  const tc = await centerOf(a, ".rt-text");
  await a.mouse.dblclick(tc.x, tc.y);
  await a.keyboard.press("ControlOrMeta+a");
  await a.keyboard.press("ControlOrMeta+b");
  await a.keyboard.press("Escape");
  await expect(b.locator(".rt-text strong")).toBeVisible();

  // nhãn hình
  const rc2 = await centerOf(a, rectSel);
  await a.mouse.dblclick(rc2.x, rc2.y);
  await a.keyboard.type("Bước 1");
  await a.keyboard.press("Escape");
  await expect(b.getByText("Bước 1")).toBeVisible();

  // undo / redo đồng bộ
  await a.mouse.click(1300, 840);
  const n = await elementCount(a);
  await a.keyboard.press("ControlOrMeta+z"); // bỏ nhãn
  await a.keyboard.press("ControlOrMeta+z"); // bỏ in đậm
  await expect(b.locator(".rt-text strong")).toHaveCount(0);
  await a.keyboard.press("ControlOrMeta+Shift+z");
  await expect(b.locator(".rt-text strong")).toBeVisible();
  expect(await elementCount(a)).toBe(n);

  // tải lại → còn nguyên
  await a.waitForTimeout(600);
  await a.reload();
  await waitConnected(a);
  await expect.poll(() => elementCount(a)).toBe(n);

  expect(A.errors).toEqual([]);
  expect(B.errors).toEqual([]);
});

test("chat: gửi, nhận, badge chưa đọc, đang nhập, nội dung HTML hiển thị dạng chữ", async ({ browser }) => {
  const A = await openHome(browser, "An");
  const url = await createRoomUI(A.page);
  const B = await joinRoomUI(browser, url, "Bình");
  const a = A.page;
  const b = B.page;
  const dialogs: string[] = [];
  b.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });

  await a.click('[data-tip="Trò chuyện"]');
  const input = 'textarea[placeholder="Nhắn gì đó…"]';
  await a.fill(input, "Chào Bình <img src=x onerror=alert(1)> javascript:alert(2) https://example.com");
  await a.keyboard.press("Enter");
  await expect(b.locator('[data-tip="Trò chuyện"] span')).toHaveText("1");

  await b.click('[data-tip="Trò chuyện"]');
  await expect(b.getByText("Chào Bình <img src=x onerror=alert(1)>", { exact: false })).toBeVisible();
  await expect(b.locator('aside a[href^="javascript"]')).toHaveCount(0);
  await expect(b.locator('aside a[href="https://example.com"]')).toHaveCount(1);
  await expect(b.locator('[data-tip="Trò chuyện"] span')).toHaveCount(0);

  await b.fill(input, "Ok");
  await expect(a.getByText("Bình đang nhập…")).toBeVisible();
  await b.keyboard.press("Enter");
  await expect(a.locator("aside").getByText("Ok", { exact: true })).toBeVisible();

  // Shift+Enter xuống dòng, không gửi
  await a.fill(input, "dòng 1");
  await a.keyboard.press("Shift+Enter");
  await a.keyboard.type("dòng 2");
  expect(await a.inputValue(input)).toBe("dòng 1\ndòng 2");

  expect(dialogs).toEqual([]);
  expect(A.errors).toEqual([]);
  expect(B.errors).toEqual([]);
});
