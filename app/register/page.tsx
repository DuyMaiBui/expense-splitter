"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

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
        <h1>Đăng ký</h1>
        <div>
          <label className="label" htmlFor="username">
            Tên đăng nhập
          </label>
          <input
            id="username"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9_.]+"
            title="Chữ, số, dấu gạch dưới và dấu chấm"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <p className="muted">3-32 ký tự: chữ, số, _ và .</p>
        </div>
        <div>
          <label className="label" htmlFor="displayName">
            Tên hiển thị
          </label>
          <input
            id="displayName"
            className="input"
            maxLength={50}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
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
            autoComplete="new-password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <p className="muted">Ít nhất 6 ký tự.</p>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Đang tạo tài khoản…" : "Đăng ký"}
        </button>
        <p className="muted">
          Đã có tài khoản? <Link href="/login">Đăng nhập</Link>
        </p>
      </form>
    </main>
  );
}
