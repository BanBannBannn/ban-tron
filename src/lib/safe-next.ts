/**
 * Đường dẫn quay lại sau đăng nhập: chỉ chấp nhận đường dẫn NỘI BỘ (chống open redirect,
 * vd. ?next=//evil.com hoặc ?next=https://evil.com sẽ bị đổi thành "/").
 */
export function safeNext(v: string | null | undefined): string {
  if (!v || typeof v !== "string") return "/";
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\\]/.test(v)) return "/";
  try {
    const u = new URL(v, "http://x.invalid");
    if (u.origin !== "http://x.invalid") return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}
