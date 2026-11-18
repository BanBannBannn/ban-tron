/**
 * Mã hoá nội dung phòng (chat + bảng vẽ) NGAY TRONG TRÌNH DUYỆT bằng AES-256-GCM (WebCrypto).
 *
 * - Khoá phòng do server cấp (API /api/rooms/:id/keys) cho thành viên đã được duyệt.
 *   Khoá chỉ nằm trong bộ nhớ trang (CryptoKey không xuất được), không lưu localStorage.
 * - DB / Supabase chỉ thấy chuỗi "e1.<kid>.<iv>.<ciphertext>".
 * - AAD gắn ciphertext với đúng id tin nhắn / phần tử → không chép được sang chỗ khác.
 *
 * File này không phụ thuộc DOM nên bộ test (Node) cũng dùng được.
 */

const TOKEN_RE = /^e1\.([A-Za-z0-9_-]{8})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22,})$/;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export class DecryptError extends Error {}

export interface RawRoomKeys {
  current: string;
  keys: { kid: string; k: string }[];
}

export class RoomCrypto {
  private constructor(
    private keys: Map<string, CryptoKey>,
    private current: string,
  ) {}

  static async fromRaw(raw: RawRoomKeys): Promise<RoomCrypto> {
    const map = new Map<string, CryptoKey>();
    for (const { kid, k } of raw.keys) {
      if (!/^[A-Za-z0-9_-]{8}$/.test(kid)) continue;
      const bytes = fromB64url(k);
      if (bytes.length !== 32) continue;
      map.set(kid, await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]));
    }
    if (!map.has(raw.current)) throw new Error("Khoá phòng không hợp lệ");
    return new RoomCrypto(map, raw.current);
  }

  /** Lấy khoá phòng từ server (cần access token của phiên đăng nhập). */
  static async load(roomId: string, accessToken: string, base = ""): Promise<RoomCrypto> {
    const res = await fetch(`${base}/api/rooms/${roomId}/keys`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as Partial<RawRoomKeys> & { error?: string };
    if (!res.ok || !body.keys || !body.current) {
      const err = new Error(body.error ?? `Không lấy được khoá phòng (${res.status})`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return RoomCrypto.fromRaw(body as RawRoomKeys);
  }

  /** Nạp lại bộ khoá (sau khi chủ phòng đổi khoá vì mời ai đó ra). */
  adopt(other: RoomCrypto) {
    this.keys = other.keys;
    this.current = other.current;
  }

  get currentKid() {
    return this.current;
  }

  async encrypt(plain: string, aad: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: enc.encode(aad) },
      this.keys.get(this.current)!,
      enc.encode(plain),
    );
    return `e1.${this.current}.${toB64url(iv)}.${toB64url(new Uint8Array(ct))}`;
  }

  async decrypt(token: unknown, aad: string): Promise<string> {
    const m = typeof token === "string" ? TOKEN_RE.exec(token) : null;
    if (!m) throw new DecryptError("không phải dữ liệu mã hoá");
    const key = this.keys.get(m[1]);
    if (!key) throw new DecryptError("không có khoá phù hợp");
    try {
      const pt = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromB64url(m[2]), additionalData: enc.encode(aad) },
        key,
        fromB64url(m[3]),
      );
      return dec.decode(pt);
    } catch {
      throw new DecryptError("giải mã thất bại (dữ liệu bị sửa hoặc sai khoá)");
    }
  }
}

export const msgAad = (id: string) => `msg:${id}`;
export const elAad = (id: string, type: string) => `el:${id}:${type}`;
