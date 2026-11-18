import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "../ui/Logo";

/** Khung chung cho các trang đăng nhập / tài khoản. */
export function AuthShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="relative min-h-dvh bg-canvas">
      <div className="board-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" />
      <header className="relative z-10 mx-auto flex max-w-6xl items-center px-5 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={34} />
          <span className="text-[17px] font-bold tracking-tight text-ink">Bàn Tròn</span>
        </Link>
      </header>
      <div className={`relative z-10 mx-auto px-4 pt-4 pb-16 ${wide ? "max-w-[640px]" : "max-w-[420px]"}`}>{children}</div>
    </main>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold tracking-wide text-ink-3 uppercase">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputCls =
  "h-11 w-full rounded-xl border border-line bg-canvas px-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent disabled:opacity-60";

export const primaryBtn =
  "flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-semibold text-white transition-colors hover:bg-accent-strong disabled:opacity-60";
