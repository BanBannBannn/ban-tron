"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, EyeOff, MailCheck } from "lucide-react";
import { getSupabase, supabaseConfigured } from "@/lib/supabase";
import { finishGuestClaim, isRegistered, prepareGuestClaim, safeNext, useAuth } from "@/lib/auth";
import { getIdentity } from "@/lib/identity";
import { passwordProblem } from "@/lib/profile";
import { cn } from "@/lib/utils";
import { AuthShell, Field, inputCls, primaryBtn } from "./AuthShell";

type Mode = "login" | "signup" | "forgot";

const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_AUTH_GOOGLE === "true";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function nextParam() {
  if (typeof window === "undefined") return "/";
  return safeNext(new URLSearchParams(window.location.search).get("next"));
}

function callbackUrl() {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextParam())}`;
}

export function AuthForm() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [name, setName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<null | "confirm" | "reset">(null);

  useEffect(() => {
    // đọc URL sau khi hydrate (trang được prerender tĩnh)
    const t = setTimeout(() => {
      if (new URLSearchParams(window.location.search).get("mode") === "signup") setMode("signup");
      const id = getIdentity();
      if (id.confirmed) setName(id.name);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const done = async () => {
    const n = await finishGuestClaim();
    if (n > 0) toast.success(`Đã chuyển ${n} phòng bạn tạo khi là khách vào tài khoản`);
    router.replace(nextParam());
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!supabaseConfigured) return setError("Chưa cấu hình Supabase");
    const em = email.trim().toLowerCase();
    if (!EMAIL_RE.test(em)) return setError("Email không hợp lệ");
    const sb = getSupabase();

    if (mode === "forgot") {
      setBusy(true);
      await sb.auth.resetPasswordForEmail(em, { redirectTo: `${window.location.origin}/auth/reset` });
      setBusy(false);
      // luôn báo như nhau → không dò được email nào đã đăng ký
      setSent("reset");
      return;
    }

    if (mode === "signup") {
      const n = name.trim();
      if (n.length < 1 || n.length > 40) return setError("Tên hiển thị dài 1–40 ký tự");
      const pwErr = passwordProblem(password);
      if (pwErr) return setError(pwErr);
      if (password !== password2) return setError("Mật khẩu nhập lại không khớp");
      setBusy(true);
      await prepareGuestClaim();
      const { data, error: err } = await sb.auth.signUp({
        email: em,
        password,
        options: { data: { display_name: n, color: getIdentity().color }, emailRedirectTo: callbackUrl() },
      });
      setBusy(false);
      if (err) {
        return setError(
          err.code === "weak_password"
            ? "Mật khẩu quá yếu, hãy chọn mật khẩu khác"
            : err.status === 429
              ? "Thử quá nhiều lần, vui lòng đợi một lát"
              : err.code === "user_already_exists"
                ? "Không đăng ký được với email này"
                : "Không đăng ký được, thử lại sau",
        );
      }
      if (data.session) return done(); // project không bắt xác nhận email
      setSent("confirm");
      return;
    }

    setBusy(true);
    await prepareGuestClaim();
    const { error: err } = await sb.auth.signInWithPassword({ email: em, password });
    setBusy(false);
    if (err) {
      setPassword("");
      return setError(
        err.code === "email_not_confirmed"
          ? "Email chưa được xác nhận. Kiểm tra hộp thư của bạn."
          : err.status === 429
            ? "Thử quá nhiều lần, vui lòng đợi một lát"
            : "Email hoặc mật khẩu không đúng",
      );
    }
    void done();
  };

  const google = async () => {
    setBusy(true);
    await prepareGuestClaim();
    const { error: err } = await getSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    if (err) {
      setBusy(false);
      setError("Đăng nhập Google chưa được bật trên server");
    }
  };

  if (ready && isRegistered(user) && !busy && !sent) {
    return (
      <AuthShell>
        <div className="rounded-2xl border border-line bg-panel p-6 text-center shadow-float">
          <p className="text-ink">
            Bạn đang đăng nhập bằng <b>{user.email}</b>.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/account" className="rounded-xl border border-line px-4 py-2 text-sm font-medium hover:bg-hover">
              Hồ sơ
            </Link>
            <Link href={nextParam()} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white">
              Tiếp tục
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  if (sent) {
    return (
      <AuthShell>
        <div className="pop-in rounded-2xl border border-line bg-panel p-6 text-center shadow-float" data-testid="auth-sent">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
            <MailCheck size={22} />
          </div>
          <h1 className="text-lg font-semibold text-ink">Kiểm tra hộp thư</h1>
          <p className="mt-1.5 text-sm text-ink-2">
            {sent === "confirm"
              ? `Nếu ${email.trim()} chưa được dùng, chúng tôi đã gửi link xác nhận. Mở link trên trình duyệt này để hoàn tất đăng ký.`
              : `Nếu ${email.trim()} có tài khoản, chúng tôi đã gửi link đặt lại mật khẩu.`}
          </p>
          <button
            type="button"
            onClick={() => {
              setSent(null);
              setMode("login");
            }}
            className="mt-5 text-sm font-medium text-accent hover:underline"
          >
            Quay lại đăng nhập
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="rounded-2xl border border-line bg-panel p-6 shadow-float">
        <h1 className="text-xl font-bold text-ink">
          {mode === "login" ? "Đăng nhập" : mode === "signup" ? "Tạo tài khoản" : "Quên mật khẩu"}
        </h1>
        <p className="mt-1 mb-5 text-sm text-ink-2">
          {mode === "forgot"
            ? "Nhập email, chúng tôi sẽ gửi link đặt lại mật khẩu."
            : "Lưu phòng theo tài khoản, xem trên mọi thiết bị, tạo phòng công khai và có dấu xác thực khi chat."}
        </p>

        {mode !== "forgot" && (
          <div role="tablist" className="mb-5 grid grid-cols-2 rounded-xl bg-canvas p-1">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                type="button"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={cn(
                  "h-9 rounded-lg text-sm font-semibold transition-colors",
                  mode === m ? "bg-panel text-ink shadow-sm" : "text-ink-3 hover:text-ink",
                )}
              >
                {m === "login" ? "Đăng nhập" : "Đăng ký"}
              </button>
            ))}
          </div>
        )}

        {GOOGLE_ENABLED && mode !== "forgot" && (
          <>
            <button
              type="button"
              onClick={google}
              disabled={busy}
              className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-panel text-[15px] font-semibold text-ink hover:bg-hover disabled:opacity-60"
            >
              <GoogleIcon /> Tiếp tục với Google
            </button>
            <div className="my-4 flex items-center gap-3 text-xs text-ink-3">
              <div className="h-px flex-1 bg-line" /> hoặc dùng email <div className="h-px flex-1 bg-line" />
            </div>
          </>
        )}

        <form onSubmit={submit} noValidate>
          {mode === "signup" && (
            <Field label="Tên hiển thị" htmlFor="au-name" hint="Mọi người trong phòng sẽ thấy tên này.">
              <input
                id="au-name"
                value={name}
                maxLength={40}
                autoComplete="nickname"
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
              />
            </Field>
          )}
          <Field label="Email" htmlFor="au-email">
            <input
              id="au-email"
              type="email"
              value={email}
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
            />
          </Field>
          {mode !== "forgot" && (
            <Field
              label="Mật khẩu"
              htmlFor="au-pw"
              hint={mode === "signup" ? "Ít nhất 8 ký tự, có cả chữ và số." : undefined}
            >
              <div className="relative">
                <input
                  id="au-pw"
                  type={showPw ? "text" : "password"}
                  value={password}
                  maxLength={72}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  onChange={(e) => setPassword(e.target.value)}
                  className={cn(inputCls, "pr-11")}
                />
                <button
                  type="button"
                  aria-label={showPw ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  onClick={() => setShowPw((s) => !s)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-1.5 text-ink-3 hover:text-ink"
                >
                  {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </Field>
          )}
          {mode === "signup" && (
            <Field label="Nhập lại mật khẩu" htmlFor="au-pw2">
              <input
                id="au-pw2"
                type={showPw ? "text" : "password"}
                value={password2}
                maxLength={72}
                autoComplete="new-password"
                onChange={(e) => setPassword2(e.target.value)}
                className={inputCls}
              />
            </Field>
          )}

          {error && (
            <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy} className={primaryBtn}>
            {busy && <span className="spinner spinner-white" />}
            {mode === "login" ? "Đăng nhập" : mode === "signup" ? "Tạo tài khoản" : "Gửi link đặt lại"}
          </button>
        </form>

        <div className="mt-4 flex justify-between text-sm">
          {mode === "login" ? (
            <button type="button" onClick={() => setMode("forgot")} className="text-ink-2 hover:text-ink hover:underline">
              Quên mật khẩu?
            </button>
          ) : mode === "forgot" ? (
            <button type="button" onClick={() => setMode("login")} className="text-ink-2 hover:text-ink hover:underline">
              ← Quay lại
            </button>
          ) : (
            <span />
          )}
          <Link href={nextParam()} className="text-ink-2 hover:text-ink hover:underline">
            Dùng tiếp với tư cách khách
          </Link>
        </div>
      </div>
      <p className="mt-4 text-center text-xs leading-relaxed text-ink-3">
        {mode === "signup" ? "Khi tạo tài khoản, bạn đồng ý với " : "Xem "}
        <Link href="/terms" className="underline hover:text-ink">
          Điều khoản sử dụng
        </Link>{" "}
        và{" "}
        <Link href="/privacy" className="underline hover:text-ink">
          Chính sách quyền riêng tư
        </Link>
        . Mật khẩu chỉ được lưu dạng băm; thông tin cá nhân được mã hoá AES-256.
      </p>
    </AuthShell>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
