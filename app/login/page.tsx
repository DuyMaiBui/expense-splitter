"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

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
      await api<{ user: User }>("/api/auth/login", { method: "POST", body: { username, password } });
      router.replace("/groups");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Đăng nhập thất bại.");
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <form className="card stack" onSubmit={handleSubmit}>
        <h1>Đăng nhập</h1>
        <div>
          <label className="label" htmlFor="username">
            Tên đăng nhập
          </label>
          <input
            id="username"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Mật khẩu
          </label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Đang đăng nhập…" : "Đăng nhập"}
        </button>
        <p className="muted">
          Chưa có tài khoản? <Link href="/register">Đăng ký</Link>
        </p>
      </form>
    </main>
  );
}
