"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Globe, Lock, ShieldCheck, Trash2, UserMinus, UserX, X } from "lucide-react";
import { toast } from "sonner";
import { getSupabase } from "@/lib/supabase";
import { cn, timeAgo } from "@/lib/utils";
import { forgetRoom } from "@/lib/rooms";
import type { RoomInfo } from "./Room";

export interface MemberRow {
  user_id: string;
  status: "active" | "pending" | "banned";
  display_name: string | null;
  joined_at: string;
  last_seen_at: string;
}

type Action = "approve" | "deny" | "remove" | "ban" | "unban";

interface Props {
  room: RoomInfo;
  userId: string;
  registered: boolean;
  pending: MemberRow[];
  onPendingChanged: () => void;
  onClose: () => void;
  onRoomChanged: (patch: Partial<RoomInfo>) => void;
  onMembersChanged: () => void;
}

/** Hộp thoại cài đặt phòng — chỉ chủ phòng (DB cũng chặn mọi người khác). */
export function RoomSettings({ room, userId, registered, pending, onPendingChanged, onClose, onRoomChanged, onMembersChanged }: Props) {
  const router = useRouter();
  const [name, setName] = useState(room.name);
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadMembers = useCallback(async () => {
    const { data } = await getSupabase()
      .from("room_members")
      .select("user_id, status, display_name, joined_at, last_seen_at")
      .eq("room_id", room.id)
      .in("status", ["active", "banned"])
      .order("joined_at", { ascending: true });
    setMembers((data ?? []) as MemberRow[]);
  }, [room.id]);

  useEffect(() => {
    const t = setTimeout(() => void loadMembers(), 0);
    return () => clearTimeout(t);
  }, [loadMembers]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const update = async (patch: Partial<Pick<RoomInfo, "name" | "visibility" | "require_approval">>) => {
    setBusy("settings");
    const { error } = await getSupabase().from("rooms").update(patch).eq("id", room.id);
    setBusy(null);
    if (error) {
      toast.error(error.code === "42501" ? error.message : "Không lưu được cài đặt");
      return false;
    }
    onRoomChanged(patch);
    return true;
  };

  const moderate = async (userId: string, action: Action) => {
    setBusy(userId);
    const { error } = await getSupabase().rpc("moderate_member", { p_room: room.id, p_user: userId, p_action: action });
    setBusy(null);
    if (error) {
      toast.error(error.message || "Không thực hiện được");
      return;
    }
    onPendingChanged();
    void loadMembers();
    onMembersChanged();
  };

  const deleteRoom = async () => {
    setBusy("delete");
    const { error, count } = await getSupabase().from("rooms").delete({ count: "exact" }).eq("id", room.id);
    setBusy(null);
    if (error || !count) {
      toast.error("Không xoá được phòng");
      return;
    }
    forgetRoom(room.slug);
    onMembersChanged();
    toast.success("Đã xoá phòng");
    router.push("/");
  };

  const active = (members ?? []).filter((m) => m.status === "active");
  const banned = (members ?? []).filter((m) => m.status === "banned");

  return (
    <div
      data-ui
      data-modal-open
      className="fade-in fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/35 p-4 sm:items-center"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rs-title"
        className="pop-in w-full max-w-[480px] rounded-2xl border border-line bg-panel shadow-float"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="rs-title" className="text-[16px] font-semibold text-ink">
            Cài đặt phòng
          </h2>
          <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-1.5 text-ink-2 hover:bg-hover">
            <X size={18} />
          </button>
        </header>

        <div className="max-h-[calc(100dvh-140px)] space-y-6 overflow-y-auto px-5 py-5">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const n = name.trim().slice(0, 80);
              if (n && n !== room.name && (await update({ name: n }))) toast.success("Đã đổi tên phòng");
            }}
          >
            <Label htmlFor="rs-name">Tên phòng</Label>
            <div className="flex gap-2">
              <input
                id="rs-name"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 text-sm text-ink outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={!name.trim() || name.trim() === room.name}
                className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-40"
              >
                Lưu
              </button>
            </div>
          </form>

          <section>
            <Label>Ai thấy phòng này</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice
                active={room.visibility === "private"}
                icon={<Lock size={16} />}
                title="Riêng tư"
                desc="Chỉ ai có link mới vào được"
                onClick={() => room.visibility !== "private" && void update({ visibility: "private" })}
              />
              <Choice
                active={room.visibility === "public"}
                icon={<Globe size={16} />}
                title="Công khai"
                desc={registered ? "Hiện ở mục Phòng công khai trên trang chủ" : "Cần đăng nhập để bật"}
                disabled={!registered}
                onClick={() => room.visibility !== "public" && void update({ visibility: "public" })}
              />
            </div>
          </section>

          <section>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 hover:bg-hover">
              <input
                type="checkbox"
                checked={room.require_approval}
                disabled={busy === "settings"}
                onChange={(e) => void update({ require_approval: e.target.checked })}
                className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
              />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <ShieldCheck size={15} /> Duyệt người vào phòng
                </span>
                <span className="block text-xs text-ink-3">
                  Người mới mở link phải chờ bạn đồng ý. Người đã vào từ trước không bị ảnh hưởng.
                </span>
              </span>
            </label>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <Label className="mb-0">Đang chờ duyệt · {pending.length}</Label>
              {pending.length > 1 && (
                <button
                  type="button"
                  onClick={async () => {
                    for (const p of pending) await moderate(p.user_id, "approve");
                  }}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  Duyệt tất cả
                </button>
              )}
            </div>
            {pending.length === 0 ? (
              <Empty>Không có yêu cầu nào.</Empty>
            ) : (
              <ul className="space-y-1">
                {pending.map((p) => (
                  <li key={p.user_id} data-testid="pending-row" className="flex items-center gap-2 rounded-lg bg-canvas px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{p.display_name ?? "Khách"}</span>
                      <span className="text-xs text-ink-3">{timeAgo(p.joined_at)}</span>
                    </span>
                    <button
                      type="button"
                      disabled={busy === p.user_id}
                      onClick={() => moderate(p.user_id, "approve")}
                      className="flex h-8 items-center gap-1 rounded-lg bg-accent px-3 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      <Check size={14} /> Duyệt
                    </button>
                    <button
                      type="button"
                      disabled={busy === p.user_id}
                      onClick={() => moderate(p.user_id, "deny")}
                      className="h-8 rounded-lg border border-line px-3 text-xs font-medium text-ink-2 hover:bg-hover"
                    >
                      Từ chối
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <Label>Thành viên · {active.length}</Label>
            {members === null ? (
              <Empty>Đang tải…</Empty>
            ) : (
              <ul className="space-y-1">
                {active.map((m) => (
                  <MemberLine key={m.user_id} m={m} busy={busy === m.user_id} self={m.user_id === userId} onAction={moderate} />
                ))}
              </ul>
            )}
            {banned.length > 0 && (
              <>
                <Label className="mt-4">Đã chặn · {banned.length}</Label>
                <ul className="space-y-1">
                  {banned.map((m) => (
                    <li key={m.user_id} className="flex items-center gap-2 rounded-lg px-3 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{m.display_name ?? "Khách"}</span>
                      <button
                        type="button"
                        onClick={() => moderate(m.user_id, "unban")}
                        className="h-7 rounded-lg border border-line px-2.5 text-xs font-medium text-ink-2 hover:bg-hover"
                      >
                        Bỏ chặn
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="rounded-xl border border-danger/30 p-3">
            <div className="text-sm font-semibold text-danger">Xoá phòng</div>
            <p className="mt-0.5 text-xs text-ink-3">Xoá vĩnh viễn bảng vẽ, tin nhắn và danh sách thành viên.</p>
            <button
              type="button"
              disabled={busy === "delete"}
              onClick={() => (confirmDelete ? void deleteRoom() : setConfirmDelete(true))}
              className={cn(
                "mt-2 flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold",
                confirmDelete ? "bg-danger text-white" : "border border-danger/40 text-danger hover:bg-danger-soft",
              )}
            >
              <Trash2 size={15} /> {confirmDelete ? "Bấm lần nữa để xoá vĩnh viễn" : "Xoá phòng"}
            </button>
          </section>
          <p className="text-center text-xs text-ink-3">
            Gặp lỗi hay có ý tưởng?{" "}
            <a href={`/feedback?from=${encodeURIComponent("/r/" + room.slug)}`} className="font-medium text-accent hover:underline">
              Gửi góp ý
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

function MemberLine({
  m,
  busy,
  self,
  onAction,
}: {
  m: MemberRow;
  busy: boolean;
  self: boolean;
  onAction: (id: string, a: Action) => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-hover">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">
          {m.display_name ?? "Khách"} {self && <span className="text-xs text-ink-3">(bạn · chủ phòng)</span>}
        </span>
        <span className="text-xs text-ink-3">vào lần cuối {timeAgo(m.last_seen_at)}</span>
      </span>
      {!self && (
        <>
          <button
            type="button"
            disabled={busy}
            title="Mời ra (vẫn vào lại được bằng link nếu phòng không cần duyệt)"
            aria-label={`Mời ${m.display_name ?? "người này"} ra khỏi phòng`}
            onClick={() => onAction(m.user_id, "remove")}
            className="rounded-lg p-1.5 text-ink-3 hover:bg-panel hover:text-ink"
          >
            <UserMinus size={16} />
          </button>
          <button
            type="button"
            disabled={busy}
            title="Chặn (không vào lại được)"
            aria-label={`Chặn ${m.display_name ?? "người này"}`}
            onClick={() => onAction(m.user_id, "ban")}
            className="rounded-lg p-1.5 text-ink-3 hover:bg-danger-soft hover:text-danger"
          >
            <UserX size={16} />
          </button>
        </>
      )}
    </li>
  );
}

function Label({ children, htmlFor, className }: { children: React.ReactNode; htmlFor?: string; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("mb-2 block text-xs font-semibold tracking-wide text-ink-3 uppercase", className)}>
      {children}
    </label>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-canvas px-3 py-2.5 text-sm text-ink-3">{children}</p>;
}

function Choice({
  active,
  icon,
  title,
  desc,
  disabled,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  desc: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        active ? "border-accent bg-accent-soft" : "border-line hover:bg-hover",
      )}
    >
      <span className={cn("flex items-center gap-1.5 text-sm font-semibold", active ? "text-accent" : "text-ink")}>
        {icon} {title}
      </span>
      <span className="mt-0.5 block text-xs text-ink-3">{desc}</span>
    </button>
  );
}
