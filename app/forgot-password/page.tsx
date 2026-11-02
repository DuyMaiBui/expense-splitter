"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Icon } from "@/components/Icon";
import { api } from "@/lib/api-client";

/**
 * Screen 1 of "quên mật khẩu": ask for a username, then tell the person to check their email.
 *
 * The API always succeeds, so this screen must never claim "no such account" or "no email on
 * file" — that would undo the point of the always-200 response. The wording is deliberately
 * conditional ("nếu tài khoản có email").
 */
export default function ForgotPasswordPage() {
  const [username, setUsername] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api<Record<string, never>>("/api/auth/forgot-password", {
        method: "POST",
        body: { username },
      });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gửi được yêu cầu đặt lại mật khẩu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <div className="card stack">
        <h1 className="row row-nowrap">
          <Icon name="key" size={26} />
          <span>Quên mật khẩu</span>
        </h1>

        {sent ? (
          <>
            <p className="muted">
              Nếu tài khoản <strong>{username}</strong> có địa chỉ email trong hồ sơ, chúng tôi đã
              gửi một mã xác nhận gồm 6 chữ số. Mã chỉ dùng được một lần và hết hạn sau 10 phút.
            </p>
            <p className="muted">
              Không thấy email? Kiểm tra thư rác, hoặc nhờ quản trị viên cập nhật địa chỉ email
              trong hồ sơ của bạn.
            </p>
            <div className="row row-between">
              <Link className="btn btn-ghost" href="/login" prefetch={false}>
                <Icon name="arrowLeft" />
                <span>Đăng nhập</span>
              </Link>
              <Link
                className="btn btn-primary"
                href={`/reset-password?username=${encodeURIComponent(username)}`}
                prefetch={false}
              >
                <Icon name="key" />
                <span>Nhập mã</span>
              </Link>
            </div>
          </>
        ) : (
          <form className="stack" onSubmit={handleSubmit}>
            <p className="muted">
              Nhập tên đăng nhập. Mã xác nhận sẽ được gửi tới địa chỉ email trong hồ sơ của bạn.
            </p>
            <div className="field">
              <Icon name="at" />
              <input
                className="input"
                autoComplete="username"
                autoCapitalize="none"
                maxLength={32}
                placeholder="Tên đăng nhập"
                aria-label="Tên đăng nhập"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            {error && <p className="error">{error}</p>}
            <div className="row row-between">
              <Link className="btn btn-ghost" href="/login" prefetch={false}>
                <Icon name="arrowLeft" />
                <span>Đăng nhập</span>
              </Link>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                <Icon name="key" />
                <span>{busy ? "Đang gửi…" : "Gửi mã"}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
