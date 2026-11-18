"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HeartHandshake, LockKeyhole, Star } from "lucide-react";
import { accessToken, getSupabase, supabaseConfigured } from "@/lib/supabase";
import { isRegistered, useAuth } from "@/lib/auth";
import { FEEDBACK_CATEGORIES, validateFeedback, type FeedbackCategory } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { AuthShell, Field, inputCls, primaryBtn } from "../auth/AuthShell";

const PLACEHOLDER: Record<FeedbackCategory, string> = {
  rating: "Bạn thích điều gì, chưa thích điều gì? (không bắt buộc)",
  bug: "Lỗi xảy ra khi nào? Bạn đã làm gì trước đó? Dùng trình duyệt / thiết bị gì?",
  idea: "Bạn muốn Bàn Tròn có thêm tính năng gì?",
  other: "Bạn muốn nhắn gì tới đội phát triển?",
};

export function FeedbackForm() {
  const { user } = useAuth();
  const [rating, setRating] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [category, setCategory] = useState<FeedbackCategory>("rating");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState<string | null>(null);
  const [website, setWebsite] = useState(""); // bẫy bot
  const [error, setError] = useState<{ field: string; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [stats, setStats] = useState<{ average: number; total: number } | null>(null);
  const startedAt = useRef(0);
  const from = useRef<string | null>(null);

  useEffect(() => {
    startedAt.current = Date.now();
    from.current = new URLSearchParams(window.location.search).get("from");
    if (!supabaseConfigured) return;
    void accessToken()
      .then(() => getSupabase().rpc("feedback_stats"))
      .then(({ data }) => {
        const row = Array.isArray(data) ? data[0] : null;
        if (row && row.total > 0) setStats({ average: Number(row.average), total: row.total });
      })
      .catch(() => {});
  }, []);

  const email = contact ?? (isRegistered(user) ? (user.email ?? "") : "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const payload = {
      rating,
      category,
      message,
      contact: email.trim() || null,
      page: from.current,
      website,
      startedAt: startedAt.current,
    };
    const v = validateFeedback(payload);
    if (!v.ok) return setError({ field: v.field, msg: v.error });
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await accessToken()}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError({ field: data.field ?? "", msg: data.error ?? "Không gửi được, thử lại sau" });
      else setDone(true);
    } catch {
      setError({ field: "", msg: "Không gửi được, kiểm tra kết nối mạng" });
    }
    setBusy(false);
  };

  if (done) {
    return (
      <AuthShell>
        <div className="pop-in rounded-2xl border border-line bg-panel p-6 text-center shadow-float" data-testid="feedback-done">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
            <HeartHandshake size={22} />
          </div>
          <h1 className="text-lg font-semibold text-ink">Cảm ơn bạn!</h1>
          <p className="mt-1.5 text-sm text-ink-2">Góp ý đã được gửi tới đội phát triển. Mỗi ý kiến đều được đọc.</p>
          <div className="mt-5 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDone(false);
                setMessage("");
                setRating(null);
                startedAt.current = Date.now();
              }}
              className="rounded-xl border border-line px-4 py-2 text-sm font-medium hover:bg-hover"
            >
              Gửi góp ý khác
            </button>
            <Link href="/" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white">
              Về trang chủ
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  const shown = hover ?? rating ?? 0;
  return (
    <AuthShell>
      <form onSubmit={submit} noValidate className="rounded-2xl border border-line bg-panel p-6 shadow-float">
        <h1 className="text-xl font-bold text-ink">Góp ý & đánh giá</h1>
        <p className="mt-1 mb-5 text-sm text-ink-2">
          Bạn thấy Bàn Tròn thế nào? Báo lỗi hoặc đề xuất tính năng cũng được.
          {stats && (
            <span className="mt-1 flex items-center gap-1 text-ink-3">
              <Star size={13} className="fill-current text-warn" /> {stats.average.toFixed(1)}/5 từ {stats.total} lượt đánh giá
            </span>
          )}
        </p>

        <div className="mb-4">
          <div className="mb-1.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">Chủ đề</div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Chủ đề">
            {(Object.keys(FEEDBACK_CATEGORIES) as FeedbackCategory[]).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={category === k}
                onClick={() => setCategory(k)}
                className={cn(
                  "h-8 rounded-lg border px-3 text-sm font-medium transition-colors",
                  category === k ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2 hover:bg-hover",
                )}
              >
                {FEEDBACK_CATEGORIES[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">
            Đánh giá {category === "rating" ? "" : "(không bắt buộc)"}
          </div>
          <div className="flex gap-1" role="radiogroup" aria-label="Số sao" onMouseLeave={() => setHover(null)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} sao`}
                onMouseEnter={() => setHover(n)}
                onClick={() => setRating(rating === n ? null : n)}
                className="rounded-lg p-1 transition-transform hover:scale-110"
              >
                <Star size={28} className={n <= shown ? "fill-current text-warn" : "text-line"} />
              </button>
            ))}
          </div>
          {error?.field === "rating" && <p role="alert" className="mt-1 text-xs text-danger">{error.msg}</p>}
        </div>

        <Field label="Nội dung" htmlFor="fb-msg" error={error?.field === "message" ? error.msg : null}>
          <textarea
            id="fb-msg"
            rows={5}
            maxLength={3000}
            value={message}
            placeholder={PLACEHOLDER[category]}
            onChange={(e) => setMessage(e.target.value)}
            className={cn(inputCls, "h-auto resize-y py-2.5 leading-relaxed")}
          />
        </Field>

        <Field
          label="Email để chúng tôi phản hồi (không bắt buộc)"
          htmlFor="fb-email"
          error={error?.field === "contact" ? error.msg : null}
        >
          <input
            id="fb-email"
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(e) => setContact(e.target.value)}
            className={inputCls}
          />
        </Field>

        {/* Bẫy bot: người thật không thấy ô này */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="fb-website">Website</label>
          <input id="fb-website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>

        {error && !["rating", "message", "contact"].includes(error.field) && (
          <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error.msg}
          </p>
        )}
        <button type="submit" disabled={busy} className={primaryBtn}>
          {busy && <span className="spinner spinner-white" />} Gửi góp ý
        </button>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-3">
          <LockKeyhole size={13} className="mt-0.5 shrink-0" />
          Nội dung và email của bạn được mã hoá khi lưu trữ và chỉ dùng để cải thiện sản phẩm.
        </p>
      </form>
    </AuthShell>
  );
}
