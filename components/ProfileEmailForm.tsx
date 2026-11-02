"use client";

import { useId, useState, type FormEvent } from "react";

import { Icon } from "@/components/Icon";
import { invalidateApiCache, api } from "@/lib/api-client";
import type { User } from "@/lib/types";

interface ProfileEmailFormProps {
  /** The address stored on the profile, if any: the field starts filled in. */
  initial: string | null;
  /** The saved profile and what happened, so the page can report it without another request. */
  onSaved: (user: User, outcome: "saved" | "cleared") => void;
}

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * The caller's OWN recovery email (a profile setting, never another member's). Saves through
 * `PUT /api/profile/email`, which always acts on the caller's row — there is no id parameter, so
 * nobody can point a password reset at an address they do not control.
 *
 * The server is the authority on the address format (`lib/validate.ts#parseEmail`); this form
 * only refuses to send an obvious blank so the common mistake costs no request.
 */
export function ProfileEmailForm({ initial, onSaved }: ProfileEmailFormProps) {
  const fieldId = useId();
  const [email, setEmail] = useState(initial ?? "");
  const [hasEmail, setHasEmail] = useState(initial !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    const value = email.trim();
    if (value.length === 0) {
      setError("Nhập địa chỉ email khôi phục.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const data = await api<{ user: User }>("/api/profile/email", {
        method: "PUT",
        body: { email: value },
      });
      // The server returns the normalised address: show what was actually stored.
      setEmail(data.user.email ?? value);
      setHasEmail(data.user.email !== null);
      invalidateApiCache();
      onSaved(data.user, "saved");
    } catch (e) {
      setError(message(e, "Không lưu được địa chỉ email."));
    } finally {
      setSaving(false);
    }
  }

  async function handleClear(): Promise<void> {
    if (
      !window.confirm("Xóa địa chỉ email? Bạn sẽ không đặt lại được mật khẩu bằng email.")
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data = await api<{ user: User }>("/api/profile/email", {
        method: "PUT",
        body: { email: null },
      });
      setEmail("");
      setHasEmail(false);
      invalidateApiCache();
      onSaved(data.user, "cleared");
    } catch (e) {
      setError(message(e, "Không xóa được địa chỉ email."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <div>
        <label className="label" htmlFor={`${fieldId}-email`}>
          Địa chỉ email
        </label>
        <div className="field">
          <Icon name="at" />
          <input
            id={`${fieldId}-email`}
            className="input"
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={254}
            placeholder="ban@example.com"
            aria-label="Địa chỉ email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="row row-between">
        {hasEmail ? (
          <button
            className="btn btn-ghost"
            type="button"
            disabled={saving}
            onClick={() => void handleClear()}
          >
            <Icon name="trash" />
            <span>Xóa email</span>
          </button>
        ) : (
          <span />
        )}
        <button className="btn btn-primary" type="submit" disabled={saving}>
          <Icon name="check" />
          <span>{saving ? "Đang lưu…" : "Lưu email"}</span>
        </button>
      </div>
    </form>
  );
}
