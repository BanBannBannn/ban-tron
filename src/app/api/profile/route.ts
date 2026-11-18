import { decryptField, encryptField, isStaleField, KeyConfigError } from "@/lib/server/keys";
import { clientFromRequest, json, pgStatus } from "@/lib/server/supabase";
import { validateProfile, PRIVATE_FIELDS, type PrivateField } from "@/lib/profile";

/**
 * Hồ sơ cá nhân. Thông tin nhạy cảm được mã hoá/giải mã TẠI SERVER bằng khoá
 * không nằm trong DB. DB chỉ thấy chuỗi "s1.<kid>.<iv>.<ciphertext>".
 * Mọi truy vấn chạy bằng JWT của người dùng → RLS chỉ cho đọc/sửa hồ sơ của chính mình.
 */

const COLS = "display_name, color, full_name_enc, phone_enc, birthday_enc";
const ENC_COL: Record<PrivateField, string> = {
  full_name: "full_name_enc",
  phone: "phone_enc",
  birthday: "birthday_enc",
};

async function authed(req: Request) {
  const c = clientFromRequest(req);
  if (!c) return { res: json({ error: "Chưa đăng nhập" }, 401) } as const;
  const { data, error } = await c.sb.auth.getUser(c.token);
  if (error || !data.user) return { res: json({ error: "Phiên đăng nhập không hợp lệ" }, 401) } as const;
  if (data.user.is_anonymous) return { res: json({ error: "Khách chưa có hồ sơ, hãy đăng ký tài khoản" }, 403) } as const;
  return { sb: c.sb, user: data.user } as const;
}

function handleKeyError(err: unknown) {
  if (err instanceof KeyConfigError) {
    console.error("[profile]", err.message);
    return json({ error: "Server chưa cấu hình khoá mã hoá" }, 500);
  }
  throw err;
}

export async function GET(req: Request) {
  const a = await authed(req);
  if ("res" in a) return a.res;
  const { sb, user } = a;
  const { data, error } = await sb.from("profiles").select(COLS).eq("id", user.id).maybeSingle();
  if (error) return json({ error: "Không đọc được hồ sơ" }, pgStatus(error));
  try {
    const row = (data ?? {}) as Record<string, string | null>;
    const out: Record<string, string | null> = {};
    let stale = false;
    for (const f of PRIVATE_FIELDS) {
      const enc = row[ENC_COL[f]];
      if (!enc) {
        out[f] = null;
        continue;
      }
      try {
        out[f] = decryptField(enc, user.id, f);
        if (isStaleField(enc, user.id)) stale = true;
      } catch {
        out[f] = null; // dữ liệu hỏng / bị tráo → coi như trống, không làm sập trang
      }
    }
    // Đang xoay vòng khoá: mã hoá lại bằng khoá mới trong lúc đọc
    if (stale) {
      const patch: Record<string, string | null> = {};
      for (const f of PRIVATE_FIELDS) patch[ENC_COL[f]] = out[f] ? encryptField(out[f]!, user.id, f) : null;
      await sb.from("profiles").update(patch).eq("id", user.id);
    }
    return json({
      email: user.email ?? null,
      provider: user.app_metadata?.provider ?? "email",
      display_name: row.display_name ?? null,
      color: row.color ?? null,
      ...out,
    });
  } catch (err) {
    return handleKeyError(err);
  }
}

export async function PUT(req: Request) {
  const a = await authed(req);
  if ("res" in a) return a.res;
  const { sb, user } = a;
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    return json({ error: "Content-Type phải là application/json" }, 415);
  }
  const raw = await req.text();
  if (raw.length > 8_000) return json({ error: "Dữ liệu quá lớn" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "JSON không hợp lệ" }, 400);
  }
  const v = validateProfile(body);
  if (!v.ok) return json({ error: v.error, field: v.field }, 400);

  try {
    const patch: Record<string, string | null> = {};
    if (v.value.display_name !== undefined) patch.display_name = v.value.display_name;
    if (v.value.color !== undefined) patch.color = v.value.color;
    for (const f of PRIVATE_FIELDS) {
      const val = v.value[f];
      if (val === undefined) continue;
      patch[ENC_COL[f]] = val === null ? null : encryptField(val, user.id, f);
    }
    if (!Object.keys(patch).length) return json({ ok: true });
    // upsert: tài khoản tạo trước khi có bảng profiles vẫn lưu được
    const { data: existing } = await sb.from("profiles").select("id").eq("id", user.id).maybeSingle();
    const { error } = existing
      ? await sb.from("profiles").update(patch).eq("id", user.id)
      : await sb.from("profiles").insert({ id: user.id, display_name: v.value.display_name ?? "Người dùng", ...patch });
    if (error) {
      const status = pgStatus(error);
      return json({ error: status === 429 ? error.message : "Không lưu được hồ sơ" }, status);
    }
    return json({ ok: true });
  } catch (err) {
    return handleKeyError(err);
  }
}
