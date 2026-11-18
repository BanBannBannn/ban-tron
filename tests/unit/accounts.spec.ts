/** Unit test cho logic tài khoản, hồ sơ, mã hoá (chạy thuần Node, không cần server). */
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { validateProfile, passwordProblem } from "../../src/lib/profile";
import { safeNext } from "../../src/lib/safe-next";
import { decryptField, encryptField, isStaleField, kidOf, masterKeys, roomKeys } from "../../src/lib/server/keys";
import { elAad, msgAad, RoomCrypto, fromB64url, toB64url } from "../../src/lib/crypto";

const K1 = randomBytes(32).toString("base64");
const K2 = randomBytes(32).toString("base64");
const env1 = { ENCRYPTION_KEY: K1 };
const envRotated = { ENCRYPTION_KEY: K2, ENCRYPTION_KEY_PREVIOUS: K1 };
const ROOM = "11111111-2222-4333-8444-555555555555";
const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

test.describe("safeNext (chống open redirect)", () => {
  for (const [input, out] of [
    ["/r/abc-defg-hij", "/r/abc-defg-hij"],
    ["/account?tab=1#x", "/account?tab=1#x"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["https://evil.com", "/"],
    ["javascript:alert(1)", "/"],
    ["/%0d%0aSet-Cookie:x", "/%0d%0aSet-Cookie:x"],
    ["/\r\nx", "/"],
    ["/\tevil", "/"],
    ["", "/"],
    [null, "/"],
  ] as const) {
    test(`${JSON.stringify(input)} → ${out}`, () => expect(safeNext(input)).toBe(out));
  }
});

test.describe("validateProfile", () => {
  test("hợp lệ: chuẩn hoá khoảng trắng, chuỗi rỗng → null (xoá)", () => {
    const r = validateProfile({ display_name: "  An  ", full_name: "", phone: "+84 912-345-678", birthday: "2000-02-29" });
    expect(r).toEqual({ ok: true, value: { display_name: "An", full_name: null, phone: "+84 912-345-678", birthday: "2000-02-29" } });
  });
  test("bỏ ký tự điều khiển / ký tự ẩn đảo chiều chữ (chống giả mạo tên)", () => {
    const r = validateProfile({ display_name: `A${String.fromCharCode(0x202e)}B${String.fromCharCode(0)}C${String.fromCharCode(0x200b)}` });
    expect(r.ok && r.value.display_name).toBe("ABC");
  });
  for (const bad of [
    null,
    [],
    "str",
    { id: "x" },
    { __proto__x: 1 },
    { display_name: 5 },
    { display_name: " " },
    { color: "red" },
    { phone: "12" },
    { phone: "abc12345" },
    { birthday: "2001-02-29" },
    { birthday: "1850-01-01" },
    { birthday: "20-01-2000" },
    { full_name: "x".repeat(101) },
    { full_name: ["x"] },
  ]) {
    test(`từ chối ${JSON.stringify(bad)}`, () => expect(validateProfile(bad).ok).toBe(false));
  }
  test("ngày sinh ở tương lai bị từ chối", () => {
    const d = new Date(Date.now() + 86400_000 * 2).toISOString().slice(0, 10);
    expect(validateProfile({ birthday: d }).ok).toBe(false);
  });
});

test("passwordProblem", () => {
  expect(passwordProblem("abc12")).not.toBeNull();
  expect(passwordProblem("abcdefgh")).not.toBeNull();
  expect(passwordProblem("12345678")).not.toBeNull();
  expect(passwordProblem("x".repeat(73) + "1")).not.toBeNull();
  expect(passwordProblem("matkhau123")).toBeNull();
});

test.describe("Mã hoá phía server (hồ sơ)", () => {
  test("mã hoá → giải mã đúng, mỗi lần ra bản mã khác nhau (IV ngẫu nhiên)", () => {
    const a = encryptField("0912 345 678", USER, "phone", env1);
    const b = encryptField("0912 345 678", USER, "phone", env1);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^s1\.[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/);
    expect(decryptField(a, USER, "phone", env1)).toBe("0912 345 678");
  });
  test("sai user / sai trường / sai khoá / bị sửa → không giải mã được", () => {
    const t = encryptField("bí mật", USER, "full_name", env1);
    expect(() => decryptField(t, ROOM, "full_name", env1)).toThrow();
    expect(() => decryptField(t, USER, "phone", env1)).toThrow();
    expect(() => decryptField(t, USER, "full_name", { ENCRYPTION_KEY: K2 })).toThrow();
    const parts = t.split(".");
    const ct = fromB64url(parts[3]);
    ct[0] ^= 1;
    expect(() => decryptField([...parts.slice(0, 3), toB64url(ct)].join("."), USER, "full_name", env1)).toThrow();
  });
  test("xoay vòng khoá: dữ liệu cũ vẫn đọc được và được đánh dấu cần mã hoá lại", () => {
    const old = encryptField("cũ", USER, "full_name", env1);
    expect(decryptField(old, USER, "full_name", envRotated)).toBe("cũ");
    expect(isStaleField(old, USER, envRotated)).toBe(true);
    expect(isStaleField(encryptField("mới", USER, "full_name", envRotated), USER, envRotated)).toBe(false);
  });
  test("khoá sai định dạng / thiếu → lỗi cấu hình rõ ràng", () => {
    expect(() => masterKeys({})).toThrow(/ENCRYPTION_KEY/);
    expect(() => masterKeys({ ENCRYPTION_KEY: "ngắn" })).toThrow(/32 byte/);
  });
});

test.describe("Khoá phòng + mã hoá trình duyệt", () => {
  test("khoá khác nhau theo phòng và theo thế hệ; khoá cũ vẫn có trong danh sách", () => {
    const a = roomKeys(ROOM, 0, env1);
    const b = roomKeys(USER, 0, env1);
    const a2 = roomKeys(ROOM, 2, env1);
    expect(a.current).not.toBe(b.current);
    expect(a2.current).not.toBe(a.current);
    expect(a2.keys.map((k) => k.kid)).toContain(a.current);
    expect(a2.keys).toHaveLength(3);
    // ổn định: cùng đầu vào → cùng khoá
    expect(roomKeys(ROOM, 0, env1).keys[0].k).toBe(a.keys[0].k);
    expect(kidOf(Buffer.from(a.keys[0].k, "base64url"))).toBe(a.current);
  });
  test("RoomCrypto: round-trip tiếng Việt + emoji, AAD sai → lỗi, token rác → lỗi", async () => {
    const c = await RoomCrypto.fromRaw(roomKeys(ROOM, 0, env1));
    const text = "Xin chào 👋 Tiếng Việt có dấu: ắ ặ ẫ ữ";
    const t = await c.encrypt(text, msgAad("m1"));
    expect(await c.decrypt(t, msgAad("m1"))).toBe(text);
    await expect(c.decrypt(t, msgAad("m2"))).rejects.toThrow();
    await expect(c.decrypt(t, elAad("m1", "shape"))).rejects.toThrow();
    for (const junk of [null, 42, "", "e1.", "e1.AAAAAAAA.x.y", t.replace("e1.", "e2.")]) {
      await expect(c.decrypt(junk, msgAad("m1"))).rejects.toThrow();
    }
  });
  test("sau khi đổi thế hệ: client mới đọc được dữ liệu cũ, client cũ không đọc được dữ liệu mới", async () => {
    const oldC = await RoomCrypto.fromRaw(roomKeys(ROOM, 0, env1));
    const newC = await RoomCrypto.fromRaw(roomKeys(ROOM, 1, env1));
    const oldMsg = await oldC.encrypt("cũ", "x");
    const newMsg = await newC.encrypt("mới", "x");
    expect(await newC.decrypt(oldMsg, "x")).toBe("cũ");
    await expect(oldC.decrypt(newMsg, "x")).rejects.toThrow();
  });
  test("xoay khoá chính: client nhận khoá cũ + mới, đọc được cả hai", async () => {
    const before = await RoomCrypto.fromRaw(roomKeys(ROOM, 0, env1));
    const after = await RoomCrypto.fromRaw(roomKeys(ROOM, 0, envRotated));
    const m = await before.encrypt("trước khi xoay", "x");
    expect(await after.decrypt(m, "x")).toBe("trước khi xoay");
    expect(after.currentKid).not.toBe(before.currentKid);
  });
  test("base64url khứ hồi với dữ liệu lớn", () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 256);
    expect(fromB64url(toB64url(big))).toEqual(big);
  });
});
