import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chia tiền nhóm",
  description: "Chia sẻ chi tiêu trong nhóm một cách đơn giản.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <AppHeader />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
