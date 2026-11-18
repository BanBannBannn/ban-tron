"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Clock, Dices, Fingerprint, KeyRound, LockKeyhole, Plus, ShieldCheck, X } from "lucide-react";
import { isRegistered, useAuth } from "@/lib/auth";
import { AccountButton } from "./AccountButton";
import { MyRooms, PublicRooms } from "./RoomLists";
import { toast } from "sonner";
import { ensureSession, getSupabase, supabaseConfigured } from "@/lib/supabase";
import { randomName, setIdentity, useIdentity, USER_COLORS } from "@/lib/identity";
import { forgetRoom, parseRoomInput, randomSlug, useRecentRooms } from "@/lib/rooms";
import { Avatar } from "../ui/primitives";
import { Logo } from "../ui/Logo";
import { cn, timeAgo } from "@/lib/utils";
import { HeroArt } from "./HeroArt";

export function Home() {
  const router = useRouter();
  const me = useIdentity();
  const [draftName, setName] = useState<string | null>(null);
  const name = draftName ?? me.name;
  const [roomName, setRoomName] = useState("");
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [approval, setApproval] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const recent = useRecentRooms();
  const { user } = useAuth();
  const registered = isRegistered(user);

  useEffect(() => {
    if (supabaseConfigured) void ensureSession().catch(() => {});
  }, []);

  const saveName = () => {
    const n = name.trim().slice(0, 40);
    if (n && n !== me.name) setIdentity({ name: n });
    if (n) setIdentity({ confirmed: true });
  };

  const create = async () => {
    if (!supabaseConfigured) {
      toast.error("Chưa cấu hình Supabase. Xem README.md");
      return;
    }
    saveName();
    setCreating(true);
    try {
      await ensureSession();
      const display = name.trim() || me.name;
      for (let attempt = 0; attempt < 3; attempt++) {
        const slug = randomSlug();
        const { error } = await getSupabase()
          .from("rooms")
          .insert({
            slug,
            name: roomName.trim().slice(0, 80) || `Phòng của ${display}`,
            visibility: registered && isPublic ? "public" : "private",
            require_approval: approval,
          });
        if (!error) {
          router.push(`/r/${slug}`);
          return;
        }
        if (error.code === "PT429") throw new Error("Bạn tạo phòng quá nhiều, thử lại sau ít phút");
        if (error.code !== "23505") throw error; // trùng slug → thử lại
      }
      throw new Error("Không tạo được phòng");
    } catch (err) {
      toast.error((err as Error).message);
      setCreating(false);
    }
  };

  const join = () => {
    const slug = parseRoomInput(code);
    if (!slug) {
      toast.error("Mã phòng không hợp lệ");
      return;
    }
    saveName();
    router.push(`/r/${slug}`);
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-canvas">
      <div className="board-grid pointer-events-none absolute inset-0 opacity-70 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2.5">
          <Logo size={34} />
          <span className="text-[17px] font-bold tracking-tight text-ink">Bàn Tròn</span>
        </div>
        <div className="flex items-center gap-2">
          {!registered && (
            <span className="hidden rounded-full border border-line bg-panel px-3 py-1 text-xs font-medium text-ink-2 md:inline">
              Miễn phí · Không bắt buộc tài khoản
            </span>
          )}
          <AccountButton />
        </div>
      </header>

      <section className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-5 pt-6 pb-16 lg:grid-cols-[1.05fr_1fr] lg:pt-14">
        <div>
          <h1 className="text-[40px] leading-[1.08] font-extrabold tracking-tight text-ink sm:text-[54px]">
            Cùng vẽ, cùng viết,
            <br />
            <span className="text-accent">cùng bàn</span> — ngay lúc này.
          </h1>
          <p className="mt-5 max-w-[520px] text-[17px] leading-relaxed text-ink-2">
            Bảng trắng vô hạn để cả nhóm cùng làm việc theo thời gian thực: vẽ tay, sơ đồ, ghi chú dán, bảng biểu, văn
            bản định dạng, ảnh và khung chat. Gửi link là vào ngay.
          </p>

          <div className="mt-8 max-w-[480px] rounded-2xl border border-line bg-panel p-5 shadow-float">
            <label className="mb-1.5 block text-xs font-semibold tracking-wide text-ink-3 uppercase" htmlFor="h-name">
              Tên của bạn
            </label>
            <div className="mb-4 flex items-center gap-2">
              <ColorPicker />
              <input
                id="h-name"
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                placeholder="Nhập tên…"
                className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 text-[15px] text-ink outline-none focus:border-accent"
              />
              <button
                type="button"
                title="Tên ngẫu nhiên"
                aria-label="Tên ngẫu nhiên"
                onClick={() => {
                  const n = randomName();
                  setName(n);
                  setIdentity({ name: n });
                }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-ink-2 hover:bg-hover"
              >
                <Dices size={18} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <input
                value={roomName}
                maxLength={80}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Tên phòng (không bắt buộc)"
                className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 text-[15px] text-ink outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={creating}
                className="flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-semibold text-white shadow-sm transition-all hover:bg-accent-strong active:scale-[0.98] disabled:opacity-70"
              >
                {creating ? <span className="spinner spinner-white" /> : <Plus size={18} />}
                Tạo phòng mới
              </button>
            </form>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-ink-2">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={approval}
                  onChange={(e) => setApproval(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                />
                Duyệt người vào phòng
              </label>
              <label
                className={cn("flex items-center gap-1.5", registered ? "cursor-pointer" : "cursor-not-allowed opacity-60")}
                title={registered ? undefined : "Cần đăng nhập để tạo phòng công khai"}
              >
                <input
                  type="checkbox"
                  disabled={!registered}
                  checked={registered && isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                />
                Công khai trên trang chủ
                {!registered && (
                  <Link href="/login" className="text-accent hover:underline">
                    (đăng nhập)
                  </Link>
                )}
              </label>
            </div>

            <div className="my-4 flex items-center gap-3 text-xs text-ink-3">
              <div className="h-px flex-1 bg-line" /> hoặc vào phòng có sẵn <div className="h-px flex-1 bg-line" />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                join();
              }}
              className="flex gap-2"
            >
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Mã phòng hoặc link, vd. abc-defg-hij"
                className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 text-[15px] text-ink outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={!code.trim()}
                className="flex h-11 items-center gap-1.5 rounded-xl border border-line px-4 text-[14px] font-semibold text-ink transition-colors hover:bg-hover disabled:opacity-50"
              >
                Vào <ArrowRight size={16} />
              </button>
            </form>
          </div>

          {registered && <MyRooms />}

          {!registered && recent.length > 0 && (
            <div className="mt-6 max-w-[480px]">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">
                <Clock size={13} /> Phòng gần đây
              </div>
              <div className="flex flex-col gap-1.5">
                {recent.map((r) => (
                  <div key={r.slug} className="group flex items-center gap-1">
                    <Link
                      href={`/r/${r.slug}`}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:border-line hover:bg-panel"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-sm font-bold text-accent">
                        {r.name.trim()[0]?.toUpperCase() ?? "#"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-ink">{r.name}</span>
                        <span className="block text-xs text-ink-3">
                          {r.slug} · {timeAgo(r.visitedAt)}
                        </span>
                      </span>
                      <ArrowRight size={16} className="text-ink-3 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                    <button
                      type="button"
                      aria-label="Xoá khỏi danh sách"
                      onClick={() => {
                        forgetRoom(r.slug);
                      }}
                      className="rounded-lg p-1.5 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-hover hover:text-ink"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <HeroArt />
      </section>

      <PublicRooms />

      <section className="relative z-10 mx-auto grid max-w-6xl gap-4 px-5 pb-20 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border border-line bg-panel/80 p-5 backdrop-blur">
            <div className="mb-3 text-2xl">{f.icon}</div>
            <div className="font-semibold text-ink">{f.title}</div>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">{f.desc}</p>
          </div>
        ))}
      </section>

      <SecuritySection />

      <footer className="relative z-10 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-line py-6 text-center text-xs text-ink-3">
        <span>© 2026 BanBannBannn · Bàn Tròn · AGPL-3.0</span>
        <Link href="/terms" className="hover:text-ink hover:underline">
          Điều khoản sử dụng
        </Link>
        <Link href="/privacy" className="hover:text-ink hover:underline">
          Quyền riêng tư & bảo mật
        </Link>
        <Link href="/feedback" className="hover:text-ink hover:underline">
          Góp ý & đánh giá
        </Link>
      </footer>
    </main>
  );
}

const SECURITY = [
  {
    icon: <LockKeyhole size={18} />,
    title: "Chat và bảng vẽ được mã hoá",
    desc: "Tin nhắn và nội dung bảng được mã hoá AES-256 ngay trên trình duyệt trước khi lưu. Cơ sở dữ liệu chỉ chứa dữ liệu đã mã hoá; khoá giải mã được cất riêng.",
  },
  {
    icon: <Fingerprint size={18} />,
    title: "Thông tin cá nhân mã hoá riêng",
    desc: "Họ tên, số điện thoại, ngày sinh được mã hoá bằng khoá riêng của từng người. Người cùng phòng không xem được.",
  },
  {
    icon: <ShieldCheck size={18} />,
    title: "Bạn quyết định ai được vào",
    desc: "Phòng riêng tư chỉ người có link mới vào được. Có thể bật duyệt từng người, mời ra hoặc chặn. Người bị mời ra không đọc được nội dung mới.",
  },
  {
    icon: <KeyRound size={18} />,
    title: "Tài khoản an toàn",
    desc: "Mật khẩu không bao giờ được lưu ở dạng gốc. Có xác nhận email, đăng nhập Google, đăng xuất mọi thiết bị và xoá tài khoản bất cứ lúc nào.",
  },
];

function SecuritySection() {
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-5 pb-20" aria-labelledby="sec-title">
      <div className="rounded-3xl border border-line bg-panel/90 p-6 backdrop-blur sm:p-8">
        <div className="mb-6 max-w-2xl">
          <h2 id="sec-title" className="text-2xl font-bold tracking-tight text-ink">
            Riêng tư theo mặc định
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
            Ngay cả khi cơ sở dữ liệu bị lộ, nội dung phòng và thông tin cá nhân của bạn vẫn không đọc được nếu không có
            khoá.{" "}
            <Link href="/privacy" className="font-medium text-accent hover:underline">
              Xem cách chúng tôi bảo vệ dữ liệu
            </Link>
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SECURITY.map((f) => (
            <div key={f.title}>
              <div className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">{f.icon}</div>
              <div className="font-semibold text-ink">{f.title}</div>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  { icon: "✍️", title: "Vẽ tay mượt", desc: "Nét bút mô phỏng lực nhấn, hỗ trợ bút cảm ứng, dạ quang, tẩy thông minh." },
  { icon: "🧩", title: "Đủ công cụ", desc: "Hình khối, mũi tên, chữ định dạng, ghi chú dán, bảng biểu, chèn ảnh." },
  { icon: "⚡", title: "Thời gian thực", desc: "Thấy con trỏ, nét vẽ và chỉnh sửa của mọi người ngay tức thì." },
  { icon: "💬", title: "Chat tích hợp", desc: "Trò chuyện ngay cạnh bảng, có báo đang nhập và đếm tin chưa đọc." },
];

function ColorPicker() {
  const me = useIdentity();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Đổi màu"
        className="rounded-full transition-transform hover:scale-105"
      >
        <Avatar name={me.name || "?"} color={me.color} size={44} />
      </button>
      {open && (
        <div className="pop-in absolute top-full left-0 z-20 mt-2 grid w-[184px] grid-cols-6 gap-2 rounded-xl border border-line bg-panel p-3 shadow-float">
          {USER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => {
                setIdentity({ color: c });
                setOpen(false);
              }}
              className={cn("h-6 w-6 rounded-full hover:scale-110", me.color === c && "ring-2 ring-offset-2 ring-offset-panel")}
              style={{ background: c, ["--tw-ring-color" as string]: c }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
