"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Thiếu NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Xem README.md.",
    );
  }
  client = createClient(url, key, {
    // PKCE: mã trao đổi 1 lần trên URL thay vì token → an toàn hơn cho OAuth / link email
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
    // keepalive: request nhỏ (lưu nét vẽ) vẫn hoàn tất kể cả khi người dùng đóng / tải lại trang
    global: {
      fetch: (input, init) => {
        const body = init?.body;
        const small = typeof body === "string" && body.length < 60_000;
        return fetch(input, small ? { ...init, keepalive: true } : init);
      },
    },
    realtime: { params: { eventsPerSecond: 40 } },
  });
  return client;
}

let anonInflight: Promise<string> | null = null;

/**
 * Đảm bảo có phiên đăng nhập. Đã đăng nhập (tài khoản hoặc khách) → dùng phiên đó;
 * chưa có → tạo phiên khách ẩn danh. Trả về user id.
 */
export async function ensureSession(): Promise<string> {
  const sb = getSupabase();
  const { data } = await sb.auth.getSession();
  if (data.session?.user) return data.session.user.id;
  anonInflight ??= (async () => {
    const res = await sb.auth.signInAnonymously();
    if (res.error || !res.data.user) {
      throw new Error(
        res.error?.message?.includes("Anonymous")
          ? "Chưa bật Anonymous sign-ins trong Supabase (Authentication → Sign In / Providers)."
          : (res.error?.message ?? "Không đăng nhập được"),
      );
    }
    return res.data.user.id;
  })().finally(() => {
    anonInflight = null;
  });
  return anonInflight;
}

/** Access token hiện tại (để gọi API của server Next.js). */
export async function accessToken(): Promise<string> {
  await ensureSession();
  const { data } = await getSupabase().auth.getSession();
  if (!data.session) throw new Error("Mất phiên đăng nhập");
  return data.session.access_token;
}
