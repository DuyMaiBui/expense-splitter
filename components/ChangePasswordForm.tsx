"use client";

import { useId, useState, type FormEvent } from "react";

import { Icon } from "@/components/Icon";
import { api } from "@/lib/api-client";

/**
 * The signed-in "đổi mật khẩu" form (used on /profile).
 *
 * The server checks the current password and signs every OTHER device out, keeping this one: the
 * copy under the form says so before the person commits, so the sign-out elsewhere is expected
 * rather than a support question.
 */
export function ChangePasswordForm() {
  const fieldId = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (newPassword.length < 6 || newPassword.length > 128) {
      setError("Mật khẩu mới phải có từ 6 đến 128 ký tự.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Mật khẩu mới nhập lại không khớp.");
      return;
    }

    setBusy(true);
    try {
      await api<Record<string, never>>("/api/auth/change-password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đổi được mật khẩu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <div>
        <label className="label" htmlFor={`${fieldId}-current`}>
          Mật khẩu hiện tại
        </label>
        <div className="field">
          <Icon name="lock" />
          <input
            id={`${fieldId}-current`}
            className="input"
            type="password"
            autoComplete="current-password"
            placeholder="Mật khẩu hiện tại"
            aria-label="Mật khẩu hiện tại"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor={`${fieldId}-new`}>
          Mật khẩu mới
        </label>
        <div className="field">
          <Icon name="key" />
          <input
            id={`${fieldId}-new`}
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder="Mật khẩu mới"
            aria-label="Mật khẩu mới"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor={`${fieldId}-confirm`}>
          Nhập lại mật khẩu mới
        </label>
        <div className="field">
          <Icon name="check" />
          <input
            id={`${fieldId}-confirm`}
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder="Nhập lại mật khẩu mới"
            aria-label="Nhập lại mật khẩu mới"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <p className="muted">
        Mật khẩu mới có ít nhất 6 ký tự, tối đa 128 ký tự, gồm chữ, số và ký tự đặc biệt. Đổi mật
        khẩu sẽ đăng xuất các thiết bị khác; thiết bị này vẫn đăng nhập.
      </p>

      <div className="row row-between">
        <span />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          <Icon name="check" />
          <span>{busy ? "Đang lưu…" : "Đổi mật khẩu"}</span>
        </button>
      </div>
    </form>
  );
}
