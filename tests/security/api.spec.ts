/**
 * Kiểm thử bảo mật tầng API: đóng vai kẻ tấn công gọi thẳng Supabase bằng anon key
 * (key này công khai trong bundle JS nên ai cũng lấy được).
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  createRoom,
  cryptoFor,
  encMessage,
  encRow,
  fakeCipher,
  joinRoom,
  newUser,
  randomSlug,
  SB_KEY,
  SB_URL,
  shapeRow,
  type TestUser,
} from "../helpers";
import { elAad, type RoomCrypto } from "../../src/lib/crypto";
import { roomChannelConfig, roomTopic } from "../../src/lib/channel";

let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let room: { id: string; slug: string };
let otherRoom: { id: string; slug: string };
let victimEl: ReturnType<typeof shapeRow>;
let victimMsgId: string;
let ownerCrypto: RoomCrypto;

async function elementX(id: string) {
  const { data } = await owner.sb.from("elements").select("data, type").eq("id", id).single();
  const plain = await ownerCrypto.decrypt((data!.data as { enc: string }).enc, elAad(id, data!.type as string));
  return (JSON.parse(plain) as { x: number }).x;
}

test.beforeAll(async () => {
  owner = await newUser();
  member = await newUser();
  outsider = await newUser();
  room = await createRoom(owner, "Phòng nạn nhân");
  await joinRoom(member, room.slug);
  otherRoom = await createRoom(outsider, "Phòng của kẻ tấn công");

  ownerCrypto = await cryptoFor(owner, room.id);
  victimEl = shapeRow(room.id);
  const ins = await owner.sb.from("elements").insert(await encRow(ownerCrypto, victimEl));
  expect(ins.error).toBeNull();

  const msg = await encMessage(ownerCrypto, room.id, "bí mật");
  victimMsgId = msg.id;
  const m = await owner.sb.from("messages").insert(msg);
  expect(m.error).toBeNull();
});

test.describe("Đọc trộm (liệt kê dữ liệu)", () => {
  test("người lạ không liệt kê được phòng, phần tử, tin nhắn, thành viên", async () => {
    for (const table of ["rooms", "elements", "messages", "room_members"]) {
      const { data } = await outsider.sb.from(table).select("*").limit(1000);
      const rows = (data ?? []) as { room_id?: string; id?: string }[];
      const leaked = rows.filter((r) => r.room_id === room.id || r.id === room.id);
      expect(leaked, `rò rỉ dữ liệu bảng ${table}`).toHaveLength(0);
    }
  });

  test("IDOR: người lạ lọc theo room_id của nạn nhân vẫn không thấy gì", async () => {
    const els = await outsider.sb.from("elements").select("*").eq("room_id", room.id);
    expect(els.data ?? []).toHaveLength(0);
    const msgs = await outsider.sb.from("messages").select("*").eq("room_id", room.id);
    expect(msgs.data ?? []).toHaveLength(0);
    const byId = await outsider.sb.from("elements").select("*").eq("id", victimEl.id);
    expect(byId.data ?? []).toHaveLength(0);
  });

  test("không đăng nhập (chỉ có anon key) thì không đọc được gì và không gọi được join_room", async () => {
    const anon = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
    const els = await anon.from("elements").select("*");
    expect(els.data ?? []).toHaveLength(0);
    const r = await anon.rpc("join_room", { p_slug: room.slug });
    expect(r.error).not.toBeNull();
  });

  test("join_room với mã sai trả về rỗng (không lộ phòng khác)", async () => {
    const { data, error } = await outsider.sb.rpc("join_room", { p_slug: randomSlug() });
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});

test.describe("Ghi trái phép (IDOR / leo quyền)", () => {
  test("người lạ không chèn được phần tử vào phòng nạn nhân", async () => {
    // dữ liệu đúng định dạng mã hoá → lỗi phải đến từ RLS chứ không phải từ ràng buộc định dạng
    const r = await outsider.sb.from("elements").insert({ ...shapeRow(room.id), data: { enc: fakeCipher() } });
    expect(r.error).not.toBeNull();
    expect(r.error!.code).toBe("42501");
  });

  test("người lạ không sửa / xoá được phần tử theo id", async () => {
    const up = await outsider.sb
      .from("elements")
      .update({ data: { enc: fakeCipher() } })
      .eq("id", victimEl.id)
      .select();
    expect(up.data ?? []).toHaveLength(0);
    const del = await outsider.sb.from("elements").delete().eq("id", victimEl.id).select();
    expect(del.data ?? []).toHaveLength(0);
    expect(await elementX(victimEl.id)).toBe(100);
  });

  test("upsert chiếm id: người lạ upsert id của nạn nhân vào phòng mình → bị chặn", async () => {
    const hijack = { ...shapeRow(otherRoom.id, { x: 4242 }), id: victimEl.id, data: { enc: fakeCipher() } };
    const r = await outsider.sb.from("elements").upsert(hijack);
    expect(r.error).not.toBeNull();
    const check = await owner.sb.from("elements").select("room_id").eq("id", victimEl.id).single();
    expect(check.data!.room_id).toBe(room.id);
    expect(await elementX(victimEl.id)).toBe(100);
  });

  test("thành viên không chuyển được phần tử sang phòng khác (đổi room_id)", async () => {
    const el = shapeRow(room.id);
    const mc = await cryptoFor(member, room.id);
    expect((await member.sb.from("elements").insert(await encRow(mc, el))).error).toBeNull();
    await member.sb.from("elements").update({ room_id: otherRoom.id }).eq("id", el.id);
    const check = await member.sb.from("elements").select("room_id").eq("id", el.id).single();
    expect(check.data!.room_id).toBe(room.id);
  });

  test("người lạ không gửi được tin nhắn vào phòng nạn nhân", async () => {
    const r = await outsider.sb
      .from("messages")
      .insert({ room_id: room.id, author_name: "Hacker", author_color: "#000000", content: fakeCipher() });
    expect(r.error).not.toBeNull();
    expect(r.error!.code).toBe("42501");
  });

  test("không giả mạo được user_id / created_at của tin nhắn", async () => {
    const id = crypto.randomUUID();
    await member.sb.from("messages").insert({
      id,
      room_id: room.id,
      user_id: owner.id,
      created_at: "2000-01-01T00:00:00Z",
      author_name: "Bình",
      author_color: "#2f9e44",
      content: fakeCipher(),
    });
    const { data } = await member.sb.from("messages").select("user_id, created_at").eq("id", id).single();
    expect(data!.user_id).toBe(member.id);
    expect(new Date(data!.created_at).getFullYear()).toBeGreaterThan(2020);
  });

  test("không xoá được tin nhắn của người khác", async () => {
    const del = await member.sb.from("messages").delete().eq("id", victimMsgId).select();
    expect(del.data ?? []).toHaveLength(0);
    const check = await owner.sb.from("messages").select("id").eq("id", victimMsgId);
    expect(check.data).toHaveLength(1);
  });

  test("thành viên thường không đổi được tên phòng", async () => {
    await member.sb.from("rooms").update({ name: "Bị hack" }).eq("id", room.id);
    const { data } = await owner.sb.from("rooms").select("name").eq("id", room.id).single();
    expect(data!.name).toBe("Phòng nạn nhân");
  });

  test("chủ phòng chỉ được đổi tên, không đổi slug / created_by", async () => {
    const newSlug = randomSlug();
    await owner.sb.from("rooms").update({ slug: newSlug }).eq("id", room.id);
    await owner.sb.from("rooms").update({ created_by: member.id }).eq("id", room.id);
    const { data } = await owner.sb.from("rooms").select("slug, created_by").eq("id", room.id).single();
    expect(data!.slug).toBe(room.slug);
    expect(data!.created_by).toBe(owner.id);
  });

  test("không tự thêm mình vào room_members (phải qua join_room)", async () => {
    const r = await outsider.sb.from("room_members").insert({ room_id: room.id, user_id: outsider.id });
    expect(r.error).not.toBeNull();
    const els = await outsider.sb.from("elements").select("id").eq("room_id", room.id);
    expect(els.data ?? []).toHaveLength(0);
  });

  test("tạo phòng không giả mạo được created_by / key_epoch / id", async () => {
    for (const extra of [{ created_by: owner.id }, { key_epoch: 99 }, { id: room.id }]) {
      const slug = randomSlug();
      const ins = await outsider.sb.from("rooms").insert({ slug, name: "x", ...extra });
      // cột không được cấp quyền → bị từ chối hẳn; nếu lọt thì trigger phải ghi đè
      if (!ins.error) {
        const r = await joinRoom(outsider, slug);
        const { data } = await outsider.sb.from("rooms").select("created_by, key_epoch").eq("id", r.id).single();
        expect(data!.created_by).toBe(outsider.id);
        expect(data!.key_epoch).toBe(0);
      } else {
        expect(ins.error.code).toBe("42501");
      }
    }
  });

  test("dữ liệu phần tử quá lớn bị từ chối", async () => {
    const big = { ...shapeRow(room.id), data: { enc: fakeCipher(300_000) } };
    const r = await member.sb.from("elements").insert(big);
    expect(r.error).not.toBeNull();
  });
});

test.describe("Storage (ảnh)", () => {
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );

  test("người lạ không tải ảnh vào thư mục phòng nạn nhân", async () => {
    const r = await outsider.sb.storage.from("board-images").upload(`${room.id}/x.png`, png, { contentType: "image/png" });
    expect(r.error).not.toBeNull();
  });

  test("thành viên không ghi đè được ảnh đã có", async () => {
    const path = `${room.id}/${crypto.randomUUID()}.png`;
    const a = await owner.sb.storage.from("board-images").upload(path, png, { contentType: "image/png" });
    expect(a.error).toBeNull();
    const b = await member.sb.storage.from("board-images").upload(path, png, { contentType: "image/png", upsert: true });
    expect(b.error).not.toBeNull();
  });

  test("không tải được SVG / HTML (chống XSS qua file)", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    const r1 = await member.sb.storage.from("board-images").upload(`${room.id}/a.svg`, svg, { contentType: "image/svg+xml" });
    expect(r1.error).not.toBeNull();
    const r2 = await member.sb.storage.from("board-images").upload(`${room.id}/a.html`, svg, { contentType: "text/html" });
    expect(r2.error).not.toBeNull();
  });

  test("không liệt kê được file trong bucket", async () => {
    const { data } = await outsider.sb.storage.from("board-images").list(room.id);
    expect(data ?? []).toHaveLength(0);
  });

  test("không xoá được ảnh của người khác", async () => {
    const path = `${room.id}/${crypto.randomUUID()}.png`;
    await owner.sb.storage.from("board-images").upload(path, png, { contentType: "image/png" });
    const del = await member.sb.storage.from("board-images").remove([path]);
    expect(del.data ?? []).toHaveLength(0);
    const pub = owner.sb.storage.from("board-images").getPublicUrl(path).data.publicUrl;
    expect((await fetch(pub)).status).toBe(200);
  });
});

test.describe("Realtime", () => {
  /** Đăng ký kênh, trả về trạng thái cuối cùng (SUBSCRIBED / CHANNEL_ERROR / TIMEOUT). */
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

  for (const attackerPrivate of [false, true]) {
    test(`người lạ biết room id không nghe lén được kênh của phòng (kẻ tấn công dùng private=${attackerPrivate})`, async () => {
      const topic = roomTopic(room.id);
      const received: unknown[] = [];
      const spy = outsider.sb.channel(topic, { config: { private: attackerPrivate, broadcast: { self: false } } });
      spy.on("broadcast", { event: "el" }, (m) => received.push(m));
      await subscribe(spy);

      // người trong phòng dùng đúng cấu hình của app
      const pub = owner.sb.channel(topic, roomChannelConfig(owner.id));
      expect(await subscribe(pub)).toBe("SUBSCRIBED");
      await pub.send({ type: "broadcast", event: "el", payload: { from: owner.id, data: { secret: true } } });
      await new Promise((r) => setTimeout(r, 1500));

      await outsider.sb.removeChannel(spy);
      await owner.sb.removeChannel(pub);
      expect(received, "kẻ tấn công nhận được dữ liệu của phòng").toHaveLength(0);
    });
  }

  test("người lạ không bơm được dữ liệu giả vào kênh của phòng", async () => {
    const topic = roomTopic(room.id);
    const got: unknown[] = [];
    const victim = member.sb.channel(topic, roomChannelConfig(member.id));
    victim.on("broadcast", { event: "el" }, (m) => got.push(m));
    expect(await subscribe(victim)).toBe("SUBSCRIBED");

    for (const priv of [false, true]) {
      const atk = outsider.sb.channel(topic, { config: { private: priv } });
      await subscribe(atk);
      await atk.send({ type: "broadcast", event: "el", payload: { from: owner.id, data: { upsert: [] } } });
      await new Promise((r) => setTimeout(r, 800));
      await outsider.sb.removeChannel(atk);
    }
    await member.sb.removeChannel(victim);
    expect(got, "nạn nhân nhận dữ liệu giả từ người lạ").toHaveLength(0);
  });

  test("thành viên nhận được broadcast của nhau (cấu hình của app)", async () => {
    const topic = roomTopic(room.id);
    const got: unknown[] = [];
    const a = member.sb.channel(topic, roomChannelConfig(member.id));
    a.on("broadcast", { event: "el" }, (m) => got.push(m));
    expect(await subscribe(a)).toBe("SUBSCRIBED");
    const b = owner.sb.channel(topic, roomChannelConfig(owner.id));
    expect(await subscribe(b)).toBe("SUBSCRIBED");
    await b.send({ type: "broadcast", event: "el", payload: { from: owner.id, data: { ok: true } } });
    await expect.poll(() => got.length, { timeout: 5000 }).toBe(1);
    await member.sb.removeChannel(a);
    await owner.sb.removeChannel(b);
  });

  test("người lạ không nhận được tin nhắn chat qua Postgres Changes", async () => {
    const got: unknown[] = [];
    const ch = outsider.sb
      .channel(`spy-${Date.now()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => got.push(p));
    await subscribe(ch);
    await new Promise((r) => setTimeout(r, 800));
    await owner.sb.from("messages").insert(await encMessage(ownerCrypto, room.id, "tin riêng tư"));
    await new Promise((r) => setTimeout(r, 2000));
    await outsider.sb.removeChannel(ch);
    expect(got).toHaveLength(0);
  });
});
