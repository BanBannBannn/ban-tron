import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID_RE.test(v);

/** Phản hồi JSON không bao giờ được cache (chứa khoá / dữ liệu cá nhân). */
export function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
  });
}

/**
 * Client Supabase chạy với JWT CỦA NGƯỜI DÙNG (không dùng service role):
 * mọi truy vấn vẫn đi qua RLS y như từ trình duyệt → server không thể vô tình
 * đọc/ghi dữ liệu người khác.
 */
export function clientFromRequest(req: Request): { sb: SupabaseClient; token: string } | null {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(auth);
  if (!m) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const sb = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${m[1]}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { sb, token: m[1] };
}

/** Đổi lỗi PostgREST thành mã HTTP phù hợp, không lộ chi tiết nội bộ. */
export function pgStatus(err: { code?: string; message?: string } | null): number {
  if (!err) return 200;
  if (err.code === "42501") return 403;
  if (err.code === "PT429") return 429;
  if (err.code === "PGRST301" || err.code === "PGRST302" || /jwt/i.test(err.message ?? "")) return 401;
  return 400;
}
