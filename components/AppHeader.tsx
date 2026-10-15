"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/api-client";

/** App-wide header: product title plus the logout control. */
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
        <Link className="brand" href="/groups">
          Chia tiền nhóm
        </Link>
        <button className="btn btn-ghost" type="button" onClick={handleLogout} disabled={busy}>
          {busy ? "Đang thoát…" : "Đăng xuất"}
        </button>
      </div>
    </header>
  );
}
