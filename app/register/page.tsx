"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Icon } from "@/components/Icon";
import { api } from "@/lib/api-client";
import type { User } from "@/lib/types";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api<{ user: User }>("/api/auth/register", {
        method: "POST",
        body: { username, displayName, password },
      });
      router.replace("/groups");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Đăng ký thất bại.");
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
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9_.]+"
            title="3-32 ký tự: chữ, số, _ và ."
            placeholder="Tên đăng nhập"
            aria-label="Tên đăng nhập"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <Icon name="user" />
          <input
            className="input"
            maxLength={50}
            placeholder="Tên hiển thị"
            aria-label="Tên hiển thị"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <Icon name="lock" />
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={6}
            title="Ít nhất 6 ký tự"
            placeholder="Mật khẩu"
            aria-label="Mật khẩu"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row row-between">
          <Link className="btn btn-ghost" href="/login" prefetch={false}>
            <Icon name="login" />
            <span>Đã có tài khoản</span>
          </Link>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            <Icon name="check" />
            <span>Tạo tài khoản</span>
          </button>
        </div>
      </form>
    </main>
  );
}
