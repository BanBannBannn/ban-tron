/**
 * Kiểm thử bảo mật cho: tài khoản, hồ sơ mã hoá, mã hoá chat/bảng vẽ, duyệt người vào phòng,
 * phòng công khai/riêng tư, lưu phòng, chuyển dữ liệu khách → tài khoản, xoá tài khoản, rate limit.
 * Đóng vai kẻ tấn công gọi THẲNG API Supabase / API Next.js (bỏ qua giao diện).
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  adminClient,
  APP_URL,
  createRoom,
  cryptoFor,
  encMessage,
  encRow,
  fakeCipher,
  joinRoom,
  newAccount,
  newUser,
  randomSlug,
  SB_KEY,
  SB_URL,
  shapeRow,
  tokenOf,
  type TestUser,
} from "../helpers";
import { msgAad, RoomCrypto } from "../../src/lib/crypto";
import { roomChannelConfig, roomTopic } from "../../src/lib/channel";

const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
);

type JoinResult = { id: string; name: string | null; visibility: string | null; is_owner: boolean; status: string };
async function join(u: TestUser, slug: string, name?: string) {
  const { data, error } = await u.sb.rpc("join_room", { p_slug: slug, p_name: name ?? null });
  if (error) throw error;
  return (data as JoinResult[])[0];
}

async function setApproval(owner: TestUser, roomId: string, on: boolean) {
  const { error } = await owner.sb.from("rooms").update({ require_approval: on }).eq("id", roomId);
  expect(error).toBeNull();
}

async function keysStatus(token: string | null, roomId: string) {
  const res = await fetch(`${APP_URL}/api/rooms/${roomId}/keys`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown>, headers: res.headers };
}

function subscribe(ch: ReturnType<TestUser["sb"]["channel"]>) {
  return new Promise<string>((resolve) => {
    const t = setTimeout(() => resolve("TIMEOUT"), 6000);
    ch.subscribe((s) => {
      if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
        clearTimeout(t);
        resolve(s);
      }
    });
  });
}

// ═════════════════════════ mã hoá ═════════════════════════
test.describe("Mã hoá dữ liệu", () => {
  test("DB chỉ chứa bản mã: chat & phần tử bản rõ bị từ chối, bản mã không chứa nội dung gốc", async () => {
    const owner = await newUser();
    const room = await createRoom(owner);
    const c = await cryptoFor(owner, room.id);

    const plainMsg = await owner.sb
      .from("messages")
      .insert({ room_id: room.id, author_name: "A", author_color: "#3b5bdb", content: "mật khẩu wifi 123" });
    expect(plainMsg.error?.code, "DB nhận tin nhắn bản rõ").toBe("23514");

    const plainEl = await owner.sb.from("elements").insert(shapeRow(room.id, { text: "bí mật" }));
    expect(plainEl.error?.code, "DB nhận phần tử bản rõ").toBe("23514");

    // chèn thêm khoá lạ cạnh "enc" để lách ràng buộc
    const sneaky = await owner.sb
      .from("elements")
      .insert({ ...shapeRow(room.id), data: { enc: fakeCipher(), text: "bí mật" } });
    expect(sneaky.error?.code).toBe("23514");

    const msg = await encMessage(c, room.id, "mật khẩu wifi 123");
    expect((await owner.sb.from("messages").insert(msg)).error).toBeNull();
    const { data } = await adminClient().from("messages").select("content").eq("id", msg.id).single();
    expect(data!.content).toMatch(/^e1\./);
    expect(data!.content).not.toContain("wifi");
    expect(await c.decrypt(data!.content, msgAad(msg.id))).toBe("mật khẩu wifi 123");
  });

  test("API khoá phòng: không token 401, token rác 401, người lạ 403, id sai 400, thành viên 200 + no-store", async () => {
    const owner = await newUser();
    const outsider = await newUser();
    const room = await createRoom(owner);

    expect((await keysStatus(null, room.id)).status).toBe(401);
    expect((await keysStatus("abc.def.ghi-not-a-real-jwt-token", room.id)).status).toBe(401);
    expect((await keysStatus(await tokenOf(outsider), room.id)).status).toBe(403);
    expect((await keysStatus(await tokenOf(owner), "not-a-uuid")).status).toBe(400);
    expect((await keysStatus(await tokenOf(owner), "../../profile")).status).toBeGreaterThanOrEqual(400);

    const ok = await keysStatus(await tokenOf(owner), room.id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(Array.isArray(ok.body.keys)).toBe(true);
    // chỉ anon key (không đăng nhập) cũng không lấy được
    expect([401, 403]).toContain((await keysStatus(SB_KEY, room.id)).status);
  });

  test("khoá mỗi phòng khác nhau; bản mã không chép được sang tin nhắn / phòng khác (AAD)", async () => {
    const u = await newUser();
    const a = await createRoom(u, "A");
    const b = await createRoom(u, "B");
    const ca = await cryptoFor(u, a.id);
    const cb = await cryptoFor(u, b.id);
    expect(ca.currentKid).not.toBe(cb.currentKid);

    const msg = await encMessage(ca, a.id, "nội dung phòng A");
    await expect(cb.decrypt(msg.content, msgAad(msg.id)), "phòng B giải mã được dữ liệu phòng A").rejects.toThrow();
    await expect(ca.decrypt(msg.content, msgAad(crypto.randomUUID())), "chép bản mã sang id khác").rejects.toThrow();

    // sửa 1 ký tự bản mã → GCM phát hiện
    const tampered = msg.content.slice(0, -2) + (msg.content.endsWith("A") ? "BB" : "AA");
    await expect(ca.decrypt(tampered, msgAad(msg.id))).rejects.toThrow();
  });

  test("bị chặn → mất quyền lấy khoá, và khoá mới (đổi thế hệ) không giải mã được bằng khoá cũ", async () => {
    const owner = await newUser();
    const bad = await newUser();
    const room = await createRoom(owner);
    await joinRoom(bad, room.slug);
    const oldKeys = await cryptoFor(bad, room.id);

    const { data: ok } = await owner.sb.rpc("moderate_member", { p_room: room.id, p_user: bad.id, p_action: "ban" });
    expect(ok).toBe(true);
    expect((await keysStatus(await tokenOf(bad), room.id)).status).toBe(403);

    const fresh = await cryptoFor(owner, room.id);
    expect(fresh.currentKid).not.toBe(oldKeys.currentKid);
    const msg = await encMessage(fresh, room.id, "sau khi chặn");
    await expect(oldKeys.decrypt(msg.content, msgAad(msg.id))).rejects.toThrow();
    // nhưng chủ phòng vẫn đọc được dữ liệu cũ (giữ khoá các thế hệ trước)
    const old = await encMessage(oldKeys, room.id, "trước khi chặn");
    expect(await fresh.decrypt(old.content, msgAad(old.id))).toBe("trước khi chặn");
  });
});

// ═════════════════════════ duyệt người vào phòng ═════════════════════════
test.describe("Duyệt người vào phòng", () => {
  let owner: TestUser;
  let member: TestUser;
  let knocker: TestUser;
  let room: { id: string; slug: string };

  test.beforeAll(async () => {
    owner = await newUser();
    member = await newUser();
    knocker = await newUser();
    room = await createRoom(owner, "Phòng duyệt");
    await joinRoom(member, room.slug);
    await setApproval(owner, room.id, true);
    const c = await cryptoFor(owner, room.id);
    await owner.sb.from("elements").insert(await encRow(c, shapeRow(room.id)));
    await owner.sb.from("messages").insert(await encMessage(c, room.id, "chỉ thành viên"));
  });

  test("người mới vào → pending, chỉ thấy tên phòng, KHÔNG đọc/ghi/nghe được gì", async () => {
    const r = await join(knocker, room.slug, "Người gõ cửa");
    expect(r.status).toBe("pending");
    expect(r.visibility).toBeNull();
    expect(r.is_owner).toBe(false);

    for (const t of ["elements", "messages", "rooms"]) {
      const { data } = await knocker.sb.from(t).select("*").eq(t === "rooms" ? "id" : "room_id", room.id);
      expect(data ?? [], `pending đọc được ${t}`).toHaveLength(0);
    }
    const ins = await knocker.sb.from("elements").insert({ ...shapeRow(room.id), data: { enc: fakeCipher() } });
    expect(ins.error?.code).toBe("42501");
    const msg = await knocker.sb
      .from("messages")
      .insert({ room_id: room.id, author_name: "x", author_color: "#000000", content: fakeCipher() });
    expect(msg.error?.code).toBe("42501");
    const up = await knocker.sb.storage.from("board-images").upload(`${room.id}/${crypto.randomUUID()}.png`, PNG, { contentType: "image/png" });
    expect(up.error).not.toBeNull();
    expect((await keysStatus(await tokenOf(knocker), room.id)).status).toBe(403);

    // realtime: không nghe được broadcast của phòng
    const got: unknown[] = [];
    const spy = knocker.sb.channel(roomTopic(room.id), roomChannelConfig(knocker.id));
    spy.on("broadcast", { event: "el" }, (m) => got.push(m));
    await subscribe(spy);
    const pub = owner.sb.channel(roomTopic(room.id), roomChannelConfig(owner.id));
    expect(await subscribe(pub)).toBe("SUBSCRIBED");
    await pub.send({ type: "broadcast", event: "el", payload: { from: owner.id, data: { secret: 1 } } });
    await new Promise((res) => setTimeout(res, 1200));
    await knocker.sb.removeChannel(spy);
    await owner.sb.removeChannel(pub);
    expect(got, "người chờ duyệt nghe lén được").toHaveLength(0);
  });

  test("người chờ duyệt không tự duyệt mình, không sửa trực tiếp room_members", async () => {
    const self = await knocker.sb.rpc("moderate_member", { p_room: room.id, p_user: knocker.id, p_action: "approve" });
    expect(self.error).not.toBeNull();
    const upd = await knocker.sb.from("room_members").update({ status: "active" }).eq("room_id", room.id).eq("user_id", knocker.id);
    expect(upd.error).not.toBeNull();
    const ins = await knocker.sb.from("room_members").upsert({ room_id: room.id, user_id: knocker.id, status: "active" });
    expect(ins.error).not.toBeNull();
    expect((await join(knocker, room.slug)).status).toBe("pending");
  });

  test("IDOR: thành viên thường / người lạ không duyệt, không chặn, không mời ra được ai (kể cả chủ phòng)", async () => {
    const outsider = await newUser();
    for (const actor of [member, outsider]) {
      for (const [target, action] of [
        [knocker.id, "approve"],
        [owner.id, "ban"],
        [owner.id, "remove"],
        [member.id, "ban"],
      ] as const) {
        const r = await actor.sb.rpc("moderate_member", { p_room: room.id, p_user: target, p_action: action });
        expect(r.error?.code, `${action} bởi người không phải chủ phòng`).toBe("42501");
      }
    }
    expect((await join(knocker, room.slug)).status).toBe("pending");
    expect((await join(member, room.slug)).status).toBe("active");
  });

  test("thành viên thường không đọc được danh sách thành viên / người chờ của phòng", async () => {
    const { data } = await member.sb.from("room_members").select("user_id").eq("room_id", room.id);
    expect((data ?? []).map((r) => r.user_id)).toEqual([member.id]);
  });

  test("chủ phòng: hành động lạ bị từ chối, không tự chặn mình", async () => {
    const bad = await owner.sb.rpc("moderate_member", { p_room: room.id, p_user: knocker.id, p_action: "drop table" });
    expect(bad.error).not.toBeNull();
    const selfBan = await owner.sb.rpc("moderate_member", { p_room: room.id, p_user: owner.id, p_action: "ban" });
    expect(selfBan.error).not.toBeNull();
  });

  test("chủ phòng duyệt → vào được; chặn → không vào lại được, không tự 'rời phòng' để gỡ chặn", async () => {
    const { data: pend } = await owner.sb.from("room_members").select("user_id, display_name, status").eq("room_id", room.id).eq("status", "pending");
    expect(pend!.map((p) => p.display_name)).toContain("Người gõ cửa");

    expect((await owner.sb.rpc("moderate_member", { p_room: room.id, p_user: knocker.id, p_action: "approve" })).data).toBe(true);
    expect((await join(knocker, room.slug)).status).toBe("active");
    const els = await knocker.sb.from("elements").select("id").eq("room_id", room.id);
    expect(els.data!.length).toBeGreaterThan(0);

    expect((await owner.sb.rpc("moderate_member", { p_room: room.id, p_user: knocker.id, p_action: "ban" })).data).toBe(true);
    const again = await join(knocker, room.slug);
    expect(again.status).toBe("banned");
    expect(again.name, "lộ tên phòng cho người bị chặn").toBeNull();
    await knocker.sb.rpc("leave_room", { p_room: room.id });
    expect((await join(knocker, room.slug)).status).toBe("banned");
    const els2 = await knocker.sb.from("elements").select("id").eq("room_id", room.id);
    expect(els2.data ?? []).toHaveLength(0);
  });

  test("mời ra (remove): mất quyền ngay; phòng cần duyệt → vào lại phải chờ duyệt", async () => {
    const u = await newUser();
    await setApproval(owner, room.id, false);
    expect((await join(u, room.slug)).status).toBe("active");
    await setApproval(owner, room.id, true);
    expect((await owner.sb.rpc("moderate_member", { p_room: room.id, p_user: u.id, p_action: "remove" })).data).toBe(true);
    const { data: isMember } = await u.sb.rpc("is_room_member", { p_room: room.id });
    expect(isMember).toBe(false);
    expect((await join(u, room.slug)).status).toBe("pending");
  });

  test("tắt chế độ duyệt → người đang chờ được vào", async () => {
    const owner2 = await newUser();
    const r = await createRoom(owner2);
    await setApproval(owner2, r.id, true);
    const u = await newUser();
    expect((await join(u, r.slug)).status).toBe("pending");
    await setApproval(owner2, r.id, false);
    expect((await join(u, r.slug)).status).toBe("active");
  });
});

// ═════════════════════════ cài đặt phòng, công khai, lưu phòng ═════════════════════════
test.describe("Cài đặt phòng / công khai / lưu phòng", () => {
  test("thành viên không đổi được cài đặt phòng; khách (ẩn danh) không bật được công khai", async () => {
    const owner = await newUser();
    const member = await newUser();
    const room = await createRoom(owner);
    await joinRoom(member, room.slug);

    await member.sb.from("rooms").update({ require_approval: true, visibility: "private" }).eq("id", room.id);
    const { data: r1 } = await owner.sb.from("rooms").select("require_approval").eq("id", room.id).single();
    expect(r1!.require_approval).toBe(false);

    const pub = await owner.sb.from("rooms").update({ visibility: "public" }).eq("id", room.id);
    expect(pub.error?.code).toBe("42501");
    const ins = await owner.sb.from("rooms").insert({ slug: randomSlug(), name: "x", visibility: "public" });
    expect(ins.error?.code).toBe("42501");

    const epoch = await owner.sb.from("rooms").update({ key_epoch: 0 }).eq("id", room.id);
    expect(epoch.error, "chủ phòng tự đặt lại thế hệ khoá").not.toBeNull();
  });

  test("phòng công khai: chỉ phòng public xuất hiện, không lộ id / chủ phòng; ký tự %, _ không làm lộ hết", async () => {
    const acc = await newAccount("Chủ công khai");
    const tag = `pub${Date.now().toString(36)}`;
    const pubSlug = randomSlug();
    expect((await acc.sb.from("rooms").insert({ slug: pubSlug, name: `Lớp ${tag}`, visibility: "public" })).error).toBeNull();
    const privSlug = randomSlug();
    await acc.sb.from("rooms").insert({ slug: privSlug, name: `Riêng ${tag}` });

    const viewer = await newUser();
    const { data } = await viewer.sb.rpc("list_public_rooms", { p_search: tag });
    const rows = data as Record<string, unknown>[];
    expect(rows.map((r) => r.slug)).toEqual([pubSlug]);
    expect(Object.keys(rows[0]).sort()).toEqual(["created_at", "member_count", "name", "require_approval", "slug"]);

    const wild = await viewer.sb.rpc("list_public_rooms", { p_search: "%" });
    expect(wild.error).toBeNull();
    expect((wild.data as unknown[]).length).toBe(0);
    const inj = await viewer.sb.rpc("list_public_rooms", { p_search: "' or 1=1 --" });
    expect(inj.error).toBeNull();
    expect((inj.data as unknown[]).length).toBe(0);

    const anon = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
    expect((await anon.rpc("list_public_rooms", {})).error).not.toBeNull();
  });

  test("list_my_rooms chỉ có phòng của mình; set_room_saved với phòng lạ không tạo membership", async () => {
    const a = await newAccount("A");
    const b = await newUser();
    const roomA = await createRoom(a, "Phòng A");
    const roomB = await createRoom(b, "Phòng B");

    const saved = await a.sb.rpc("set_room_saved", { p_room: roomB.id, p_saved: true });
    expect(saved.data).toBe(false);
    const { data } = await a.sb.rpc("list_my_rooms");
    const ids = (data as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(roomA.id);
    expect(ids).not.toContain(roomB.id);
    expect((await a.sb.from("elements").select("id").eq("room_id", roomB.id)).data ?? []).toHaveLength(0);

    expect((await a.sb.rpc("set_room_saved", { p_room: roomA.id, p_saved: true })).data).toBe(true);
    const mine = (await a.sb.rpc("list_my_rooms")).data as { id: string; saved: boolean }[];
    expect(mine.find((r) => r.id === roomA.id)!.saved).toBe(true);
  });

  test("chỉ chủ phòng xoá được phòng; xoá phòng xoá luôn nội dung", async () => {
    const owner = await newUser();
    const member = await newUser();
    const room = await createRoom(owner);
    await joinRoom(member, room.slug);
    const c = await cryptoFor(owner, room.id);
    await owner.sb.from("messages").insert(await encMessage(c, room.id, "x"));

    const del1 = await member.sb.from("rooms").delete({ count: "exact" }).eq("id", room.id);
    expect(del1.count ?? 0).toBe(0);
    const del2 = await owner.sb.from("rooms").delete({ count: "exact" }).eq("id", room.id);
    expect(del2.count).toBe(1);
    const { count } = await adminClient().from("messages").select("id", { count: "exact", head: true }).eq("room_id", room.id);
    expect(count).toBe(0);
  });

  test("chủ phòng không 'rời' phòng của mình được (tránh phòng mồ côi)", async () => {
    const owner = await newUser();
    const room = await createRoom(owner);
    const r = await owner.sb.rpc("leave_room", { p_room: room.id });
    expect(r.error).not.toBeNull();
  });
});

// ═════════════════════════ hồ sơ ═════════════════════════
async function profileApi(u: TestUser | null, method: "GET" | "PUT", body?: unknown, contentType = "application/json") {
  const res = await fetch(`${APP_URL}/api/profile`, {
    method,
    headers: {
      ...(u ? { Authorization: `Bearer ${await tokenOf(u)}` } : {}),
      ...(body !== undefined ? { "Content-Type": contentType } : {}),
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

test.describe("Hồ sơ cá nhân (mã hoá)", () => {
  test("lưu qua API → DB chỉ có bản mã, đọc lại đúng; người khác không đọc được", async () => {
    const a = await newAccount("An");
    const put = await profileApi(a, "PUT", {
      display_name: "An Nguyễn",
      color: "#2f9e44",
      full_name: "Nguyễn Văn An",
      phone: "+84 912 345 678",
      birthday: "1999-05-20",
    });
    expect(put.status).toBe(200);

    const raw = (await adminClient().from("profiles").select("*").eq("id", a.id).single()).data!;
    for (const col of ["full_name_enc", "phone_enc", "birthday_enc"]) {
      expect(raw[col]).toMatch(/^s1\./);
    }
    const dump = JSON.stringify(raw);
    for (const secret of ["Nguyễn Văn An", "912", "1999"]) expect(dump, `DB chứa bản rõ "${secret}"`).not.toContain(secret);

    const get = await profileApi(a, "GET");
    expect(get.body).toMatchObject({ full_name: "Nguyễn Văn An", phone: "+84 912 345 678", birthday: "1999-05-20", display_name: "An Nguyễn" });

    // IDOR: B đọc / sửa hồ sơ A qua PostgREST
    const b = await newAccount("Bình");
    const read = await b.sb.from("profiles").select("*").eq("id", a.id);
    expect(read.data ?? []).toHaveLength(0);
    await b.sb.from("profiles").update({ display_name: "bị hack" }).eq("id", a.id);
    const after = (await adminClient().from("profiles").select("display_name").eq("id", a.id).single()).data!;
    expect(after.display_name).toBe("An Nguyễn");
  });

  test("tráo bản mã của A sang hồ sơ B → B không đọc được dữ liệu của A (AAD gắn với user)", async () => {
    const a = await newAccount("A");
    const b = await newAccount("B");
    await profileApi(a, "PUT", { full_name: "Bí mật của A" });
    const enc = (await adminClient().from("profiles").select("full_name_enc").eq("id", a.id).single()).data!.full_name_enc;
    // B tự ghi bản mã của A vào hồ sơ mình (định dạng hợp lệ nên DB nhận)
    expect((await b.sb.from("profiles").update({ full_name_enc: enc }).eq("id", b.id)).error).toBeNull();
    const get = await profileApi(b, "GET");
    expect(get.status).toBe(200);
    expect(get.body.full_name).toBeNull();
  });

  test("cột bí mật không nhận bản rõ; khách ẩn danh không tạo được hồ sơ", async () => {
    const a = await newAccount("A");
    const r = await a.sb.from("profiles").update({ phone_enc: "0912345678" }).eq("id", a.id);
    expect(r.error?.code).toBe("23514");

    const guest = await newUser();
    const ins = await guest.sb.from("profiles").insert({ id: guest.id, display_name: "Khách" });
    expect(ins.error).not.toBeNull();
    expect((await profileApi(guest, "GET")).status).toBe(403);
    expect((await profileApi(null, "GET")).status).toBe(401);
  });

  test("API từ chối dữ liệu xấu: trường lạ (mass assignment), sai định dạng, quá lớn, sai Content-Type", async () => {
    const a = await newAccount("A");
    for (const body of [
      { id: crypto.randomUUID() },
      { email: "x@evil.test" },
      { full_name_enc: "s1.xxx" },
      { phone: "gọi tôi đi" },
      { phone: "<script>" },
      { birthday: "2999-01-01" },
      { birthday: "1999-02-30" },
      { display_name: "" },
      { display_name: "x".repeat(41) },
      { color: "url(https://evil.test)" },
      { full_name: { $ne: null } },
      ["mảng"],
    ]) {
      const r = await profileApi(a, "PUT", body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect((await profileApi(a, "PUT", "{not json")).status).toBe(400);
    expect((await profileApi(a, "PUT", JSON.stringify({ full_name: "x".repeat(9000) }))).status).toBe(413);
    expect((await profileApi(a, "PUT", "full_name=x", "application/x-www-form-urlencoded")).status).toBe(415);
  });

  test("tin nhắn của tài khoản: tên lấy từ hồ sơ (không mạo danh), có dấu xác thực; khách không tự gắn dấu được", async () => {
    const acc = await newAccount("Chính chủ");
    const room = await createRoom(acc);
    const c = await cryptoFor(acc, room.id);
    const m = await encMessage(c, room.id, "xin chào", { author_name: "Admin hệ thống", author_color: "#000000", author_verified: false });
    expect((await acc.sb.from("messages").insert(m)).error).toBeNull();
    const row = (await acc.sb.from("messages").select("author_name, author_verified").eq("id", m.id).single()).data!;
    expect(row).toEqual({ author_name: "Chính chủ", author_verified: true });

    const guest = await newUser();
    await joinRoom(guest, room.slug);
    const cg = await cryptoFor(guest, room.id);
    const g = await encMessage(cg, room.id, "giả", { author_name: "Chính chủ", author_verified: true });
    expect((await guest.sb.from("messages").insert(g)).error).toBeNull();
    const grow = (await guest.sb.from("messages").select("author_verified").eq("id", g.id).single()).data!;
    expect(grow.author_verified).toBe(false);
  });

  test("tên chờ duyệt của tài khoản lấy từ hồ sơ, không tự đặt tên giả được", async () => {
    const owner = await newUser();
    const room = await createRoom(owner);
    await setApproval(owner, room.id, true);
    const acc = await newAccount("Tên thật");
    await join(acc, room.slug, "Chủ phòng");
    const { data } = await owner.sb.from("room_members").select("display_name").eq("user_id", acc.id).single();
    expect(data!.display_name).toBe("Tên thật");
  });
});

// ═════════════════════════ khách → tài khoản ═════════════════════════
test.describe("Chuyển dữ liệu khách sang tài khoản", () => {
  test("mã nhận dữ liệu: chỉ dùng 1 lần, chỉ tài khoản dùng được, chuyển đúng phòng", async () => {
    const guest = await newUser();
    const room = await createRoom(guest, "Phòng của khách");
    const { data: token, error } = await guest.sb.rpc("create_guest_claim");
    expect(error).toBeNull();
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const other = await newUser();
    expect((await other.sb.rpc("claim_guest", { p_token: token })).error, "khách khác dùng mã").not.toBeNull();
    const acc = await newAccount("Chủ mới");
    expect((await acc.sb.rpc("create_guest_claim")).error, "tài khoản tạo mã").not.toBeNull();
    for (const bad of ["", "x", "0".repeat(64), `${token}'; --`]) {
      expect((await acc.sb.rpc("claim_guest", { p_token: bad })).error).not.toBeNull();
    }

    const { data: n, error: e2 } = await acc.sb.rpc("claim_guest", { p_token: token });
    expect(e2).toBeNull();
    expect(n).toBe(1);
    const mine = (await acc.sb.rpc("list_my_rooms")).data as { id: string; is_owner: boolean }[];
    expect(mine.find((r) => r.id === room.id)?.is_owner).toBe(true);

    const acc2 = await newAccount("Kẻ dùng lại");
    expect((await acc2.sb.rpc("claim_guest", { p_token: token })).error, "dùng lại mã").not.toBeNull();
    const { data: gone } = await adminClient().auth.admin.getUserById(guest.id);
    expect(gone.user, "user khách chưa bị xoá sau khi chuyển").toBeNull();
  });

  test("bị chặn khi là khách → chuyển sang tài khoản vẫn bị chặn", async () => {
    const owner = await newUser();
    const room = await createRoom(owner);
    const guest = await newUser();
    await joinRoom(guest, room.slug);
    await owner.sb.rpc("moderate_member", { p_room: room.id, p_user: guest.id, p_action: "ban" });
    const { data: token } = await guest.sb.rpc("create_guest_claim");
    const acc = await newAccount("Né chặn");
    await acc.sb.rpc("claim_guest", { p_token: token });
    expect((await join(acc, room.slug)).status).toBe("banned");
  });
});

// ═════════════════════════ xoá tài khoản ═════════════════════════
test("xoá tài khoản: khách không gọi được; tài khoản bị xoá sạch hồ sơ, phòng, tin nhắn", async () => {
  const guest = await newUser();
  expect((await guest.sb.rpc("delete_my_account")).error).not.toBeNull();

  const acc = await newAccount("Sắp xoá");
  const room = await createRoom(acc);
  const other = await newUser();
  const otherRoom = await createRoom(other);
  await joinRoom(acc, otherRoom.slug);
  const c = await cryptoFor(acc, otherRoom.id);
  await acc.sb.from("messages").insert(await encMessage(c, otherRoom.id, "tin của tôi"));
  await profileApi(acc, "PUT", { phone: "0912345678" });

  expect((await acc.sb.rpc("delete_my_account")).error).toBeNull();
  const admin = adminClient();
  expect((await admin.auth.admin.getUserById(acc.id)).data.user).toBeNull();
  expect((await admin.from("profiles").select("id").eq("id", acc.id)).data).toHaveLength(0);
  expect((await admin.from("rooms").select("id").eq("id", room.id)).data).toHaveLength(0);
  expect((await admin.from("messages").select("id").eq("user_id", acc.id)).data).toHaveLength(0);
  expect((await admin.from("rooms").select("id").eq("id", otherRoom.id)).data, "xoá nhầm phòng người khác").toHaveLength(1);
});

// ═════════════════════════ chống spam ═════════════════════════
test.describe("Rate limit (chống spam)", () => {
  test("spam tin nhắn → bị chặn với HTTP 429", async () => {
    const u = await newUser();
    const room = await createRoom(u);
    const c = await cryptoFor(u, room.id);
    const results = [];
    for (let i = 0; i < 16; i++) results.push(await u.sb.from("messages").insert(await encMessage(c, room.id, `spam ${i}`)));
    const limited = results.filter((r) => r.error?.code === "PT429");
    expect(limited.length).toBeGreaterThan(0);
    expect(results.filter((r) => !r.error).length).toBe(12);
    expect(limited[0].status).toBe(429);
  });

  test("dò mã phòng (join_room liên tục) → bị chặn", async () => {
    const u = await newUser();
    let blocked = false;
    for (let i = 0; i < 70 && !blocked; i++) {
      const r = await u.sb.rpc("join_room", { p_slug: randomSlug() });
      if (r.error?.code === "PT429") blocked = true;
    }
    expect(blocked).toBe(true);
  });

  test("tạo phòng hàng loạt → bị chặn", async () => {
    const u = await newUser();
    let blocked = false;
    for (let i = 0; i < 25 && !blocked; i++) {
      const r = await u.sb.from("rooms").insert({ slug: randomSlug(), name: `spam ${i}` });
      if (r.error?.code === "PT429") blocked = true;
    }
    expect(blocked).toBe(true);
  });

  test("bảng rate_limits nằm ngoài API (không đọc / reset được bộ đếm)", async () => {
    const u = await newUser();
    const r = await u.sb.schema("private" as "public").from("rate_limits").select("*");
    expect(r.error).not.toBeNull();
    const rpc = await u.sb.rpc("hit", { p_kind: "msg", p_max: 999999, p_window: "1 second" });
    expect(rpc.error).not.toBeNull();
  });
});

// ═════════════════════════ header bảo mật ═════════════════════════
test("trang có header bảo mật (CSP, chống clickjacking, nosniff)", async () => {
  const res = await fetch(`${APP_URL}/`);
  const csp = res.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toMatch(/connect-src 'self' https?:\/\/[^ ]+/);
  expect(res.headers.get("x-frame-options")).toBe("DENY");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("x-powered-by")).toBeNull();
});

test("RoomCrypto từ chối khoá giả từ server (khoá hiện hành không có trong danh sách)", async () => {
  await expect(RoomCrypto.fromRaw({ current: "AAAAAAAA", keys: [] })).rejects.toThrow();
});
