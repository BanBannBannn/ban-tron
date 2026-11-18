import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const font = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Bàn Tròn · Bảng trắng cộng tác thời gian thực",
    template: "%s · Bàn Tròn",
  },
  description:
    "Bảng trắng vô hạn để cả nhóm cùng vẽ, viết, ghi chú, làm bảng biểu và trò chuyện theo thời gian thực. Miễn phí, chat và nội dung được mã hoá, không bắt buộc tài khoản.",
  applicationName: "Bàn Tròn",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#f6f6f3",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${font.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <Toaster
          position="bottom-center"
          offset={84}
          toastOptions={{
            style: {
              fontFamily: "var(--font-sans)",
              borderRadius: 14,
              border: "1px solid var(--color-line)",
              boxShadow: "var(--shadow-float)",
            },
          }}
        />
      </body>
    </html>
  );
}
