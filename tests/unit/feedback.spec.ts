/** Unit test: kiểm tra dữ liệu góp ý + dựng email (escape, chống chèn header). */
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { buildFeedbackEmail, cleanText, esc, validateFeedback } from "../../src/lib/feedback";
import { decryptScoped, encryptScoped } from "../../src/lib/server/keys";

const base = { category: "bug", message: "Bấm nút vẽ thì bị đơ trang", startedAt: 1 };
const meta = { registered: false, accountEmail: null, userAgent: "UA", sentAt: "1/1/2026", appUrl: "https://x.test" };

test.describe("validateFeedback", () => {
  test("đánh giá chỉ cần số sao; báo lỗi cần nội dung ≥ 10 ký tự", () => {
    expect(validateFeedback({ category: "rating", rating: 5 }).ok).toBe(true);
    expect(validateFeedback({ category: "rating" }).ok).toBe(false);
    expect(validateFeedback({ category: "bug", message: "lỗi" }).ok).toBe(false);
    expect(validateFeedback(base).ok).toBe(true);
  });
  for (const [name, patch] of [
    ["chủ đề lạ", { category: "admin" }],
    ["chủ đề __proto__", { category: "__proto__" }],
    ["chủ đề constructor", { category: "constructor" }],
    ["sao = 0", { rating: 0 }],
    ["sao = 6", { rating: 6 }],
    ["sao lẻ", { rating: 3.5 }],
    ["sao dạng chuỗi", { rating: "5" }],
    ["nội dung quá dài", { message: "x".repeat(6001) }],
    ["nội dung là object", { message: { a: 1 } }],
    ["email chèn header Bcc", { contact: "a@b.com\r\nBcc: victim@x.com" }],
    ["email có dấu ngoặc", { contact: "<a@b.com>" }],
    ["email sai", { contact: "khong-phai-email" }],
    ["trường lạ", { isAdmin: true }],
  ] as const) {
    test(`từ chối: ${name}`, () => expect(validateFeedback({ ...base, ...patch }).ok).toBe(false));
  }
  test("trang nguồn: chỉ nhận đường dẫn nội bộ", () => {
    for (const bad of ["javascript:alert(1)", "//evil.test", "https://evil.test", "/r/<script>"]) {
      const r = validateFeedback({ ...base, page: bad });
      expect(r.ok && r.value.page).toBeNull();
    }
    const ok = validateFeedback({ ...base, page: "/r/abc-defg-hij" });
    expect(ok.ok && ok.value.page).toBe("/r/abc-defg-hij");
  });
  test("bỏ ký tự điều khiển / đảo chiều, giữ xuống dòng trong nội dung", () => {
    const evil = `dòng 1${String.fromCharCode(0)}\ndòng 2${String.fromCharCode(0x202e)}xyz`;
    expect(cleanText(evil, 100, true)).toBe("dòng 1\ndòng 2xyz");
    expect(cleanText(evil, 100)).toBe("dòng 1dòng 2xyz");
  });
});

test.describe("Email góp ý", () => {
  test("nội dung độc hại bị escape, tiêu đề không chứa dữ liệu người dùng", () => {
    const v = validateFeedback({
      ...base,
      message: `<script>alert(1)</script><img src=x onerror=alert(2)> "quote" & 'x'`,
      contact: "ten.ho+tag@gmail.com",
      rating: 2,
    });
    expect(v.ok).toBe(true);
    const mail = buildFeedbackEmail((v as { value: Parameters<typeof buildFeedbackEmail>[0] }).value, meta);
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.subject).toBe("[Bàn Tròn] Báo lỗi · 2/5");
    expect(mail.replyTo).toBe("ten.ho+tag@gmail.com");
    expect(esc(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
  });
  test("không để lại email: tài khoản thì trả lời về email tài khoản, khách thì không có reply-to", () => {
    const v = validateFeedback({ category: "rating", rating: 5 });
    const f = (v as { value: Parameters<typeof buildFeedbackEmail>[0] }).value;
    expect(buildFeedbackEmail(f, meta).replyTo).toBeNull();
    expect(buildFeedbackEmail(f, { ...meta, registered: true, accountEmail: "me@x.com" }).replyTo).toBe("me@x.com");
  });
  test("mã hoá theo phạm vi: AAD sai / phạm vi sai → không giải mã được", () => {
    const env = { ENCRYPTION_KEY: randomBytes(32).toString("base64") };
    const t = encryptScoped("góp ý bí mật", "feedback", "feedback:1:message", env);
    expect(decryptScoped(t, "feedback", "feedback:1:message", env)).toBe("góp ý bí mật");
    expect(() => decryptScoped(t, "feedback", "feedback:2:message", env)).toThrow();
    expect(() => decryptScoped(t, "other", "feedback:1:message", env)).toThrow();
  });
});
