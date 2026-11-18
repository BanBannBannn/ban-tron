"use client";

import { useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, supabaseConfigured } from "./supabase";
import { getIdentity, onIdentityChange, setIdentity } from "./identity";
import { safeStorage } from "./utils";
export { safeNext } from "./safe-next";

export interface AuthUser {
  id: string;
  email: string | null;
  isAnonymous: boolean;
  provider: string;
}

interface AuthState {
  ready: boolean;
  user: AuthUser | null;
}

let state: AuthState = { ready: false, user: null };
const listeners = new Set<() => void>();
let started = false;

function toUser(s: Session | null): AuthUser | null {
  const u = s?.user;
  if (!u) return null;
  return {
    id: u.id,
    email: u.email ?? null,
    isAnonymous: !!u.is_anonymous,
    provider: (u.app_metadata?.provider as string | undefined) ?? "email",
  };
}

function set(next: AuthState) {
  const same =
    next.ready === state.ready &&
    next.user?.id === state.user?.id &&
    next.user?.isAnonymous === state.user?.isAnonymous &&
    next.user?.email === state.user?.email;
  if (same) return;
  state = next;
  listeners.forEach((l) => l());
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (!supabaseConfigured) {
    set({ ready: true, user: null });
    return;
  }
  const sb = getSupabase();
  sb.auth.onAuthStateChange((event, session) => {
    const user = toUser(session);
    const prev = state.user;
    set({ ready: true, user });
    if (user && !user.isAnonymous && (prev?.id !== user.id || event === "USER_UPDATED")) {
      // supabase-js khuyên không gọi API trong callback → đẩy ra sau
      setTimeout(() => void pullProfile(user.id), 0);
    }
  });
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (cb) => {
      start();
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => SERVER,
  );
}
const SERVER: AuthState = { ready: false, user: null };

export const isRegistered = (u: AuthUser | null): u is AuthUser => !!u && !u.isAnonymous;

// ───────────── đồng bộ tên/màu với hồ sơ ─────────────
let lastSynced = "";

async function pullProfile(uid: string) {
  const { data } = await getSupabase().from("profiles").select("display_name, color").eq("id", uid).maybeSingle();
  if (!data || state.user?.id !== uid) return;
  lastSynced = `${data.display_name}|${data.color}`;
  setIdentity({ name: data.display_name as string, color: data.color as string, confirmed: true });
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
onIdentityChange(() => {
  const u = state.user;
  if (!isRegistered(u)) return;
  const me = getIdentity();
  const key = `${me.name}|${me.color}`;
  if (key === lastSynced) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const { error } = await getSupabase()
      .from("profiles")
      .update({ display_name: me.name.slice(0, 40), color: me.color })
      .eq("id", u.id);
    if (!error) lastSynced = key;
  }, 600);
});

// ───────────── chuyển dữ liệu khách → tài khoản ─────────────
const CLAIM_KEY = "bantron:claim";

/** Gọi TRƯỚC khi đăng nhập / đăng ký: nếu đang là khách thì tạo mã nhận dữ liệu. */
export async function prepareGuestClaim() {
  try {
    const sb = getSupabase();
    const { data } = await sb.auth.getSession();
    if (!data.session?.user?.is_anonymous) return;
    const { data: token, error } = await sb.rpc("create_guest_claim");
    if (error || typeof token !== "string") return;
    safeStorage()?.setItem(CLAIM_KEY, JSON.stringify({ token, exp: Date.now() + 25 * 60_000 }));
  } catch {
    /* không chặn đăng nhập */
  }
}

/** Gọi SAU khi đăng nhập: chuyển phòng / tin nhắn của phiên khách sang tài khoản. */
export async function finishGuestClaim(): Promise<number> {
  const ls = safeStorage();
  const raw = ls?.getItem(CLAIM_KEY);
  if (!raw) return 0;
  ls?.removeItem(CLAIM_KEY);
  try {
    const { token, exp } = JSON.parse(raw) as { token: string; exp: number };
    if (Date.now() > exp) return 0;
    const sb = getSupabase();
    const { data: s } = await sb.auth.getSession();
    if (!s.session || s.session.user.is_anonymous) return 0;
    const { data, error } = await sb.rpc("claim_guest", { p_token: token });
    return error ? 0 : Number(data) || 0;
  } catch {
    return 0;
  }
}


export async function signOut() {
  await getSupabase().auth.signOut();
  lastSynced = "";
}
