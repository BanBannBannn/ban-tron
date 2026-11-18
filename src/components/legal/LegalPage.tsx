import Link from "next/link";
import type { ReactNode } from "react";
import { AuthShell } from "../auth/AuthShell";

/** Bố cục trang pháp lý (điều khoản, quyền riêng tư). */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <AuthShell wide>
      <article className="legal rounded-2xl border border-line bg-panel p-6 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 text-sm text-ink-3">Cập nhật lần cuối: {updated}</p>
        <div className="mt-6 space-y-6 text-[15px] leading-relaxed text-ink-2">{children}</div>
      </article>
      <nav className="mt-4 flex justify-center gap-4 text-sm text-ink-3">
        <Link href="/" className="hover:text-ink hover:underline">
          Trang chủ
        </Link>
        <Link href="/terms" className="hover:text-ink hover:underline">
          Điều khoản sử dụng
        </Link>
        <Link href="/privacy" className="hover:text-ink hover:underline">
          Quyền riêng tư
        </Link>
      </nav>
    </AuthShell>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-[17px] font-semibold text-ink">{title}</h2>
      <div className="space-y-2 [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1">{children}</div>
    </section>
  );
}
