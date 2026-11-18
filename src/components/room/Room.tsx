"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Ban, Clock, Lock } from "lucide-react";
import { getSupabase, ensureSession, supabaseConfigured, accessToken } from "@/lib/supabase";
import { getIdentity, setIdentity, useIdentity } from "@/lib/identity";
import { useRoomRealtime, type Peer } from "@/lib/realtime";
import { BoardStore } from "@/lib/board/store";
import { CameraStore } from "@/lib/board/camera";
import { rememberRoom } from "@/lib/rooms";
import { RoomCrypto } from "@/lib/crypto";
import { isRegistered, useAuth } from "@/lib/auth";
import { Board } from "../board/Board";
import { ChatPanel } from "../chat/ChatPanel";
import { RoomHeader } from "./RoomHeader";
import { NameDialog } from "./NameDialog";
import { RoomSettings, type MemberRow } from "./RoomSettings";
import { Logo } from "../ui/Logo";

export interface RoomInfo {
  id: string;
  slug: string;
  name: string;
  visibility: "private" | "public";
  require_approval: boolean;
  is_owner: boolean;
}

type JoinRow = Omit<RoomInfo, "name" | "visibility" | "require_approval"> & {
  name: string | null;
  visibility: RoomInfo["visibility"] | null;
  require_approval: boolean | null;
  status: "active" | "pending" | "banned";
};

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "notfound" }
  | { status: "pending"; name: string }
  | { status: "banned" }
  | { status: "kicked"; name: string }
  | { status: "ready"; room: RoomInfo; userId: string; crypto: RoomCrypto };

async function joinRoom(slug: string): Promise<JoinRow | null> {
  const { data, error } = await getSupabase().rpc("join_room", { p_slug: slug, p_name: getIdentity().name });
  if (error) throw error;
  return ((Array.isArray(data) ? data[0] : data) as JoinRow | undefined) ?? null;
}

export function Room({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setTimeout> | null = null;

    const enter = async () => {
      if (!supabaseConfigured) {
        setState({ status: "error", message: "Chưa cấu hình Supabase (xem README.md)." });
        return;
      }
      try {
        const userId = await ensureSession();
        // join_room: vào phòng bằng mã. Phòng cần duyệt → trạng thái "pending".
        const row = await joinRoom(slug);
        if (cancelled) return;
        if (!row) return setState({ status: "notfound" });
        if (row.status === "banned") return setState({ status: "banned" });
        if (row.status === "pending") {
          setState({ status: "pending", name: row.name ?? slug });
          poll = setTimeout(enter, 4000); // chờ chủ phòng duyệt
          return;
        }
        // Khoá giải mã chỉ được cấp cho thành viên đã duyệt
        const crypto = await RoomCrypto.load(row.id, await accessToken());
        if (cancelled) return;
        setState({
          status: "ready",
          userId,
          crypto,
          room: {
            id: row.id,
            slug: row.slug,
            name: row.name ?? slug,
            visibility: row.visibility ?? "private",
            require_approval: !!row.require_approval,
            is_owner: row.is_owner,
          },
        });
      } catch (err) {
        if (cancelled) return;
        const e = err as { code?: string; message?: string };
        setState({
          status: "error",
          message: e.code === "PT429" ? (e.message ?? "Thao tác quá nhanh") : (e.message ?? "Có lỗi xảy ra"),
        });
      }
    };
    void enter();
    return () => {
      cancelled = true;
      if (poll) clearTimeout(poll);
    };
  }, [slug, attempt]);

  if (state.status === "ready") {
    return (
      <RoomReady
        key={state.room.id}
        room={state.room}
        userId={state.userId}
        crypto={state.crypto}
        onKicked={(name) => setState({ status: "kicked", name })}
      />
    );
  }
  if (state.status === "loading") return <RoomLoading />;
  if (state.status === "pending") return <PendingScreen roomName={state.name} />;

  const content = {
    notfound: {
      icon: null,
      title: "Không tìm thấy phòng",
      text: `Phòng “${slug}” không tồn tại hoặc đã bị xoá. Kiểm tra lại link nhé.`,
    },
    error: { icon: null, title: "Có lỗi xảy ra", text: state.status === "error" ? state.message : "" },
    banned: { icon: <Ban size={22} />, title: "Bạn không thể vào phòng này", text: "Chủ phòng đã chặn bạn khỏi phòng này." },
    kicked: {
      icon: <Lock size={22} />,
      title: "Bạn đã được mời ra khỏi phòng",
      text: state.status === "kicked" ? `Bạn không còn là thành viên của “${state.name}”.` : "",
    },
  }[state.status];

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-canvas p-6 text-center">
      <Logo size={44} />
      <div>
        <h1 className="flex items-center justify-center gap-2 text-xl font-semibold text-ink">
          {content.icon}
          {content.title}
        </h1>
        <p className="mt-1.5 max-w-sm text-sm text-ink-2">{content.text}</p>
      </div>
      <div className="flex gap-2">
        {(state.status === "kicked" || state.status === "error") && (
          <button
            type="button"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((a) => a + 1);
            }}
            className="rounded-xl border border-line px-5 py-2.5 text-sm font-medium text-ink hover:bg-hover"
          >
            Thử vào lại
          </button>
        )}
        <Link href="/" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-strong">
          Về trang chủ
        </Link>
      </div>
    </main>
  );
}

function PendingScreen({ roomName }: { roomName: string }) {
  const me = useIdentity();
  const { user } = useAuth();
  const [name, setName] = useState(me.name);
  return (
    <main className="board-grid flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div className="pop-in w-full max-w-[420px] rounded-2xl border border-line bg-panel p-6 text-center shadow-float">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Clock size={22} />
        </div>
        <h1 className="text-lg font-semibold text-ink">Đang chờ chủ phòng duyệt</h1>
        <p className="mt-1 text-sm text-ink-2">
          Bạn đã gửi yêu cầu vào <b className="text-ink">{roomName}</b>. Trang sẽ tự vào phòng khi được duyệt.
        </p>
        {!isRegistered(user) && (
          <form
            className="mt-5 text-left"
            onSubmit={(e) => {
              e.preventDefault();
              const n = name.trim().slice(0, 40);
              if (n) {
                setIdentity({ name: n, confirmed: true });
                toast.success("Đã cập nhật tên, chủ phòng sẽ thấy tên mới");
              }
            }}
          >
            <label htmlFor="pending-name" className="mb-1.5 block text-xs font-semibold tracking-wide text-ink-3 uppercase">
              Tên chủ phòng sẽ thấy
            </label>
            <div className="flex gap-2">
              <input
                id="pending-name"
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 text-sm outline-none focus:border-accent"
              />
              <button type="submit" className="h-10 rounded-xl border border-line px-3 text-sm font-medium hover:bg-hover">
                Lưu
              </button>
            </div>
          </form>
        )}
        <div className="mt-5 flex items-center justify-center gap-2 text-xs text-ink-3">
          <span className="spinner" /> Đang chờ…
        </div>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          Huỷ và về trang chủ
        </Link>
      </div>
    </main>
  );
}

export function RoomLoading() {
  return (
    <main className="board-grid flex min-h-dvh items-center justify-center bg-canvas">
      <div className="flex items-center gap-3 rounded-full bg-panel px-5 py-2.5 text-sm text-ink-2 shadow-float">
        <span className="spinner" /> Đang vào phòng…
      </div>
    </main>
  );
}

function RoomReady({
  room: initialRoom,
  userId,
  crypto,
  onKicked,
}: {
  room: RoomInfo;
  userId: string;
  crypto: RoomCrypto;
  onKicked: (roomName: string) => void;
}) {
  const me = useIdentity();
  const { user, ready: authReady } = useAuth();
  const [room, setRoom] = useState(initialRoom);
  const { bus, peers, status } = useRoomRealtime({ roomId: room.id, userId, name: me.name, color: me.color });
  const [store] = useState(
    () => new BoardStore(room.id, bus, crypto, (msg) => toast.error(msg, { id: "persist" })),
  );
  const [cam] = useState(() => new CameraStore());
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [pending, setPending] = useState<MemberRow[]>([]);
  const cursorPos = useRef(new Map<string, { x: number; y: number }>());
  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  });

  useEffect(() => {
    rememberRoom(room);
    document.title = `${room.name} · Bàn Tròn`;
  }, [room]);

  const reloadRoom = useCallback(async () => {
    const { data } = await getSupabase()
      .from("rooms")
      .select("name, visibility, require_approval")
      .eq("id", initialRoom.id)
      .maybeSingle();
    if (data) setRoom((r) => ({ ...r, ...(data as Partial<RoomInfo>) }));
  }, [initialRoom.id]);

  /** Có ai đó bị mời ra / được duyệt → kiểm tra lại quyền của mình và nạp khoá mới. */
  const recheckMembership = useCallback(async () => {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("is_room_member", { p_room: initialRoom.id });
    if (error) return;
    if (data === false) {
      store.dispose(); // không còn quyền ghi → dừng lưu
      onKicked(roomRef.current.name);
      return;
    }
    try {
      crypto.adopt(await RoomCrypto.load(initialRoom.id, await accessToken()));
    } catch {
      /* giữ khoá cũ */
    }
  }, [initialRoom.id, crypto, store, onKicked]);

  useEffect(() => {
    const offJoin = bus.on("peer-join", (p: Peer) =>
      toast(`${p.name} vừa vào phòng`, { icon: <Dot color={p.color} />, duration: 2500 }),
    );
    const offLeave = bus.on("peer-leave", (p?: Peer) => {
      if (p) toast(`${p.name} đã rời phòng`, { icon: <Dot color={p.color} />, duration: 2000 });
    });
    // Không tin nội dung broadcast (ai trong phòng cũng gửi được) → đọc lại từ DB
    const offRoom = bus.on("room", () => void reloadRoom());
    // ai trong phòng cũng gửi được "member" → giới hạn tần suất để không bị lợi dụng spam API
    let lastCheck = 0;
    let queued: ReturnType<typeof setTimeout> | null = null;
    const offMember = bus.on("member", () => {
      if (queued) return;
      const wait = Math.max(0, lastCheck + 3000 - Date.now());
      queued = setTimeout(() => {
        queued = null;
        lastCheck = Date.now();
        void recheckMembership();
      }, wait);
    });
    // kết nối lại sau khi mất mạng → có thể đã bị mời ra trong lúc offline
    const offConn = bus.on("connected", () => void recheckMembership());
    const offCursor = bus.on("cursor", (d: { x?: unknown; y?: unknown } | null, from: string) => {
      if (d && Number.isFinite(d.x) && Number.isFinite(d.y)) cursorPos.current.set(from, { x: d.x as number, y: d.y as number });
    });
    return () => {
      offJoin();
      offLeave();
      offRoom();
      offMember();
      if (queued) clearTimeout(queued);
      offConn();
      offCursor();
    };
  }, [bus, reloadRoom, recheckMembership]);

  // Chủ phòng: theo dõi yêu cầu vào phòng (hỏi DB định kỳ, không dùng realtime để tránh lộ dữ liệu)
  const seenPending = useRef<Set<string> | null>(null);
  const refreshPending = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("room_members")
      .select("user_id, status, display_name, joined_at, last_seen_at")
      .eq("room_id", initialRoom.id)
      .eq("status", "pending")
      .order("joined_at", { ascending: true });
    if (error || !data) return;
    const rows = data as MemberRow[];
    setPending(rows);
    const prev = seenPending.current;
    seenPending.current = new Set(rows.map((r) => r.user_id));
    if (prev) {
      for (const r of rows) {
        if (!prev.has(r.user_id)) {
          toast(`${r.display_name ?? "Ai đó"} muốn vào phòng`, {
            id: `knock-${r.user_id}`,
            duration: 8000,
            action: { label: "Xem", onClick: () => setSettingsOpen(true) },
          });
        }
      }
    }
  }, [initialRoom.id]);

  useEffect(() => {
    if (!room.is_owner) return;
    const first = setTimeout(() => void refreshPending(), 0);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refreshPending();
    }, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [room.is_owner, refreshPending]);

  useEffect(() => {
    const prev = document.title.replace(/^\(\d+\) /, "");
    document.title = unread ? `(${unread}) ${prev}` : prev;
  }, [unread]);

  const rename = useCallback(
    async (name: string) => {
      const n = name.trim().slice(0, 80);
      if (!n || n === room.name) return;
      const old = room.name;
      setRoom((r) => ({ ...r, name: n }));
      const { error } = await getSupabase().from("rooms").update({ name: n }).eq("id", room.id);
      if (error) {
        setRoom((r) => ({ ...r, name: old }));
        toast.error("Không đổi được tên phòng");
      } else {
        bus.send("room", null);
      }
    },
    [room, bus],
  );

  const goToPeer = useCallback(
    (id: string) => {
      const p = cursorPos.current.get(id);
      if (!p) {
        toast("Người này chưa di chuyển trên bảng");
        return;
      }
      const c = cam.get();
      const w = window.innerWidth;
      const h = window.innerHeight;
      cam.animateTo({ x: p.x - w / 2 / c.z, y: p.y - h / 2 / c.z, z: c.z }, 420);
    },
    [cam],
  );

  const onUnread = useCallback((n: number) => setUnread(n), []);

  return (
    <main className="fixed inset-0 overflow-hidden bg-canvas">
      <Board roomId={room.id} store={store} cam={cam} bus={bus} userId={userId} me={me} peers={peers} />
      <RoomHeader
        room={room}
        isOwner={room.is_owner}
        registered={isRegistered(user)}
        pendingCount={pending.length}
        onOpenSettings={() => setSettingsOpen(true)}
        onRename={rename}
        status={status}
        peers={peers}
        me={me}
        chatOpen={chatOpen}
        unread={unread}
        onToggleChat={() => setChatOpen((o) => !o)}
        onGoToPeer={goToPeer}
      />
      <ChatPanel
        roomId={room.id}
        crypto={crypto}
        bus={bus}
        userId={userId}
        me={me}
        peers={peers}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        onUnread={onUnread}
      />
      {settingsOpen && room.is_owner && (
        <RoomSettings
          room={room}
          userId={userId}
          registered={isRegistered(user)}
          pending={pending}
          onPendingChanged={refreshPending}
          onClose={() => setSettingsOpen(false)}
          onRoomChanged={(patch) => {
            setRoom((r) => ({ ...r, ...patch }));
            bus.send("room", null);
          }}
          onMembersChanged={() => {
            bus.send("member", null);
            void recheckMembership(); // nạp khoá mới nếu khoá vừa đổi
          }}
        />
      )}
      {authReady && !isRegistered(user) && !me.confirmed && <NameDialog />}
    </main>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />;
}
