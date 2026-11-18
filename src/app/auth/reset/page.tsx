import type { Metadata } from "next";
import { ResetPassword } from "@/components/auth/ResetPassword";

export const metadata: Metadata = { title: "Đặt lại mật khẩu", robots: { index: false } };

export default function ResetPage() {
  return <ResetPassword />;
}
