"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, BadgeCheck, Lock, MessageCircle, RotateCw, SendHorizontal, Smile, X } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import type { Peer, RoomBus } from "@/lib/realtime";
import { cn, formatTime, throttle, uid } from "@/lib/utils";
import { Avatar, Popover } from "../ui/primitives";
import { isUuid, safeName } from "@/lib/board/sanitize";
import { msgAad, type RoomCrypto } from "@/lib/crypto";

export interface ChatMessage {
  id: string;
  room_id: string;
  user_id: string;
  author_name: string;
  author_color: string;
  content: string;
  created_at: string;
  /** tài khoản đã đăng nhập (tên lấy từ hồ sơ, không giả mạo được) */
  author_verified?: boolean;
  /** không giải mã được (dữ liệu hỏng hoặc bị sửa) */
  undecryptable?: boolean;
  status?: "sending" | "failed";
  error?: string;
}

const PAGE = 50;
const EMOJIS = ["👍", "❤️", "😂", "🎉", "🔥", "😮", "🙏", "👀", "✅", "❌", "💡", "🚀", "😅", "🤔", "👏", "😍"];

interface Props {
  roomId: string;
  crypto: RoomCrypto;
  bus: RoomBus;
  userId: string;
  me: { name: string; color: string };
  peers: Peer[];
  open: boolean;
  onClose: () => void;
  onUnread: (n: number) => void;
}

export function ChatPanel({ roomId, crypto, bus, userId, me, peers, open, onClose, onUnread }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState<Map<string, { name: string; at: number }>>(() => new Map());
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const unread = useRef(0);
  const openRef = useRef(open);
  const atBottomRef = useRef(true);
  const preserveScroll = useRef<number | null>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setNewBelow(0);
  }, []);

  useEffect(() => {
    openRef.current = open;
    if (open) {
      unread.current = 0;
      onUnread(0);
      requestAnimationFrame(() => {
        scrollToBottom(false);
        if (window.matchMedia("(min-width: 768px)").matches) inputRef.current?.focus();
      });
    }
  }, [open, onUnread, scrollToBottom]);

  /** Tin nhắn từ DB / realtime luôn ở dạng mã hoá → giải mã trong trình duyệt. */
  const decryptAll = useCallback(
    (rows: ChatMessage[]) =>
      Promise.all(
        rows.map(async (m): Promise<ChatMessage> => {
          try {
            return { ...m, content: (await crypto.decrypt(m.content, msgAad(m.id))).slice(0, 4000) };
          } catch {
            return { ...m, content: "", undecryptable: true };
          }
        }),
      ),
    [crypto],
  );

  const merge = useCallback((incoming: ChatMessage[]) => {
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, { ...map.get(m.id), ...m, status: undefined, error: undefined });
      return Array.from(map.values()).sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    });
  }, []);

  // tải tin nhắn gần nhất (lần đầu & khi kết nối lại)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error } = await getSupabase()
        .from("messages")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: false })
        .limit(PAGE);
      if (cancelled) return;
      setLoading(false);
      if (error) return;
      setHasMore((data?.length ?? 0) >= PAGE);
      const plain = await decryptAll(((data ?? []) as ChatMessage[]).reverse());
      if (cancelled) return;
      merge(plain);
      requestAnimationFrame(() => scrollToBottom(false));
    };
    const off = bus.on("connected", load);
    if (bus.connected) void load();
    const offMsg = bus.on("message", async (raw: ChatMessage) => {
      if (!raw || typeof raw.id !== "string") return;
      const [m] = await decryptAll([raw]);
      if (cancelled) return;
      merge([m]);
      setTyping((t) => {
        if (!t.has(m.user_id)) return t;
        const n = new Map(t);
        n.delete(m.user_id);
        return n;
      });
      if (m.user_id !== userId) {
        if (!openRef.current) {
          unread.current++;
          onUnread(unread.current);
        } else if (!atBottomRef.current) {
          setNewBelow((n) => n + 1);
        }
      }
    });
    const offTyping = bus.on("typing", (d: { name?: unknown } | null, from: string) => {
      if (!isUuid(from)) return;
      setTyping((t) => new Map(t).set(from, { name: safeName(d?.name), at: Date.now() }));
    });
    return () => {
      cancelled = true;
      off();
      offMsg();
      offTyping();
    };
  }, [bus, roomId, userId, merge, decryptAll, onUnread, scrollToBottom]);

  // xoá "đang nhập" quá hạn
  useEffect(() => {
    if (!typing.size) return;
    const t = setInterval(() => {
      setTyping((m) => {
        const now = Date.now();
        const n = new Map(Array.from(m).filter(([, v]) => now - v.at < 3500));
        return n.size === m.size ? m : n;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [typing.size]);

  // tự cuộn khi có tin mới và đang ở cuối
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (preserveScroll.current !== null) {
      el.scrollTop = el.scrollHeight - preserveScroll.current;
      preserveScroll.current = null;
      return;
    }
    if (atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, typing.size]);

  const loadOlder = async () => {
    if (loadingMore || !messages.length) return;
    setLoadingMore(true);
    const oldest = messages.find((m) => !m.status)?.created_at ?? messages[0].created_at;
    const { data } = await getSupabase()
      .from("messages")
      .select("*")
      .eq("room_id", roomId)
      .lt("created_at", oldest)
      .order("created_at", { ascending: false })
      .limit(PAGE);
    setHasMore((data?.length ?? 0) >= PAGE);
    const plain = await decryptAll(((data ?? []) as ChatMessage[]).reverse());
    if (listRef.current) preserveScroll.current = listRef.current.scrollHeight - listRef.current.scrollTop;
    merge(plain);
    setLoadingMore(false);
  };

  const sendTyping = useMemo(() => throttle((name: string) => bus.send("typing", { name }), 2000), [bus]);

  const send = async (content: string, existingId?: string) => {
    const body = content.trim();
    if (!body) return;
    const id = existingId ?? uid();
    const optimistic: ChatMessage = {
      id,
      room_id: roomId,
      user_id: userId,
      author_name: me.name,
      author_color: me.color,
      content: body.slice(0, 4000),
      created_at: new Date().toISOString(),
      status: "sending",
    };
    setMessages((prev) => [...prev.filter((m) => m.id !== id), optimistic]);
    atBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom());
    let error: { code?: string; message?: string } | null = null;
    let data: ChatMessage | null = null;
    try {
      const content = await crypto.encrypt(optimistic.content, msgAad(id));
      const res = await getSupabase()
        .from("messages")
        .insert({
          id,
          room_id: roomId,
          author_name: me.name.slice(0, 40),
          author_color: me.color,
          content,
        })
        .select()
        .single();
      error = res.error;
      data = res.data as ChatMessage | null;
    } catch (err) {
      error = { message: (err as Error).message };
    }
    if (error) {
      const msg = error.code === "PT429" ? "Gửi quá nhanh" : "Gửi lỗi";
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: "failed", error: msg } : m)));
    } else if (data) {
      // DB trả về bản mã hoá → giữ nội dung gốc mình vừa gõ
      merge([{ ...data, content: optimistic.content }]);
    }
  };

  const submit = () => {
    if (!text.trim()) return;
    void send(text);
    setText("");
    sendTyping.cancel();
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // tự giãn ô nhập
  useLayoutEffect(() => {
    const t = inputRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(140, t.scrollHeight)}px`;
  }, [text]);

  const typingNames = Array.from(typing.values()).map((t) => t.name);

  return (
    <aside
      data-ui
      aria-label="Trò chuyện"
      className={cn(
        "chat-panel fixed z-40 flex flex-col overflow-hidden border-line bg-panel shadow-float",
        "inset-0 md:inset-auto md:top-[68px] md:right-3 md:bottom-3 md:w-[360px] md:rounded-2xl md:border",
        open ? "chat-open" : "chat-closed",
      )}
    >
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <MessageCircle size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-ink">Trò chuyện</div>
          <div className="flex items-center gap-1.5 text-xs text-ink-3">
            <span className="truncate">
              {peers.length ? `Bạn và ${peers.length} người khác đang online` : "Chỉ có bạn trong phòng"}
            </span>
            <span
              className="tip inline-flex shrink-0 items-center gap-0.5 text-success"
              data-tip="Tin nhắn được mã hoá AES-256 trước khi rời trình duyệt"
              data-tip-side="bottom"
            >
              <Lock size={11} /> Mã hoá
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng trò chuyện"
          className="rounded-lg p-1.5 text-ink-2 hover:bg-hover hover:text-ink"
        >
          <X size={18} />
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          className="h-full overflow-y-auto px-3 py-3"
          onScroll={(e) => {
            const el = e.currentTarget;
            const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            atBottomRef.current = bottom;
            setAtBottom(bottom);
            if (bottom) setNewBelow(0);
          }}
        >
          {hasMore && (
            <div className="mb-3 flex justify-center">
              <button
                type="button"
                onClick={loadOlder}
                disabled={loadingMore}
                className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-2 hover:bg-hover"
              >
                {loadingMore ? "Đang tải…" : "Xem tin cũ hơn"}
              </button>
            </div>
          )}
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <span className="spinner" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="mb-3 text-4xl">👋</div>
              <div className="font-medium text-ink">Chưa có tin nhắn</div>
              <p className="mt-1 text-sm text-ink-3">Gửi lời chào tới mọi người trong phòng.</p>
            </div>
          ) : (
            <MessageList messages={messages} userId={userId} onRetry={(m) => send(m.content, m.id)} />
          )}
        </div>
        {!atBottom && newBelow > 0 && (
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="pop-in absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-float"
          >
            <ArrowDown size={14} /> {newBelow} tin mới
          </button>
        )}
      </div>

      <div className="h-5 px-4 text-xs text-ink-3">
        {typingNames.length > 0 && (
          <span className="fade-in inline-flex items-center gap-1.5">
            <span className="typing-dots">
              <i />
              <i />
              <i />
            </span>
            {typingNames.length === 1
              ? `${typingNames[0]} đang nhập…`
              : `${typingNames.slice(0, 2).join(", ")}${typingNames.length > 2 ? "…" : ""} đang nhập…`}
          </span>
        )}
      </div>

      <form
        className="flex items-end gap-1.5 border-t border-line p-2.5 pb-[max(10px,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Popover
          side="top"
          align="start"
          trigger={({ toggle, open: o }) => (
            <button
              type="button"
              onClick={toggle}
              aria-label="Chèn emoji"
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-2 hover:bg-hover hover:text-ink",
                o && "bg-hover",
              )}
            >
              <Smile size={20} />
            </button>
          )}
        >
          {(close) => (
            <div className="grid w-[232px] grid-cols-8 gap-0.5">
              {EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-lg hover:bg-hover"
                  onClick={() => {
                    setText((t) => t + em);
                    close();
                    inputRef.current?.focus();
                  }}
                >
                  {em}
                </button>
              ))}
            </div>
          )}
        </Popover>
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          maxLength={4000}
          placeholder="Nhắn gì đó…"
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value) sendTyping(me.name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") onClose();
          }}
          className="max-h-[140px] min-h-10 flex-1 resize-none rounded-xl border border-line bg-canvas px-3 py-2.5 text-[14px] leading-5 text-ink outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <button
          type="submit"
          aria-label="Gửi"
          disabled={!text.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition-colors hover:bg-accent-strong disabled:bg-hover disabled:text-ink-3"
        >
          <SendHorizontal size={18} />
        </button>
      </form>
    </aside>
  );
}

function MessageList({
  messages,
  userId,
  onRetry,
}: {
  messages: ChatMessage[];
  userId: string;
  onRetry: (m: ChatMessage) => void;
}) {
  return (
    <div className="flex flex-col">
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const t = new Date(m.created_at);
        const newDay = !prev || new Date(prev.created_at).toDateString() !== t.toDateString();
        const grouped =
          !!prev && !newDay && prev.user_id === m.user_id && t.getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
        const lastInGroup =
          !next ||
          next.user_id !== m.user_id ||
          new Date(next.created_at).getTime() - t.getTime() >= 5 * 60_000 ||
          new Date(next.created_at).toDateString() !== t.toDateString();
        const mine = m.user_id === userId;
        return (
          <Fragment key={m.id}>
            {newDay && (
              <div className="my-3 flex items-center gap-3 text-[11px] font-medium text-ink-3">
                <div className="h-px flex-1 bg-line" />
                {dayLabel(t)}
                <div className="h-px flex-1 bg-line" />
              </div>
            )}
            <div className={cn("msg-in flex gap-2", mine ? "flex-row-reverse" : "flex-row", grouped ? "mt-0.5" : "mt-3")}>
              <div className="w-7 shrink-0">
                {!mine && lastInGroup && <Avatar name={m.author_name} color={m.author_color} size={28} />}
              </div>
              <div className={cn("flex max-w-[78%] min-w-0 flex-col", mine ? "items-end" : "items-start")}>
                {!grouped && !mine && (
                  <span
                    className="mb-0.5 flex items-center gap-1 px-1 text-[12px] font-semibold"
                    style={{ color: m.author_color }}
                  >
                    {m.author_name}
                    {m.author_verified ? (
                      <BadgeCheck size={13} aria-label="Tài khoản đã xác thực" className="text-accent" />
                    ) : (
                      <span className="font-normal text-ink-3">· khách</span>
                    )}
                  </span>
                )}
                <div
                  title={formatTime(m.created_at)}
                  className={cn(
                    "rounded-2xl px-3 py-2 text-[14px] leading-[1.45] break-words whitespace-pre-wrap",
                    mine ? "bg-accent text-white" : "bg-canvas text-ink",
                    mine ? (lastInGroup ? "rounded-br-md" : "") : lastInGroup ? "rounded-bl-md" : "",
                    m.status === "sending" && "opacity-60",
                    m.status === "failed" && "bg-danger-soft text-danger",
                    isOnlyEmoji(m.content) && "bg-transparent! px-0 py-0 text-4xl leading-tight",
                  )}
                >
                  {m.undecryptable ? (
                    <span className="inline-flex items-center gap-1 italic opacity-70">
                      <Lock size={12} /> Không giải mã được tin nhắn này
                    </span>
                  ) : (
                    <Linkified text={m.content} mine={mine && m.status !== "failed"} />
                  )}
                </div>
                {m.status === "failed" ? (
                  <button
                    type="button"
                    onClick={() => onRetry(m)}
                    className="mt-0.5 flex items-center gap-1 px-1 text-[11px] font-medium text-danger hover:underline"
                  >
                    <RotateCw size={11} /> {m.error ?? "Gửi lỗi"} · thử lại
                  </button>
                ) : (
                  lastInGroup && (
                    <span className="mt-0.5 px-1 text-[11px] text-ink-3">
                      {m.status === "sending" ? "Đang gửi…" : formatTime(m.created_at)}
                    </span>
                  )
                )}
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function dayLabel(d: Date) {
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hôm nay";
  if (d.toDateString() === y.toDateString()) return "Hôm qua";
  return d.toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "numeric" });
}

function isOnlyEmoji(s: string) {
  const t = s.trim();
  return t.length <= 8 && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(t) && !/^[\d#*\s]+$/.test(t);
}

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

function Linkified({ text, mine }: { text: string; mine: boolean }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={cn("underline underline-offset-2", mine ? "text-white" : "text-accent")}
          >
            {p}
          </a>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}
