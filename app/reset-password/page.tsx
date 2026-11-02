"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

import { Icon } from "@/components/Icon";
import { api } from "@/lib/api-client";

/**
 * Screen 2 of "quên mật khẩu": username + the 6-digit code from the email + the new password.
 *
 * The username is prefilled from `?username=` when screen 1 sends it along, so the common path is
 * one field less to mistype. The new password is digits only — the rule is stated on screen
 * before the request rather than after a 400.
 */
function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState(params.get("username") ?? "");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!/^[0-9]{6}$/.test(code)) {
      setError("Mã xác nhận phải gồm đúng 6 chữ số.");
      return;
    }
    if (!/^[0-9]{6,128}$/.test(newPassword)) {
      setError("Mật khẩu mới phải gồm từ 6 đến 128 chữ số.");
      return;
    }

    setBusy(true);
    try {
      await api<Record<string, never>>("/api/auth/reset-password", {
        method: "POST",
        body: { username, code, newPassword },
      });
      // Every session of the account is gone after a reset: sign in with the new password.
      router.replace("/login?reset=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Đặt lại mật khẩu không thành công.");
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <h1 className="row row-nowrap">
        <Icon name="key" size={26} />
        <span>Đặt lại mật khẩu</span>
      </h1>

      <form className="stack" onSubmit={handleSubmit}>
        <p className="muted">
          Nhập tên đăng nhập, mã 6 chữ số trong email và mật khẩu mới (chỉ gồm chữ số).
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

        <div className="field">
          <Icon name="shield" />
          <input
            className="input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="Mã xác nhận (6 chữ số)"
            aria-label="Mã xác nhận"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            required
          />
        </div>

        <div className="field">
          <Icon name="lock" />
          <input
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            pattern="[0-9]{6,128}"
            title="Ít nhất 6 chữ số"
            placeholder="Mật khẩu mới (chỉ chữ số)"
            aria-label="Mật khẩu mới"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value.replace(/\D/g, ""))}
            required
          />
        </div>

        {error && <p className="error">{error}</p>}

        <div className="row row-between">
          <Link className="btn btn-ghost" href="/forgot-password" prefetch={false}>
            <Icon name="refresh" />
            <span>Gửi lại mã</span>
          </Link>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            <Icon name="check" />
            <span>{busy ? "Đang lưu…" : "Đổi mật khẩu"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="container">
      {/* useSearchParams needs a Suspense boundary in the App Router. */}
      <Suspense fallback={<div className="spinner" role="status" aria-label="Đang tải" />}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
