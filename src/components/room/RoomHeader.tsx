"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Globe, Link2, LocateFixed, Lock, LogOut, MessageCircle, MessageSquareHeart, MoreHorizontal, Pencil, Settings, Star } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { forgetRoom } from "@/lib/rooms";
import { toast } from "sonner";
import type { ConnStatus, Peer } from "@/lib/realtime";
import { setIdentity, USER_COLORS } from "@/lib/identity";
import { Avatar, IconButton, Popover } from "../ui/primitives";
import { Logo } from "../ui/Logo";
import { cn } from "@/lib/utils";
import type { RoomInfo } from "./Room";

interface Props {
  room: RoomInfo;
  isOwner: boolean;
  registered: boolean;
  pendingCount: number;
  onOpenSettings: () => void;
  onRename: (name: string) => void;
  status: ConnStatus;
  peers: Peer[];
  me: { name: string; color: string };
  chatOpen: boolean;
  unread: number;
  onToggleChat: () => void;
  onGoToPeer: (id: string) => void;
}

export function RoomHeader(p: Props) {
  return (
    <>
      <div data-ui className="absolute top-3 left-3 z-30 flex max-w-[calc(100vw-232px)] items-center md:max-w-[calc(100vw-300px)] xl:max-w-[calc(50vw-310px)]">
        <div className="island flex min-w-0 items-center gap-1.5 py-1 pr-2 pl-1">
          <Link href="/" className="shrink-0 rounded-lg p-1 transition-opacity hover:opacity-80" aria-label="Trang chủ">
            <Logo size={28} />
          </Link>
          <RoomName name={p.room.name} editable={p.isOwner} onRename={p.onRename} />
          <span
            className="tip shrink-0 text-ink-3"
            data-tip={p.room.visibility === "public" ? "Phòng công khai" : "Phòng riêng tư · chỉ ai có link"}
            data-tip-side="bottom"
          >
            {p.room.visibility === "public" ? <Globe size={14} /> : <Lock size={14} />}
          </span>
          <StatusDot status={p.status} />
          {p.isOwner ? (
            <IconButton tip="Cài đặt phòng" size="sm" onClick={p.onOpenSettings}>
              <Settings size={16} />
              {p.pendingCount > 0 && (
                <span
                  data-testid="pending-badge"
                  className="pop-in absolute -top-1 -right-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-panel"
                >
                  {p.pendingCount}
                </span>
              )}
            </IconButton>
          ) : (
            <MemberMenu roomId={p.room.id} slug={p.room.slug} registered={p.registered} />
          )}
        </div>
      </div>

      <div data-ui className="absolute top-3 right-3 z-30 flex items-center gap-2">
        <div className="island flex items-center gap-1 p-1">
          <PeersStack peers={p.peers} me={p.me} onGoToPeer={p.onGoToPeer} />
          <ShareButton slug={p.room.slug} name={p.room.name} />
        </div>
        <div className="island p-1">
          <IconButton tip="Trò chuyện" tipSide="left" active={p.chatOpen} onClick={p.onToggleChat}>
            <MessageCircle size={18} />
            {p.unread > 0 && !p.chatOpen && (
              <span className="pop-in absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-panel">
                {p.unread > 99 ? "99+" : p.unread}
              </span>
            )}
          </IconButton>
        </div>
      </div>
    </>
  );
}

function RoomName({ name, editable, onRename }: { name: string; editable: boolean; onRename: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  if (editing) {
    return (
      <form
        className="min-w-0"
        onSubmit={(e) => {
          e.preventDefault();
          onRename(value);
          setEditing(false);
        }}
      >
        <input
          autoFocus
          value={value}
          maxLength={80}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            onRename(value);
            setEditing(false);
          }}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          className="h-8 w-48 rounded-lg border border-accent bg-canvas px-2 text-sm font-semibold text-ink outline-none"
        />
      </form>
    );
  }
  return (
    <button
      type="button"
      disabled={!editable}
      onClick={() => {
        setValue(name);
        setEditing(true);
      }}
      title={editable ? "Đổi tên phòng" : name}
      className="group flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left enabled:hover:bg-hover"
    >
      <span className="truncate text-[14px] font-semibold text-ink">{name}</span>
      {editable && <Pencil size={13} className="shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />}
    </button>
  );
}

function MemberMenu({ roomId, slug, registered }: { roomId: string; slug: string; registered: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState<boolean | null>(null);
  const loadSaved = async () => {
    if (!registered) return;
    const { data: s } = await getSupabase().auth.getSession();
    const { data } = await getSupabase()
      .from("room_members")
      .select("saved")
      .eq("room_id", roomId)
      .eq("user_id", s.session?.user.id ?? "")
      .maybeSingle();
    setSaved(!!data?.saved);
  };
  return (
    <Popover
      align="start"
      trigger={({ toggle }) => (
        <IconButton
          tip="Tuỳ chọn phòng"
          size="sm"
          onClick={() => {
            void loadSaved();
            toggle();
          }}
        >
          <MoreHorizontal size={16} />
        </IconButton>
      )}
    >
      {(close) => (
        <div className="w-[220px]">
          {registered ? (
            <button
              type="button"
              onClick={async () => {
                const next = !saved;
                const { error } = await getSupabase().rpc("set_room_saved", { p_room: roomId, p_saved: next });
                if (error) return toast.error("Không lưu được");
                setSaved(next);
                toast.success(next ? "Đã ghim phòng vào tài khoản" : "Đã bỏ ghim");
                close();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-ink hover:bg-hover"
            >
              <Star size={15} className={saved ? "fill-current text-warn" : ""} />
              {saved ? "Bỏ ghim phòng" : "Ghim phòng vào tài khoản"}
            </button>
          ) : (
            <Link href={`/login?next=${encodeURIComponent(`/r/${slug}`)}`} className="block rounded-lg px-2.5 py-2 text-sm text-ink hover:bg-hover">
              Đăng nhập để lưu phòng
            </Link>
          )}
          <button
            type="button"
            onClick={async () => {
              const { error } = await getSupabase().rpc("leave_room", { p_room: roomId });
              if (error) return toast.error(error.message);
              forgetRoom(slug);
              toast("Đã rời phòng");
              router.push("/");
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-danger hover:bg-danger-soft"
          >
            <LogOut size={15} /> Rời phòng
          </button>
          <Link
            href={`/feedback?from=${encodeURIComponent("/r/" + slug)}`}
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink-2 hover:bg-hover"
          >
            <MessageSquareHeart size={15} /> Góp ý & đánh giá
          </Link>
        </div>
      )}
    </Popover>
  );
}

function StatusDot({ status }: { status: ConnStatus }) {
  const label = status === "connected" ? "Đã kết nối" : status === "connecting" ? "Đang kết nối…" : "Mất kết nối, đang thử lại…";
  return (
    <span className="tip relative flex h-6 w-4 shrink-0 items-center justify-center" data-tip={label} data-tip-side="bottom">
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          status === "connected" ? "bg-success" : status === "connecting" ? "animate-pulse bg-warn" : "animate-pulse bg-danger",
        )}
      />
    </span>
  );
}

function PeersStack({ peers, me, onGoToPeer }: { peers: Peer[]; me: { name: string; color: string }; onGoToPeer: (id: string) => void }) {
  const shown = peers.slice(0, 3);
  const extra = peers.length - shown.length;
  return (
    <Popover
      align="end"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className="flex items-center rounded-lg py-0.5 pr-1 pl-0.5 hover:bg-hover"
          aria-label="Người trong phòng"
        >
          <span className="flex -space-x-2">
            <Avatar name={me.name} color={me.color} size={30} ring />
            {shown.map((p, i) => (
              <Avatar key={p.id} name={p.name} color={p.color} size={30} ring className={cn("pop-in", i > 0 && "max-sm:hidden")} />
            ))}
            {extra > 0 && (
              <span className="flex h-[30px] min-w-[30px] items-center justify-center rounded-full bg-hover px-1 text-xs font-semibold text-ink-2 ring-2 ring-panel max-sm:hidden">
                +{extra}
              </span>
            )}
            {peers.length > 1 && (
              <span className="flex h-[30px] min-w-[30px] items-center justify-center rounded-full bg-hover px-1 text-xs font-semibold text-ink-2 ring-2 ring-panel sm:hidden">
                +{peers.length - 1}
              </span>
            )}
          </span>
        </button>
      )}
    >
      {(close) => <PeerList peers={peers} me={me} onGoToPeer={(id) => (onGoToPeer(id), close())} />}
    </Popover>
  );
}

function PeerList({ peers, me, onGoToPeer }: { peers: Peer[]; me: { name: string; color: string }; onGoToPeer: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me.name);
  return (
    <div className="w-[272px]">
      <div className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
        Trong phòng · {peers.length + 1}
      </div>
      <div className="rounded-xl bg-canvas p-2">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = name.trim().slice(0, 40);
              if (n) setIdentity({ name: n, confirmed: true });
              setEditing(false);
            }}
          >
            <div className="flex gap-1.5">
              <input
                autoFocus
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 text-sm outline-none focus:border-accent"
              />
              <button type="submit" className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white" aria-label="Lưu">
                <Check size={16} />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {USER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setIdentity({ color: c })}
                  className={cn("h-5 w-5 rounded-full", me.color === c && "ring-2 ring-offset-1 ring-offset-canvas")}
                  style={{ background: c, ["--tw-ring-color" as string]: c }}
                />
              ))}
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-2.5">
            <Avatar name={me.name} color={me.color} size={30} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{me.name}</div>
              <div className="text-xs text-ink-3">Bạn</div>
            </div>
            <button
              type="button"
              onClick={() => {
                setName(me.name);
                setEditing(true);
              }}
              className="rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft"
            >
              Đổi tên
            </button>
          </div>
        )}
      </div>
      <div className="mt-1 max-h-64 overflow-y-auto">
        {peers.length === 0 && (
          <p className="px-2 py-3 text-center text-sm text-ink-3">Chưa có ai khác. Gửi link để mời bạn bè!</p>
        )}
        {peers.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onGoToPeer(p.id)}
            className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
          >
            <Avatar name={p.name} color={p.color} size={30} />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.name}</span>
            <span className="flex items-center gap-1 text-xs text-ink-3 opacity-0 transition-opacity group-hover:opacity-100">
              <LocateFixed size={13} /> Đi tới
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ShareButton({ slug, name }: { slug: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${window.location.origin}/r/${slug}`;
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.share) {
      try {
        await navigator.share({ title: name, text: `Vào phòng “${name}” trên Bàn Tròn`, url });
        return;
      } catch {
        /* người dùng huỷ → copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Đã sao chép link phòng", { description: url });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast(url);
    }
  };
  return (
    <button
      type="button"
      onClick={share}
      className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold text-white transition-colors hover:bg-accent-strong"
    >
      {copied ? <Check size={16} /> : <Link2 size={16} />}
      <span className="hidden sm:inline">{copied ? "Đã chép" : "Mời"}</span>
    </button>
  );
}
