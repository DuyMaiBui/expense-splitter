"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Icon } from "@/components/Icon";
import { api } from "@/lib/api-client";
import type { User } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: { username, password },
      });
      // The admin account has no groups: its only screen is /admin.
      router.replace(user.role === "admin" ? "/admin" : "/groups");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Đăng nhập thất bại.");
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <form className="card stack" onSubmit={handleSubmit}>
        <div className="field">
          <Icon name="at" />
          <input
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            placeholder="Tên đăng nhập"
            aria-label="Tên đăng nhập"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <Icon name="lock" />
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            placeholder="Mật khẩu"
            aria-label="Mật khẩu"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row row-between">
          <Link className="btn btn-ghost" href="/register" prefetch={false}>
            <Icon name="userPlus" />
            <span>Tạo tài khoản</span>
          </Link>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            <Icon name="login" />
            <span>Đăng nhập</span>
          </button>
        </div>
      </form>
    </main>
  );
}
