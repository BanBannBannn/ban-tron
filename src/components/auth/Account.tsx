"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LockKeyhole, LogOut, ShieldAlert } from "lucide-react";
import { getSupabase, accessToken } from "@/lib/supabase";
import { isRegistered, signOut, useAuth } from "@/lib/auth";
import { setIdentity, USER_COLORS } from "@/lib/identity";
import { passwordProblem, validateProfile } from "@/lib/profile";
import { cn } from "@/lib/utils";
import { Avatar } from "../ui/primitives";
import { AuthShell, Field, inputCls, primaryBtn } from "./AuthShell";

interface ProfileData {
  email: string | null;
  provider: string;
  display_name: string | null;
  color: string | null;
  full_name: string | null;
  phone: string | null;
  birthday: string | null;
}

async function api(method: "GET" | "PUT", body?: unknown) {
  const res = await fetch("/api/profile", {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Lỗi ${res.status}`), { field: data.field as string | undefined });
  return data;
}

export function Account() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const [p, setP] = useState<ProfileData | null>(null);
  const [form, setForm] = useState({ display_name: "", color: USER_COLORS[0], full_name: "", phone: "", birthday: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (ready && !isRegistered(user)) router.replace("/login?next=/account");
  }, [ready, user, router]);

  useEffect(() => {
    if (!isRegistered(user)) return;
    let cancelled = false;
    api("GET")
      .then((d: ProfileData) => {
        if (cancelled) return;
        setP(d);
        setForm({
          display_name: d.display_name ?? "",
          color: d.color ?? USER_COLORS[0],
          full_name: d.full_name ?? "",
          phone: d.phone ?? "",
          birthday: d.birthday ?? "",
        });
      })
      .catch((e: Error) => toast.error(e.message));
    return () => {
      cancelled = true;
    };
  }, [user]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    const v = validateProfile(form);
    if (!v.ok) return setErrors({ [v.field]: v.error });
    setSaving(true);
    try {
      await api("PUT", form);
      setIdentity({ name: v.value.display_name!, color: v.value.color!, confirmed: true });
      toast.success("Đã lưu hồ sơ");
    } catch (err) {
      const e2 = err as Error & { field?: string };
      if (e2.field) setErrors({ [e2.field]: e2.message });
      else toast.error(e2.message);
    }
    setSaving(false);
  };

  if (!isRegistered(user) || !p) {
    return (
      <AuthShell>
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-2">
          <span className="spinner" /> Đang tải…
        </div>
      </AuthShell>
    );
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <AuthShell wide>
      <h1 className="mb-1 text-2xl font-bold text-ink">Hồ sơ & bảo mật</h1>
      <p className="mb-6 text-sm text-ink-2">
        {p.email} · đăng nhập bằng {p.provider === "google" ? "Google" : "email"}
      </p>

      <form onSubmit={save} className="mb-6 rounded-2xl border border-line bg-panel p-6 shadow-float" noValidate>
        <h2 className="mb-4 text-[15px] font-semibold text-ink">Hiển thị trong phòng</h2>
        <div className="mb-4 flex items-center gap-3">
          <Avatar name={form.display_name || "?"} color={form.color} size={48} />
          <div className="flex flex-wrap gap-1.5">
            {USER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Màu ${c}`}
                onClick={() => setForm((f) => ({ ...f, color: c }))}
                className={cn("h-6 w-6 rounded-full", form.color === c && "ring-2 ring-offset-2 ring-offset-panel")}
                style={{ background: c, ["--tw-ring-color" as string]: c }}
              />
            ))}
          </div>
        </div>
        <Field label="Tên hiển thị" htmlFor="ac-name" error={errors.display_name}>
          <input id="ac-name" value={form.display_name} maxLength={40} onChange={set("display_name")} className={inputCls} />
        </Field>

        <div className="mt-6 mb-4 flex items-start gap-2.5 rounded-xl bg-accent-soft px-3 py-2.5 text-[13px] text-ink-2">
          <LockKeyhole size={16} className="mt-0.5 shrink-0 text-accent" />
          <span>
            <b className="text-ink">Thông tin cá nhân được mã hoá.</b> Họ tên, số điện thoại và ngày sinh được mã hoá
            AES-256-GCM trước khi lưu vào cơ sở dữ liệu. Chỉ bạn xem được; người cùng phòng không thấy. Bỏ trống nếu không
            muốn cung cấp.
          </span>
        </div>
        <Field label="Họ và tên" htmlFor="ac-full" error={errors.full_name}>
          <input id="ac-full" value={form.full_name} maxLength={100} autoComplete="name" onChange={set("full_name")} className={inputCls} />
        </Field>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Số điện thoại" htmlFor="ac-phone" error={errors.phone}>
            <input id="ac-phone" type="tel" value={form.phone} maxLength={20} autoComplete="tel" onChange={set("phone")} className={inputCls} />
          </Field>
          <Field label="Ngày sinh" htmlFor="ac-bd" error={errors.birthday}>
            <input id="ac-bd" type="date" value={form.birthday} onChange={set("birthday")} className={inputCls} />
          </Field>
        </div>
        <button type="submit" disabled={saving} className={primaryBtn}>
          {saving && <span className="spinner spinner-white" />} Lưu hồ sơ
        </button>
      </form>

      {p.provider === "email" && <ChangePassword email={p.email ?? ""} />}

      <section className="mb-6 rounded-2xl border border-line bg-panel p-6">
        <h2 className="mb-3 text-[15px] font-semibold text-ink">Phiên đăng nhập</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              await signOut();
              router.replace("/");
            }}
            className="flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm font-medium hover:bg-hover"
          >
            <LogOut size={16} /> Đăng xuất
          </button>
          <button
            type="button"
            onClick={async () => {
              await getSupabase().auth.signOut({ scope: "global" });
              toast.success("Đã đăng xuất khỏi mọi thiết bị");
              router.replace("/");
            }}
            className="flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm font-medium hover:bg-hover"
          >
            Đăng xuất mọi thiết bị
          </button>
        </div>
      </section>

      <DeleteAccount />
    </AuthShell>
  );
}

function ChangePassword({ email }: { email: string }) {
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mb-6 rounded-2xl border border-line bg-panel p-6"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const prob = passwordProblem(pw);
        if (prob) return setError(prob);
        setBusy(true);
        const sb = getSupabase();
        // Xác thực lại bằng mật khẩu hiện tại → kẻ chiếm được phiên không đổi được mật khẩu
        const re = await sb.auth.signInWithPassword({ email, password: cur });
        if (re.error) {
          setBusy(false);
          return setError("Mật khẩu hiện tại không đúng");
        }
        const { error: err } = await sb.auth.updateUser({ password: pw });
        setBusy(false);
        if (err) return setError(err.code === "same_password" ? "Mật khẩu mới phải khác mật khẩu cũ" : "Không đổi được mật khẩu");
        setCur("");
        setPw("");
        toast.success("Đã đổi mật khẩu");
      }}
    >
      <h2 className="mb-4 text-[15px] font-semibold text-ink">Đổi mật khẩu</h2>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Mật khẩu hiện tại" htmlFor="cp-cur">
          <input id="cp-cur" type="password" autoComplete="current-password" maxLength={72} value={cur} onChange={(e) => setCur(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Mật khẩu mới" htmlFor="cp-new" error={error}>
          <input id="cp-new" type="password" autoComplete="new-password" maxLength={72} value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <button type="submit" disabled={busy || !cur || !pw} className="h-10 rounded-xl bg-ink px-4 text-sm font-semibold text-panel disabled:opacity-40">
        Đổi mật khẩu
      </button>
    </form>
  );
}

function DeleteAccount() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="rounded-2xl border border-danger/30 bg-panel p-6">
      <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-danger">
        <ShieldAlert size={17} /> Xoá tài khoản
      </h2>
      <p className="mb-3 text-sm text-ink-2">
        Xoá vĩnh viễn tài khoản, hồ sơ, các phòng bạn tạo và tin nhắn bạn đã gửi. Không thể hoàn tác. Gõ <b>XOÁ</b> để xác
        nhận.
      </p>
      <div className="flex gap-2">
        <input
          aria-label="Gõ XOÁ để xác nhận"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={cn(inputCls, "h-10 max-w-[160px]")}
        />
        <button
          type="button"
          disabled={text.trim().toUpperCase() !== "XOÁ" || busy}
          onClick={async () => {
            setBusy(true);
            const { error } = await getSupabase().rpc("delete_my_account");
            if (error) {
              setBusy(false);
              return toast.error("Không xoá được tài khoản");
            }
            await getSupabase().auth.signOut({ scope: "local" });
            toast.success("Đã xoá tài khoản");
            router.replace("/");
          }}
          className="h-10 rounded-xl bg-danger px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          Xoá vĩnh viễn
        </button>
      </div>
    </section>
  );
}
