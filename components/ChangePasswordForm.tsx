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

    if (!/^[0-9]{6,128}$/.test(newPassword)) {
      setError("Mật khẩu mới phải gồm từ 6 đến 128 chữ số.");
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
          Mật khẩu mới (chỉ chữ số)
        </label>
        <div className="field">
          <Icon name="key" />
          <input
            id={`${fieldId}-new`}
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            pattern="[0-9]{6,128}"
            title="Ít nhất 6 chữ số"
            placeholder="Mật khẩu mới"
            aria-label="Mật khẩu mới"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value.replace(/\D/g, ""))}
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
            inputMode="numeric"
            autoComplete="new-password"
            pattern="[0-9]{6,128}"
            placeholder="Nhập lại mật khẩu mới"
            aria-label="Nhập lại mật khẩu mới"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value.replace(/\D/g, ""))}
            required
          />
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <p className="muted">
        Mật khẩu mới chỉ gồm chữ số, ít nhất 6 chữ số. Đổi mật khẩu sẽ đăng xuất các thiết bị
        khác; thiết bị này vẫn đăng nhập.
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
