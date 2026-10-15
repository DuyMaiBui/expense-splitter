"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";

/** App-wide header: home icon plus the logout control. Icon-only; meaning is in aria-label. */
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
        <Link className="brand" href="/groups" prefetch={false} aria-label="Nhóm của tôi" title="Nhóm của tôi">
          <Icon name="wallet" size={26} />
        </Link>
        <IconButton icon="logout" label="Đăng xuất" variant="ghost" onClick={handleLogout} disabled={busy} />
      </div>
    </header>
  );
}
