import type { Metadata } from "next";
import { Account } from "@/components/auth/Account";

export const metadata: Metadata = { title: "Hồ sơ & bảo mật", robots: { index: false } };

export default function AccountPage() {
  return <Account />;
}
