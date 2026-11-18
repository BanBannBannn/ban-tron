/** Bảo mật & chống spam cho góp ý / đánh giá (gọi thẳng API như bot / kẻ tấn công). */
import { test, expect } from "@playwright/test";
import { adminClient, APP_URL, newAccount, newUser, tokenOf, type TestUser } from "../helpers";
import { decryptScoped } from "../../src/lib/server/keys";

const randIp = () => `198.51.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const fakeEnc = () =>
  `s1.AAAAAAAA.${Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64url")}.${Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString("base64url")}`;

// dọn góp ý do test tạo ra (không thì chạy nhiều lần/ngày sẽ chạm trần 500 góp ý/ngày)
const testUsers = new Set<string>();
test.afterAll(async () => {
  const ids = [...testUsers];
  for (let i = 0; i < ids.length; i += 100) {
    await adminClient().from("feedback").delete().in("user_id", ids.slice(i, i + 100));
  }
});

async function send(u: TestUser | null, body: unknown, opts: { ip?: string; contentType?: string; raw?: string } = {}) {
  if (u) testUsers.add(u.id);
  const res = await fetch(`${APP_URL}/api/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": opts.contentType ?? "application/json",
      "x-real-ip": opts.ip ?? randIp(),
      ...(u ? { Authorization: `Bearer ${await tokenOf(u)}` } : {}),
    },
    body: opts.raw ?? JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const good = (extra: Record<string, unknown> = {}) => ({
  category: "bug",
  rating: 4,
  message: `Lỗi thử nghiệm ${Math.random()}`,
  startedAt: Date.now() - 10_000,
  ...extra,
});

async function rowsOf(userId: string) {
  return (await adminClient().from("feedback").select("*").eq("user_id", userId)).data ?? [];
}

test("gửi hợp lệ → lưu DB dạng mã hoá (nội dung + email liên hệ), giải mã đúng bằng khoá server", async () => {
  const u = await newUser();
  const msg = `Bảng bị giật khi zoom ${Date.now()}`;
  const r = await send(u, good({ message: msg, contact: "ban.doc@gmail.com", page: "/r/abc-defg-hij" }));
  expect(r.status).toBe(200);
  expect(r.body.emailed).toBe(false); // test không cấu hình Resend
  const [row] = await rowsOf(u.id);
  expect(row.message_enc).toMatch(/^s1\./);
  expect(JSON.stringify(row)).not.toContain("giật");
  expect(JSON.stringify(row)).not.toContain("ban.doc");
  expect(decryptScoped(row.message_enc, "feedback", `feedback:${row.id}:message`)).toBe(msg);
  expect(decryptScoped(row.contact_enc, "feedback", `feedback:${row.id}:contact`)).toBe("ban.doc@gmail.com");
  expect(row.page).toBe("/r/abc-defg-hij");
});

test("chặn yêu cầu xấu: không token 401, sai Content-Type 415, quá lớn 413, JSON hỏng 400, thiếu startedAt 400", async () => {
  const u = await newUser();
  expect((await send(null, good())).status).toBe(401);
  expect((await send(u, good(), { contentType: "text/plain" })).status).toBe(415);
  expect((await send(u, null, { raw: JSON.stringify(good({ message: "x".repeat(20_000) })) })).status).toBe(413);
  expect((await send(u, null, { raw: "{oops" })).status).toBe(400);
  expect((await send(u, { category: "bug", message: "thiếu thời điểm mở form" })).status).toBe(400);
  expect((await send(u, good({ category: "admin" }))).status).toBe(400);
  expect((await send(u, good({ contact: "a@b.com\r\nBcc: x@y.com" }))).status).toBe(400);
  expect(await rowsOf(u.id)).toHaveLength(0);
});

test("bot: điền ô bẫy (honeypot) hoặc gửi quá nhanh → trả 200 giả nhưng KHÔNG lưu", async () => {
  const u = await newUser();
  expect((await send(u, good({ website: "http://spam.test" }))).status).toBe(200);
  expect((await send(u, good({ startedAt: Date.now() }))).status).toBe(200);
  expect(await rowsOf(u.id)).toHaveLength(0);
});

test("spam theo người dùng: quá 3 góp ý / 10 phút → 429 (đổi IP giả cũng không lách được)", async () => {
  const u = await newUser();
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await send(u, good(), { ip: randIp() })).status);
  expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
  expect(statuses.slice(3)).toEqual([429, 429]);
  expect(await rowsOf(u.id)).toHaveLength(3);
});

test("spam theo IP: nhiều tài khoản khách cùng 1 IP → bị chặn sau 10 góp ý / giờ", async () => {
  const ip = randIp();
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await send(await newUser(), good(), { ip })).status);
  expect(statuses.filter((s) => s === 200)).toHaveLength(10);
  expect(statuses.slice(10)).toEqual([429, 429]);
});

test("IDOR: không ai đọc / sửa / xoá / chèn thẳng bảng feedback; RPC không nhận bản rõ", async () => {
  const victim = await newAccount("Người góp ý");
  await send(victim, good({ contact: "bimat@x.com" }));
  const attacker = await newAccount("Tò mò");
  for (const u of [attacker, victim]) {
    const sel = await u.sb.from("feedback").select("*");
    expect(sel.data ?? []).toHaveLength(0);
  }
  const ins = await attacker.sb.from("feedback").insert({ id: crypto.randomUUID(), category: "bug", rating: 5 });
  expect(ins.error).not.toBeNull();
  const del = await attacker.sb.from("feedback").delete().eq("user_id", victim.id);
  expect(del.error).not.toBeNull();
  expect(await rowsOf(victim.id)).toHaveLength(1);

  const plain = await attacker.sb.rpc("submit_feedback", {
    p_id: crypto.randomUUID(),
    p_rating: 5,
    p_category: "bug",
    p_message_enc: "nội dung bản rõ",
    p_contact_enc: null,
    p_page: null,
  });
  expect(plain.error?.code).toBe("23514");
  const badPage = await attacker.sb.rpc("submit_feedback", {
    p_id: crypto.randomUUID(),
    p_rating: 5,
    p_category: "rating",
    p_message_enc: null,
    p_contact_enc: null,
    p_page: "javascript:alert(1)",
  });
  expect(badPage.error).not.toBeNull();
  // giả mạo user_id / registered không được (cột do DB gán)
  const { data: stats } = await attacker.sb.rpc("feedback_stats");
  expect(Object.keys((stats as object[])[0]).sort()).toEqual(["average", "total"]);
});

test("trần hệ thống: hết quota mail trong ngày → vẫn lưu nhưng không gửi mail; quá 500/ngày → 503", async () => {
  const admin = adminClient();
  const mk = (emailed: boolean) => ({
    id: crypto.randomUUID(),
    user_id: crypto.randomUUID(),
    category: "rating",
    rating: 3,
    emailed,
  });
  const filler = [...Array.from({ length: 90 }, () => mk(true)), ...Array.from({ length: 410 }, () => mk(false))];
  try {
    const u = await newUser();
    testUsers.add(u.id);
    // còn dưới 90 mail → RPC báo được phép gửi
    const first = await u.sb.rpc("submit_feedback", {
      p_id: crypto.randomUUID(), p_rating: 5, p_category: "rating", p_message_enc: null, p_contact_enc: fakeEnc(), p_page: null,
    });
    expect(first.data).toBe(true);
    await admin.from("feedback").insert(filler.slice(0, 90));
    const u2 = await newUser();
    testUsers.add(u2.id);
    const second = await u2.sb.rpc("submit_feedback", {
      p_id: crypto.randomUUID(), p_rating: 5, p_category: "rating", p_message_enc: null, p_contact_enc: null, p_page: null,
    });
    expect(second.error).toBeNull();
    expect(second.data, "vẫn gửi mail dù đã hết quota").toBe(false);

    await admin.from("feedback").insert(filler.slice(90));
    const r = await send(await newUser(), good());
    expect(r.status).toBe(503);
  } finally {
    for (let i = 0; i < filler.length; i += 100) {
      const { error } = await admin.from("feedback").delete().in("id", filler.slice(i, i + 100).map((f) => f.id));
      if (error) throw error;
    }
  }
});
