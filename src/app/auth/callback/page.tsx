import type { Metadata } from "next";
import { AuthCallback } from "@/components/auth/AuthCallback";

export const metadata: Metadata = { title: "Đang đăng nhập", robots: { index: false } };

export default function CallbackPage() {
  return <AuthCallback />;
}
