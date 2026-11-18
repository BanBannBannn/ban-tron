/**
 * Quản lý khoá mã hoá phía SERVER (Node). KHÔNG import file này từ client component.
 *
 * - ENCRYPTION_KEY: khoá chính 32 byte (base64), chỉ nằm trong biến môi trường của server
 *   (Vercel / .env.local), không bao giờ nằm trong DB → lộ DB cũng không đọc được dữ liệu.
 * - ENCRYPTION_KEY_PREVIOUS (tuỳ chọn): khoá cũ khi xoay vòng khoá; chỉ dùng để giải mã.
 *
 * Từ khoá chính, dùng HKDF-SHA256 dẫn xuất ra khoá riêng cho từng mục đích:
 *   room:<roomId>:<epoch>  → khoá AES-256-GCM của phòng (chat + bảng vẽ, mã hoá ở trình duyệt)
 *   profile:<userId>       → khoá mã hoá thông tin cá nhân của từng người
 * Biết khoá của phòng này không suy ra được khoá phòng khác (tính chất của HKDF).
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

const SALT = "ban-tron/v1";

export interface MasterKey {
  key: Buffer;
  primary: boolean;
}

export class KeyConfigError extends Error {}

function parseKey(raw: string, name: string): Buffer {
  const buf = Buffer.from(raw.trim(), "base64");
  if (buf.length !== 32) {
    throw new KeyConfigError(`${name} phải là 32 byte ở dạng base64 (tạo bằng: openssl rand -base64 32)`);
  }
  return buf;
}

export function masterKeys(env: Record<string, string | undefined> = process.env): MasterKey[] {
  const cur = env.ENCRYPTION_KEY;
  if (!cur) throw new KeyConfigError("Server chưa cấu hình ENCRYPTION_KEY");
  const keys: MasterKey[] = [{ key: parseKey(cur, "ENCRYPTION_KEY"), primary: true }];
  if (env.ENCRYPTION_KEY_PREVIOUS) {
    keys.push({ key: parseKey(env.ENCRYPTION_KEY_PREVIOUS, "ENCRYPTION_KEY_PREVIOUS"), primary: false });
  }
  return keys;
}

export const b64url = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");

function derive(master: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, SALT, info, 32));
}

/** Mã định danh khoá (8 ký tự), để biết dùng khoá nào giải mã. Không lộ thông tin về khoá. */
export function kidOf(key: Buffer): string {
  return createHash("sha256").update("kid:").update(key).digest("base64url").slice(0, 8);
}

// ───────────── khoá phòng ─────────────

export interface RoomKey {
  kid: string;
  /** khoá AES-256 dạng base64url */
  k: string;
}

const MAX_EPOCHS = 500;

/** Khoá của mọi thế hệ 0..epoch (để đọc được dữ liệu cũ). Phần tử đầu là khoá hiện hành. */
export function roomKeys(roomId: string, epoch: number, env?: Record<string, string | undefined>) {
  const masters = masterKeys(env);
  const keys: RoomKey[] = [];
  const top = Math.max(0, Math.min(epoch, MAX_EPOCHS));
  for (const m of masters) {
    for (let e = top; e >= 0; e--) {
      const k = derive(m.key, `room:${roomId}:${e}`);
      keys.push({ kid: kidOf(k), k: b64url(k) });
    }
  }
  return { current: keys[0].kid, keys };
}

// ───────────── mã hoá trường dữ liệu cá nhân (server) ─────────────

const FIELD_RE = /^s1\.([A-Za-z0-9_-]{8})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22,})$/;

function profileKey(master: Buffer, userId: string) {
  return derive(master, `profile:${userId}`);
}

/** AES-256-GCM, IV ngẫu nhiên 96 bit, AAD gắn với user + tên trường (không tráo được giữa người/trường). */
export function encryptField(plain: string, userId: string, field: string, env?: Record<string, string | undefined>) {
  const master = masterKeys(env)[0];
  const key = profileKey(master.key, userId);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(`profile:${userId}:${field}`));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final(), c.getAuthTag()]);
  return `s1.${kidOf(key)}.${b64url(iv)}.${b64url(ct)}`;
}

export function decryptField(token: string, userId: string, field: string, env?: Record<string, string | undefined>) {
  const m = FIELD_RE.exec(token);
  if (!m) throw new Error("định dạng mã hoá không hợp lệ");
  const [, kid, ivS, ctS] = m;
  for (const master of masterKeys(env)) {
    const key = profileKey(master.key, userId);
    if (kidOf(key) !== kid) continue;
    const buf = Buffer.from(ctS, "base64url");
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ivS, "base64url"));
    d.setAAD(Buffer.from(`profile:${userId}:${field}`));
    d.setAuthTag(buf.subarray(buf.length - 16));
    return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString("utf8");
  }
  throw new Error("không tìm thấy khoá giải mã (đã xoá ENCRYPTION_KEY_PREVIOUS?)");
}

// ───────────── mã hoá theo phạm vi chung (vd. "feedback") ─────────────

/** Mã hoá với khoá dẫn xuất cho một phạm vi bất kỳ; AAD do bên gọi quyết định. */
export function encryptScoped(plain: string, scope: string, aad: string, env?: Record<string, string | undefined>) {
  const key = derive(masterKeys(env)[0].key, `scope:${scope}`);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final(), c.getAuthTag()]);
  return `s1.${kidOf(key)}.${b64url(iv)}.${b64url(ct)}`;
}

export function decryptScoped(token: string, scope: string, aad: string, env?: Record<string, string | undefined>) {
  const m = FIELD_RE.exec(token);
  if (!m) throw new Error("định dạng mã hoá không hợp lệ");
  for (const master of masterKeys(env)) {
    const key = derive(master.key, `scope:${scope}`);
    if (kidOf(key) !== m[1]) continue;
    const buf = Buffer.from(m[3], "base64url");
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(m[2], "base64url"));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(buf.subarray(buf.length - 16));
    return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString("utf8");
  }
  throw new Error("không tìm thấy khoá giải mã");
}

/** Trường có đang được mã hoá bằng khoá cũ không (cần mã hoá lại khi xoay khoá). */
export function isStaleField(token: string, userId: string, env?: Record<string, string | undefined>) {
  const m = FIELD_RE.exec(token);
  if (!m) return false;
  return kidOf(profileKey(masterKeys(env)[0].key, userId)) !== m[1];
}
