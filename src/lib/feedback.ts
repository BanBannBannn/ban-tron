/**
 * Góp ý & đánh giá: kiểm tra dữ liệu + dựng nội dung email.
 * Hàm thuần (không gọi mạng) → dùng chung client/server và unit test được.
 */

export const FEEDBACK_CATEGORIES = {
  rating: "Đánh giá chung",
  bug: "Báo lỗi",
  idea: "Góp ý tính năng",
  other: "Khác",
} as const;
export type FeedbackCategory = keyof typeof FEEDBACK_CATEGORIES;

export interface FeedbackInput {
  rating: number | null;
  category: FeedbackCategory;
  message: string;
  contact: string | null;
  page: string | null;
}

export const MIN_FILL_MS = 2500;
const EMAIL_RE = /^[^\s@<>"',;:\\()[\]]+@[^\s@<>"',;:\\()[\]]+\.[A-Za-z]{2,}$/;

/** Bỏ ký tự điều khiển (giữ xuống dòng nếu cần) và ký tự ẩn đảo chiều chữ. */
export function cleanText(v: unknown, max: number, keepNewlines = false): string {
  let out = "";
  for (const ch of String(v ?? "")) {
    const c = ch.codePointAt(0) ?? 0;
    const control = c < 32 || c === 127 || (c >= 0x80 && c <= 0x9f);
    const bidi = (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
    if (bidi || (control && !(keepNewlines && c === 10))) continue;
    out += ch;
  }
  return out.trim().slice(0, max);
}

type Result = { ok: true; value: FeedbackInput } | { ok: false; error: string; field: string };

export function validateFeedback(body: unknown): Result {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Dữ liệu không hợp lệ", field: "" };
  const o = body as Record<string, unknown>;
  const allowed = new Set(["rating", "category", "message", "contact", "page", "website", "startedAt"]);
  for (const k of Object.keys(o)) if (!allowed.has(k)) return { ok: false, error: `Trường không được phép: ${k}`, field: k };

  let rating: number | null = null;
  if (o.rating !== undefined && o.rating !== null) {
    if (typeof o.rating !== "number" || !Number.isInteger(o.rating) || o.rating < 1 || o.rating > 5) {
      return { ok: false, error: "Số sao từ 1 đến 5", field: "rating" };
    }
    rating = o.rating;
  }
  if (typeof o.category !== "string" || !Object.hasOwn(FEEDBACK_CATEGORIES, o.category)) {
    return { ok: false, error: "Chủ đề không hợp lệ", field: "category" };
  }
  const category = o.category as FeedbackCategory;
  if (o.message !== undefined && typeof o.message !== "string") return { ok: false, error: "Nội dung không hợp lệ", field: "message" };
  if (typeof o.message === "string" && o.message.length > 6000) return { ok: false, error: "Nội dung tối đa 3000 ký tự", field: "message" };
  const message = cleanText(o.message, 3000, true);
  if (category === "rating") {
    if (rating === null) return { ok: false, error: "Hãy chọn số sao", field: "rating" };
  } else if (message.length < 10) {
    return { ok: false, error: "Hãy mô tả chi tiết hơn (ít nhất 10 ký tự)", field: "message" };
  }

  let contact: string | null = null;
  if (o.contact !== undefined && o.contact !== null && o.contact !== "") {
    if (typeof o.contact !== "string" || /[\r\n]/.test(o.contact)) return { ok: false, error: "Email không hợp lệ", field: "contact" };
    const c = cleanText(o.contact, 254);
    if (!EMAIL_RE.test(c)) return { ok: false, error: "Email không hợp lệ", field: "contact" };
    contact = c;
  }

  let page: string | null = null;
  if (typeof o.page === "string" && o.page) {
    const p = o.page.slice(0, 200);
    page = /^\/[A-Za-z0-9/_?=&%.-]*$/.test(p) && !p.startsWith("//") ? p : null;
  }
  return { ok: true, value: { rating, category, message, contact, page } };
}

/** Escape 5 ký tự đặc biệt của HTML. */
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildFeedbackEmail(
  f: FeedbackInput,
  meta: { registered: boolean; accountEmail: string | null; userAgent: string; sentAt: string; appUrl: string },
) {
  const cat = FEEDBACK_CATEGORIES[f.category];
  const stars = f.rating ? "★".repeat(f.rating) + "☆".repeat(5 - f.rating) : null;
  const replyTo = f.contact ?? (meta.registered ? meta.accountEmail : null);
  // Tiêu đề chỉ ghép từ giá trị trong danh sách cho phép → không chèn header được
  const subject = `[Bàn Tròn] ${cat}${f.rating ? ` · ${f.rating}/5` : ""}`;
  const rows: [string, string][] = [
    ["Chủ đề", esc(cat)],
    ...(stars ? ([["Đánh giá", `<span style="color:#f08c00;font-size:18px">${stars}</span>`]] as [string, string][]) : []),
    ["Người gửi", meta.registered ? "Tài khoản đã đăng nhập" : "Khách"],
    ["Liên hệ", replyTo ? esc(replyTo) : "(không để lại)"],
    ...(f.page ? ([["Trang", esc(f.page)]] as [string, string][]) : []),
    ["Thiết bị", esc(cleanText(meta.userAgent, 300))],
    ["Thời điểm", esc(meta.sentAt)],
  ];
  const html = `<!doctype html><html lang="vi"><body style="margin:0;padding:24px;background:#f6f6f3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e1e1e">
<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e9e9e4;border-radius:14px;overflow:hidden">
<div style="padding:16px 22px;background:#1e1e1e;color:#fff;font-weight:700">Bàn Tròn · ${esc(cat)}</div>
<table role="presentation" style="width:100%;border-collapse:collapse">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:9px 22px;color:#6b6b6b;font-size:13px;width:110px;vertical-align:top">${esc(k)}</td><td style="padding:9px 22px 9px 0;font-size:14px;word-break:break-word">${v}</td></tr>`,
    )
    .join("")}</table>
${f.message ? `<div style="margin:6px 22px 22px;padding:14px;background:#fafaf8;border-left:3px solid #3b5bdb;border-radius:6px;white-space:pre-wrap;font-size:14px;line-height:1.6">${esc(f.message)}</div>` : ""}
<div style="padding:12px 22px;background:#fafaf8;color:#9a9a9a;font-size:12px">Góp ý cũng được lưu (mã hoá) trong cơ sở dữ liệu. ${esc(meta.appUrl)}</div>
</div></body></html>`;
  const text = [
    `Bàn Tròn · ${cat}`,
    stars ? `Đánh giá: ${f.rating}/5` : "",
    `Người gửi: ${meta.registered ? "tài khoản" : "khách"}`,
    `Liên hệ: ${replyTo ?? "(không để lại)"}`,
    f.page ? `Trang: ${f.page}` : "",
    `Thời điểm: ${meta.sentAt}`,
    "",
    f.message,
  ]
    .filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""))
    .join("\n");
  return { subject, html, text, replyTo };
}
