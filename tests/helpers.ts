import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { RoomCrypto, elAad, msgAad, toB64url } from "../src/lib/crypto";

export const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const APP_URL = process.env.TEST_BASE_URL ?? `http://localhost:${process.env.TEST_PORT ?? 3100}`;
export const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

if (!SB_URL || !SB_KEY) {
  throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (.env.local)");
}

export interface TestUser {
  sb: SupabaseClient;
  id: string;
  email?: string;
  password?: string;
}

/** Access token hiện tại của user test (để gọi API Next.js). */
export async function tokenOf(u: TestUser) {
  const { data } = await u.sb.auth.getSession();
  return data.session!.access_token;
}

// ───────────── admin (chỉ dùng trong test, chỉ với Supabase LOCAL) ─────────────
let adminKey: string | null = null;
function secretKey(): string {
  if (adminKey) return adminKey;
  adminKey = process.env.SUPABASE_SECRET_KEY ?? null;
  if (!adminKey) {
    if (!/127\.0\.0\.1|localhost/.test(SB_URL)) throw new Error("Test admin chỉ chạy với Supabase local");
    const out = execSync("supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const m = /^(?:SECRET_KEY|SERVICE_ROLE_KEY)="?([^"\n]+)"?$/m.exec(out);
    if (!m) throw new Error("Không đọc được secret key từ `supabase status`");
    adminKey = m[1];
  }
  return adminKey;
}

export function adminClient() {
  return createClient(SB_URL, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}

export const randomEmail = (tag = "u") =>
  `${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@test.local`;

/** Tài khoản thật (đã xác nhận email) + đã đăng nhập. */
export async function newAccount(displayName = "Người thật"): Promise<TestUser> {
  const email = randomEmail("acc");
  const password = `Pw${Math.random().toString(36).slice(2, 10)}9x`;
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const s = await sb.auth.signInWithPassword({ email, password });
  if (s.error) throw s.error;
  return { sb, id: data.user.id, email, password };
}

// ───────────── mã hoá (giống hệt app: lấy khoá qua API của server) ─────────────
export async function cryptoFor(u: TestUser, roomId: string) {
  return RoomCrypto.load(roomId, await tokenOf(u), APP_URL);
}

export async function encRow(c: RoomCrypto, row: { id: string; room_id: string; type: string; z: number; data: Record<string, unknown> }) {
  return { ...row, data: { enc: await c.encrypt(JSON.stringify(row.data), elAad(row.id, row.type)) } };
}

export async function encMessage(c: RoomCrypto, roomId: string, content: string, extra: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  return { id, room_id: roomId, author_name: "Test", author_color: "#3b5bdb", content: await c.encrypt(content, msgAad(id)), ...extra };
}

/** Chuỗi đúng ĐỊNH DẠNG mã hoá nhưng không phải của khoá nào (để test riêng RLS). */
export function fakeCipher(len = 32) {
  const body = new Uint8Array(len);
  for (let i = 0; i < len; i += 65536) crypto.getRandomValues(body.subarray(i, Math.min(len, i + 65536)));
  return `e1.AAAAAAAA.${toB64url(crypto.getRandomValues(new Uint8Array(12)))}.${toB64url(body)}`;
}

// ───────────── Mailpit (email local) ─────────────
export async function waitForEmailLink(to: string, timeout = 15_000): Promise<string> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const r = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const list = (await r.json()) as { messages?: { ID: string }[] };
    const id = list.messages?.[0]?.ID;
    if (id) {
      const m = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json()) as { HTML?: string; Text?: string };
      const body = (m.HTML ?? "") + (m.Text ?? "");
      const link = /href="([^"]+\/auth\/v1\/verify[^"]+)"/.exec(body)?.[1] ?? /(https?:\/\/\S+\/auth\/v1\/verify\S+)/.exec(body)?.[1];
      if (link) return link.replace(/&amp;/g, "&");
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`Không thấy email gửi tới ${to}`);
}

/** Một người dùng ẩn danh mới, độc lập (giống 1 trình duyệt khác). */
export async function newUser(): Promise<TestUser> {
  const sb = createClient(SB_URL, SB_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error("signIn failed");
  return { sb, id: data.user.id };
}

export function randomSlug() {
  const s = () => Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 4).padEnd(4, "x");
  return `t${s()}-${s()}-${s()}`;
}

/** Tạo phòng qua API, trả về {id, slug}. */
export async function createRoom(u: TestUser, name = "Phòng test") {
  const slug = randomSlug();
  const ins = await u.sb.from("rooms").insert({ slug, name });
  if (ins.error) throw ins.error;
  const { data, error } = await u.sb.rpc("join_room", { p_slug: slug });
  if (error) throw error;
  const room = (data as { id: string; slug: string; name: string; created_by: string }[])[0];
  return room;
}

export async function joinRoom(u: TestUser, slug: string) {
  const { data, error } = await u.sb.rpc("join_room", { p_slug: slug });
  if (error) throw error;
  return (data as { id: string }[])[0];
}

export function shapeRow(roomId: string, extra: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    room_id: roomId,
    type: "shape",
    z: 1,
    data: {
      x: 100,
      y: 100,
      w: 160,
      h: 100,
      shape: "rect",
      stroke: "#1e1e1e",
      fill: "none",
      strokeWidth: 2,
      dash: "solid",
      fontSize: 18,
      ...extra,
    },
  };
}

// ───────────── trình duyệt ─────────────

export async function openHome(browser: Browser, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await ctx.newPage();
  const errors = trackErrors(page);
  await page.goto("/");
  await page.fill("#h-name", name);
  return { ctx, page, errors };
}

export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Tạo phòng qua giao diện, trả về URL phòng. */
export async function createRoomUI(page: Page, roomName = "Phòng e2e") {
  await page.fill('input[placeholder="Tên phòng (không bắt buộc)"]', roomName);
  await page.click("text=Tạo phòng mới");
  await page.waitForURL(/\/r\/[a-z0-9-]+$/);
  await waitConnected(page);
  return page.url();
}

/** Mở phòng bằng 1 trình duyệt mới (người dùng khác). */
export async function joinRoomUI(browser: Browser, url: string, name: string, ctxOpts = {}) {
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...ctxOpts });
  const page = await ctx.newPage();
  const errors = trackErrors(page);
  await page.goto(url);
  await page.getByText("Chào bạn 👋").waitFor();
  await page.fill("#nd-name", name);
  await page.click("text=Vào phòng");
  await waitConnected(page);
  return { ctx, page, errors };
}

export async function waitConnected(page: Page) {
  await expect(page.locator('[data-tip="Đã kết nối"]')).toBeVisible({ timeout: 15_000 });
}

/** Số phần tử trên bảng (không tính vùng hit-test của SVG). */
export function elementCount(page: Page) {
  return page.locator("div[data-el]").count();
}

export async function drag(page: Page, pts: [number, number][]) {
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.up();
}

export async function centerOf(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`không thấy ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
