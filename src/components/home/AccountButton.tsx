"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, MessageSquareHeart, UserRound } from "lucide-react";
import { isRegistered, signOut, useAuth } from "@/lib/auth";
import { useIdentity } from "@/lib/identity";
import { Avatar, Popover } from "../ui/primitives";

export function AccountButton() {
  const { user, ready } = useAuth();
  const me = useIdentity();
  const router = useRouter();
  if (!ready) return <span className="h-9 w-[92px]" />;
  if (!isRegistered(user)) {
    return (
      <Link
        href="/login"
        className="flex h-9 items-center rounded-xl border border-line bg-panel px-4 text-sm font-semibold text-ink hover:bg-hover"
      >
        Đăng nhập
      </Link>
    );
  }
  return (
    <Popover
      align="end"
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle} aria-label="Tài khoản" className="rounded-full transition-opacity hover:opacity-85">
          <Avatar name={me.name} color={me.color} size={36} />
        </button>
      )}
    >
      {(close) => (
        <div className="w-[240px]">
          <div className="px-2.5 pt-1 pb-2">
            <div className="truncate text-sm font-semibold text-ink">{me.name}</div>
            <div className="truncate text-xs text-ink-3">{user.email}</div>
          </div>
          <Link
            href="/account"
            onClick={close}
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink hover:bg-hover"
          >
            <UserRound size={15} /> Hồ sơ & bảo mật
          </Link>
          <Link
            href="/feedback"
            onClick={close}
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink hover:bg-hover"
          >
            <MessageSquareHeart size={15} /> Góp ý & đánh giá
          </Link>
          <button
            type="button"
            onClick={async () => {
              close();
              await signOut();
              router.refresh();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-ink hover:bg-hover"
          >
            <LogOut size={15} /> Đăng xuất
          </button>
        </div>
      )}
    </Popover>
  );
}
