"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Globe, Lock, Search, ShieldCheck, Star, Users } from "lucide-react";
import { toast } from "sonner";
import { ensureSession, getSupabase, supabaseConfigured } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { cn, timeAgo } from "@/lib/utils";

interface MyRoom {
  id: string;
  slug: string;
  name: string;
  visibility: "public" | "private";
  require_approval: boolean;
  is_owner: boolean;
  saved: boolean;
  last_seen_at: string;
  member_count: number;
  pending_count: number;
}

interface PublicRoom {
  slug: string;
  name: string;
  require_approval: boolean;
  member_count: number;
  created_at: string;
}

/** Phòng lưu theo tài khoản (đồng bộ trên mọi thiết bị). */
export function MyRooms() {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<MyRoom[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSupabase()
      .rpc("list_my_rooms")
      .then(({ data }) => !cancelled && setRooms((data ?? []) as MyRoom[]));
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const toggleSaved = async (r: MyRoom) => {
    const { error } = await getSupabase().rpc("set_room_saved", { p_room: r.id, p_saved: !r.saved });
    if (error) return toast.error("Không lưu được");
    setRooms((list) =>
      (list ?? [])
        .map((x) => (x.id === r.id ? { ...x, saved: !r.saved } : x))
        .sort((a, b) => Number(b.saved) - Number(a.saved) || +new Date(b.last_seen_at) - +new Date(a.last_seen_at)),
    );
  };

  return (
    <div className="mt-6 max-w-[480px]" data-testid="my-rooms">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">
        <Star size={13} /> Phòng của tôi
      </div>
      {rooms === null ? (
        <div className="h-14 animate-pulse rounded-xl bg-panel" />
      ) : rooms.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-3 text-sm text-ink-3">
          Chưa có phòng nào. Phòng bạn tạo hoặc tham gia sẽ được lưu ở đây, xem được trên mọi thiết bị.
        </p>
      ) : (
        <div className="flex max-h-[360px] flex-col gap-1.5 overflow-y-auto">
          {rooms.map((r) => (
            <div key={r.id} className="group flex items-center gap-1">
              <Link
                href={`/r/${r.slug}`}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:border-line hover:bg-panel"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-sm font-bold text-accent">
                  {r.name.trim()[0]?.toUpperCase() ?? "#"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-[14px] font-medium text-ink">
                    <span className="truncate">{r.name}</span>
                    {r.visibility === "public" ? <Globe size={12} className="shrink-0 text-ink-3" /> : <Lock size={12} className="shrink-0 text-ink-3" />}
                    {r.pending_count > 0 && (
                      <span className="shrink-0 rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">
                        {r.pending_count} chờ duyệt
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-ink-3">
                    {r.is_owner ? "Chủ phòng" : "Thành viên"} · {r.member_count} người · {timeAgo(r.last_seen_at)}
                  </span>
                </span>
                <ArrowRight size={16} className="text-ink-3 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <button
                type="button"
                aria-label={r.saved ? "Bỏ ghim" : "Ghim"}
                onClick={() => toggleSaved(r)}
                className={cn(
                  "rounded-lg p-1.5 transition-opacity hover:bg-hover",
                  r.saved ? "text-warn" : "text-ink-3 opacity-0 group-hover:opacity-100 max-md:opacity-100",
                )}
              >
                <Star size={15} className={r.saved ? "fill-current" : ""} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Danh sách phòng công khai (chủ phòng chọn hiện ở trang chủ). */
export function PublicRooms() {
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!supabaseConfigured) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        await ensureSession();
        const { data } = await getSupabase().rpc("list_public_rooms", { p_search: q.trim() || null });
        if (!cancelled) setRooms((data ?? []) as PublicRoom[]);
      } catch {
        if (!cancelled) setRooms([]);
      }
    }, q ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  if (rooms !== null && rooms.length === 0 && !q) return null;

  return (
    <section className="relative z-10 mx-auto max-w-6xl px-5 pb-12" data-testid="public-rooms">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
          <Globe size={18} /> Phòng công khai
        </h2>
        <label className="relative">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={60}
            placeholder="Tìm phòng…"
            aria-label="Tìm phòng công khai"
            className="h-9 w-56 rounded-xl border border-line bg-panel pr-3 pl-8 text-sm outline-none focus:border-accent"
          />
        </label>
      </div>
      {rooms === null ? (
        <div className="h-20 animate-pulse rounded-2xl bg-panel" />
      ) : rooms.length === 0 ? (
        <p className="text-sm text-ink-3">Không tìm thấy phòng nào.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((r) => (
            <Link
              key={r.slug}
              href={`/r/${r.slug}`}
              className="group rounded-2xl border border-line bg-panel/90 p-4 transition-colors hover:border-accent"
            >
              <div className="truncate font-semibold text-ink">{r.name}</div>
              <div className="mt-1.5 flex items-center gap-3 text-xs text-ink-3">
                <span className="flex items-center gap-1">
                  <Users size={13} /> {r.member_count}
                </span>
                {r.require_approval && (
                  <span className="flex items-center gap-1">
                    <ShieldCheck size={13} /> Cần duyệt
                  </span>
                )}
                <span>{timeAgo(r.created_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
