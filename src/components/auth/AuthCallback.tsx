"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getSupabase } from "@/lib/supabase";
import { finishGuestClaim, safeNext } from "@/lib/auth";
import { AuthShell } from "./AuthShell";

/**
 * Trang quay về sau khi đăng nhập Google hoặc bấm link xác nhận email.
 * supabase-js (PKCE) tự đổi `?code=` lấy phiên đăng nhập khi khởi tạo.
 */
export function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const errDesc = params.get("error_description") ?? hash.get("error_description");
      const next = safeNext(params.get("next"));
      const sb = getSupabase();
      let { data } = await sb.auth.getSession();
      if (!data.session && params.get("code")) {
        // phòng trường hợp chưa tự đổi mã
        await sb.auth.exchangeCodeForSession(params.get("code")!).catch(() => null);
        ({ data } = await sb.auth.getSession());
      }
      if (cancelled) return;
      if (!data.session || data.session.user.is_anonymous) {
        setError(
          errDesc
            ? `Đăng nhập không thành công: ${errDesc.slice(0, 200)}`
            : "Link đã hết hạn hoặc được mở trên trình duyệt khác. Nếu bạn vừa xác nhận email, hãy đăng nhập lại.",
        );
        return;
      }
      const n = await finishGuestClaim();
      if (n > 0) toast.success(`Đã chuyển ${n} phòng bạn tạo khi là khách vào tài khoản`);
      router.replace(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <AuthShell>
      <div className="rounded-2xl border border-line bg-panel p-6 text-center shadow-float">
        {error ? (
          <>
            <h1 className="text-lg font-semibold text-ink">Chưa đăng nhập được</h1>
            <p className="mt-1.5 text-sm text-ink-2">{error}</p>
            <Link href="/login" className="mt-4 inline-block rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white">
              Đến trang đăng nhập
            </Link>
          </>
        ) : (
          <div className="flex items-center justify-center gap-3 text-sm text-ink-2">
            <span className="spinner" /> Đang đăng nhập…
          </div>
        )}
      </div>
    </AuthShell>
  );
}
