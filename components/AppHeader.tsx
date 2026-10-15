"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";

/** App-wide header: brand (home) and logout, each an icon with its name beside it. */
export function AppHeader() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleLogout(): Promise<void> {
    setBusy(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // Logging out is best-effort: an offline client or an already-expired session must
      // still end up back on /login rather than stuck on a protected page.
    }
    router.replace("/login");
  }

  return (
    <header className="app-header">
      <div className="container">
        {/* prefetch off: every speculative prefetch is a billed Worker invocation */}
        <Link className="brand row row-nowrap" href="/groups" prefetch={false} title="Nhóm của tôi">
          <Icon name="wallet" size={24} />
          <span>Chia tiền nhóm</span>
        </Link>
        <IconButton icon="logout" label="Đăng xuất" variant="ghost" showLabel onClick={handleLogout} disabled={busy} />
      </div>
    </header>
  );
}
