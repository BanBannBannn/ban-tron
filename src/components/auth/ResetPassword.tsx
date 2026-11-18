"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getSupabase } from "@/lib/supabase";
import { passwordProblem } from "@/lib/profile";
import { AuthShell, Field, inputCls, primaryBtn } from "./AuthShell";

/** Đặt mật khẩu mới sau khi bấm link "quên mật khẩu" trong email. */
export function ResetPassword() {
  const router = useRouter();
  const [ok, setOk] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && !session.user.is_anonymous)) setOk(true);
    });
    void sb.auth.getSession().then(({ data }) => {
      setOk((cur) => cur ?? (data.session && !data.session.user.is_anonymous ? true : false));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = passwordProblem(pw);
    if (p) return setError(p);
    if (pw !== pw2) return setError("Mật khẩu nhập lại không khớp");
    setBusy(true);
    const { error: err } = await getSupabase().auth.updateUser({ password: pw });
    setBusy(false);
    if (err) return setError(err.code === "same_password" ? "Mật khẩu mới phải khác mật khẩu cũ" : "Không đổi được mật khẩu");
    toast.success("Đã đặt mật khẩu mới");
    router.replace("/account");
  };

  return (
    <AuthShell>
      <div className="rounded-2xl border border-line bg-panel p-6 shadow-float">
        <h1 className="mb-4 text-xl font-bold text-ink">Đặt mật khẩu mới</h1>
        {ok === null ? (
          <div className="flex items-center gap-2 text-sm text-ink-2">
            <span className="spinner" /> Đang kiểm tra link…
          </div>
        ) : ok === false ? (
          <p className="text-sm text-ink-2">
            Link đã hết hạn hoặc không hợp lệ.{" "}
            <Link href="/login" className="font-medium text-accent hover:underline">
              Gửi lại link
            </Link>
          </p>
        ) : (
          <form onSubmit={submit} noValidate>
            <Field label="Mật khẩu mới" htmlFor="rp-1" hint="Ít nhất 8 ký tự, có cả chữ và số.">
              <input id="rp-1" type="password" autoComplete="new-password" maxLength={72} value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Nhập lại" htmlFor="rp-2" error={error}>
              <input id="rp-2" type="password" autoComplete="new-password" maxLength={72} value={pw2} onChange={(e) => setPw2(e.target.value)} className={inputCls} />
            </Field>
            <button type="submit" disabled={busy} className={primaryBtn}>
              Lưu mật khẩu
            </button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
