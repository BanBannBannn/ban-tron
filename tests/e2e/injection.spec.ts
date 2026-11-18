/**
 * Một THÀNH VIÊN xấu trong phòng cố tấn công người khác qua dữ liệu:
 * - lưu phần tử độc hại vào DB (qua REST API, bỏ qua giao diện)
 * - gửi broadcast độc hại (phần tử, đổi tên phòng giả, presence giả, khoá giả)
 */
import { test, expect, type Page } from "@playwright/test";
import { cryptoFor, encRow, joinRoom, newUser, openHome, createRoomUI, waitConnected, type TestUser } from "../helpers";
import { roomChannelConfig, roomTopic } from "../../src/lib/channel";

const EVIL = "https://evil.test";

function evilUrl(tag: string) {
  return `url(${EVIL}/${tag})`;
}

/** Bẫy mọi request ra domain lạ (CSS url(), ảnh, link...). */
async function trapEvil(page: Page) {
  const hits: string[] = [];
  await page.route(`${EVIL}/**`, (route) => {
    hits.push(route.request().url());
    return route.abort();
  });
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  return { hits, dialogs };
}

function maliciousRows(roomId: string) {
  const row = (type: string, data: Record<string, unknown>) => ({ id: crypto.randomUUID(), room_id: roomId, type, z: 1, data });
  return [
    row("text", {
      x: 100,
      y: 100,
      w: 300,
      h: 40,
      color: `red; background: ${evilUrl("text-color")}`,
      fontSize: 18,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: `left; background: ${evilUrl("align")}` },
            content: [
              {
                type: "text",
                text: "Bấm vào đây",
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: "javascript:alert('xss')",
                      class: "fixed inset-0 z-[9999] bg-red-500",
                      target: "_self",
                    },
                  },
                ],
              },
              {
                type: "text",
                text: " chữ màu",
                marks: [
                  {
                    type: "textStyle",
                    attrs: { color: `red; position: fixed; inset: 0; z-index: 9999; background: ${evilUrl("span")}` },
                  },
                  { type: "highlight", attrs: { color: `yellow; background-image: ${evilUrl("hl")}` } },
                ],
              },
            ],
          },
        ],
      },
    }),
    row("shape", {
      x: 500,
      y: 100,
      w: 160,
      h: 100,
      shape: "rect",
      stroke: evilUrl("stroke"),
      fill: evilUrl("fill"),
      strokeWidth: 2,
      dash: "solid",
      fontSize: 18,
      textColor: `red; background: ${evilUrl("label")}`,
      text: "<img src=x onerror=alert(1)>",
    }),
    row("note", { x: 100, y: 300, w: 200, h: 200, minH: 200, bg: evilUrl("note-bg"), fontSize: 18, doc: { type: "doc", content: [{ type: "paragraph" }] } }),
    row("image", { x: 400, y: 300, w: 100, h: 100, ratio: 1, src: `${EVIL}/pixel.png` }),
    row("ink", {
      x: 700,
      y: 300,
      w: 50,
      h: 50,
      ow: 50,
      oh: 50,
      color: evilUrl("ink"),
      size: 4,
      points: [
        [0, 0, 0.5],
        [50, 50, 0.5],
      ],
    }),
    row("shape", { x: -1e12, y: 1e12, w: 1e15, h: 1e15, shape: "rect", stroke: "#000000", fill: "none", strokeWidth: 2, dash: "solid", fontSize: 18 }),
  ];
}

async function setup(browser: import("@playwright/test").Browser) {
  const victim = await openHome(browser, "Nạn nhân");
  const url = await createRoomUI(victim.page, "Phòng bị tấn công");
  const slug = url.split("/r/")[1];
  const attacker: TestUser = await newUser();
  const room = await joinRoom(attacker, slug);
  return { victim, url, attacker, roomId: room.id };
}

async function assertSafe(page: Page, trap: { hits: string[]; dialogs: string[] }) {
  await page.waitForTimeout(1500);
  expect(trap.dialogs, "có alert() chạy → XSS").toHaveLength(0);
  expect(trap.hits, "trình duyệt gửi request ra domain lạ (lộ IP / theo dõi)").toHaveLength(0);
  const fixed = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-el] *")).filter((n) => getComputedStyle(n).position === "fixed").length,
  );
  expect(fixed, "nội dung phần tử phủ đè toàn màn hình (UI redress)").toBe(0);
  const jsLinks = await page.locator('a[href^="javascript:" i]').count();
  expect(jsLinks).toBe(0);
  const injectedClass = await page.locator("[data-el] a.fixed, [data-el] .z-\\[9999\\]").count();
  expect(injectedClass, "class tuỳ ý bị chèn vào DOM").toBe(0);
  // giao diện vẫn bấm được
  await expect(page.locator('[data-tip="Trò chuyện"]')).toBeVisible();
}

test("phần tử độc hại lưu trong DB không gây XSS / theo dõi / phủ giao diện", async ({ browser }) => {
  const { victim, url, attacker, roomId } = await setup(browser);
  // kẻ xấu là thành viên → lấy được khoá phòng và mã hoá dữ liệu độc hại hợp lệ
  const c = await cryptoFor(attacker, roomId);
  const ins = await attacker.sb.from("elements").insert(await Promise.all(maliciousRows(roomId).map((r) => encRow(c, r))));
  expect(ins.error).toBeNull();

  const trap = await trapEvil(victim.page);
  await victim.page.goto(url);
  await waitConnected(victim.page);
  await assertSafe(victim.page, trap);
  // nút "xem toàn bộ" không bị phá bởi toạ độ khổng lồ
  await victim.page.keyboard.press("Shift+Digit1");
  await victim.page.waitForTimeout(500);
  expect(victim.errors).toEqual([]);
});

test("broadcast độc hại từ thành viên xấu bị vô hiệu", async ({ browser }) => {
  const { victim, attacker, roomId } = await setup(browser);
  const trap = await trapEvil(victim.page);
  const roomNameEl = victim.page.locator('button[title="Đổi tên phòng"]');
  const roomNameBefore = await roomNameEl.innerText();

  const ch = attacker.sb.channel(roomTopic(roomId), roomChannelConfig(attacker.id));
  await new Promise<void>((resolve) => ch.subscribe((s) => s === "SUBSCRIBED" && resolve()));
  // presence với màu / tên độc hại
  await ch.track({ name: "<b>Hacker</b>".repeat(20), color: evilUrl("avatar"), joinedAt: Date.now() });
  const send = (event: string, data: unknown, from = attacker.id) =>
    ch.send({ type: "broadcast", event, payload: { from, data } });

  const rows = maliciousRows(roomId).map(({ id, type, z, data }) => ({ id, type, z, ...data }));
  await send("el", { upsert: rows });
  await send("el-live", rows);
  await send("draft", { el: rows[1] });
  await send("room", { name: "TÊN PHÒNG GIẢ MẠO" });
  await send("lock", { id: rows[0].id, on: true }, "00000000-0000-0000-0000-000000000000");
  await send("cursor", { x: "1px); background: url(https://evil.test/cursor", y: 0 });
  await send("laser", [[0, 0], [1e9, "x"]]);
  await send("typing", { name: "<img src=x onerror=alert(1)>" });
  await victim.page.waitForTimeout(1500);

  await assertSafe(victim.page, trap);
  expect(await roomNameEl.innerText(), "đổi tên phòng giả qua broadcast").toBe(roomNameBefore);
  const avatarBg = await victim.page.evaluate(() =>
    Array.from(document.querySelectorAll("[title]")).some((n) => (n as HTMLElement).style.background.includes("evil")),
  );
  expect(avatarBg).toBe(false);
  await attacker.sb.removeChannel(ch);
  expect(victim.errors).toEqual([]);
});
