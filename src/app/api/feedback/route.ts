import { createHash } from "node:crypto";
import { encryptScoped, KeyConfigError, masterKeys } from "@/lib/server/keys";
import { clientFromRequest, json } from "@/lib/server/supabase";
import { buildFeedbackEmail, MIN_FILL_MS, validateFeedback } from "@/lib/feedback";

/**
 * Nhận góp ý / đánh giá.
 * 1. Lọc bot: bẫy honeypot + điền form quá nhanh → trả 200 giả, không lưu.
 * 2. Kiểm tra dữ liệu (danh sách cho phép), mã hoá nội dung + email liên hệ.
 * 3. Lưu DB qua RPC submit_feedback (rate limit theo người dùng, theo IP, trần toàn hệ thống).
 * 4. Gửi email qua Resend nếu đã cấu hình và còn quota trong ngày. Mail lỗi thì góp ý vẫn được lưu.
 */

const RESEND_URL = "https://api.resend.com/emails";

function clientIp(req: Request) {
  // Vercel tự ghi đè x-forwarded-for / x-real-ip bằng IP thật của người dùng
  return req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** IP được băm kèm bí mật server → DB không lưu IP thật, cũng không đoán ngược được. */
function ipKey(ip: string) {
  const h = createHash("sha256").update("feedback-ip:").update(masterKeys()[0].key).update(ip).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function POST(req: Request) {
  const c = clientFromRequest(req);
  if (!c) return json({ error: "Chưa có phiên đăng nhập" }, 401);
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    return json({ error: "Content-Type phải là application/json" }, 415);
  }
  const raw = await req.text();
  if (raw.length > 16_000) return json({ error: "Dữ liệu quá lớn" }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "JSON không hợp lệ" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Dữ liệu không hợp lệ" }, 400);

  // Bẫy bot: trả 200 để bot tưởng đã gửi thành công
  if (typeof body.website === "string" && body.website.trim() !== "") return json({ ok: true });
  const startedAt = body.startedAt;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return json({ error: "Thiếu dữ liệu biểu mẫu" }, 400);
  if (Date.now() - startedAt < MIN_FILL_MS) return json({ ok: true });

  const v = validateFeedback(body);
  if (!v.ok) return json({ error: v.error, field: v.field }, 400);
  const f = v.value;

  const { data: u, error: uerr } = await c.sb.auth.getUser(c.token);
  if (uerr || !u.user) return json({ error: "Phiên đăng nhập không hợp lệ" }, 401);
  const registered = !u.user.is_anonymous;

  const id = crypto.randomUUID();
  let quota = false;
  try {
    const { data, error } = await c.sb.rpc("submit_feedback", {
      p_id: id,
      p_rating: f.rating,
      p_category: f.category,
      p_message_enc: f.message ? encryptScoped(f.message, "feedback", `feedback:${id}:message`) : null,
      p_contact_enc: f.contact ? encryptScoped(f.contact, "feedback", `feedback:${id}:contact`) : null,
      p_page: f.page,
      p_ip_key: ipKey(clientIp(req)),
    });
    if (error) {
      if (error.code === "PT429") return json({ error: error.message }, error.hint === "feedback_cap" ? 503 : 429);
      console.error("[feedback] lưu lỗi", error.code, error.message);
      return json({ error: "Không gửi được góp ý, thử lại sau" }, 400);
    }
    quota = data === true;
  } catch (err) {
    if (err instanceof KeyConfigError) return json({ error: "Server chưa cấu hình khoá mã hoá" }, 500);
    throw err;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.FEEDBACK_TO_EMAIL;
  let emailed = false;
  if (apiKey && to && quota) {
    const mail = buildFeedbackEmail(f, {
      registered,
      accountEmail: u.user.email ?? null,
      userAgent: req.headers.get("user-agent") ?? "",
      sentAt: new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
      appUrl: new URL(req.url).origin,
    });
    try {
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.FEEDBACK_FROM_EMAIL || "Bàn Tròn <onboarding@resend.dev>",
          to: [to],
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(8000),
      });
      emailed = res.ok;
      if (!res.ok) console.error("[feedback] Resend lỗi", res.status, (await res.text()).slice(0, 300));
    } catch (err) {
      console.error("[feedback] không gọi được Resend", (err as Error).message);
    }
  }
  return json({ ok: true, emailed });
}
