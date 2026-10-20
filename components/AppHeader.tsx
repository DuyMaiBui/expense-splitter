"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";

/** The only screens a signed-out visitor can reach; every other page sends a 401 to /login. */
const AUTH_ROUTES = new Set(["/login", "/register"]);

/** App-wide header: brand (home), profile and logout, each an icon with its name beside it. */
export function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);

  // No session probe here: an extra request per page would be billed, and calling /api/auth/me
  // from the login screen would bounce through the client's 401 redirect. Membership of the two
  // public routes is the whole signal.
  const signedIn = !AUTH_ROUTES.has(pathname);

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
        {signedIn && (
          <div className="row row-nowrap header-actions">
            {/* The caller's own profile, where their receiving account lives. */}
            <Link
              className="btn btn-ghost"
              href="/profile"
              prefetch={false}
              aria-label="Hồ sơ"
              title="Hồ sơ và tài khoản nhận tiền của bạn"
            >
              <Icon name="user" />
              <span>Hồ sơ</span>
            </Link>
            <IconButton
              icon="logout"
              label="Đăng xuất"
              variant="ghost"
              showLabel
              onClick={handleLogout}
              disabled={busy}
            />
          </div>
        )}
      </div>
    </header>
  );
}
