"use client";

import { useId, useState, type FormEvent } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api, invalidateApiCache } from "@/lib/api-client";
import type { BankInfo, User } from "@/lib/types";
import { VIETQR_BANKS } from "@/lib/vietqr";

const ACCOUNT_NO = /^[0-9]{6,19}$/;

interface ProfileBankFormProps {
  /** The account stored on the profile, if any: the fields start filled in. */
  initial: BankInfo | null;
  /** The saved profile and what happened, so the page can report it without another request. */
  onSaved: (user: User, outcome: "saved" | "cleared") => void;
}

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * The caller's OWN receiving account (a profile setting, never another member's): pick the bank,
 * type the account and its owner. Saves through `PUT /api/profile/bank`, which always acts on the
 * caller's row — there is no id parameter, so a member can never change someone else's account.
 */
export function ProfileBankForm({ initial, onSaved }: ProfileBankFormProps) {
  const fieldId = useId();
  const [bin, setBin] = useState(initial?.bin ?? "");
  const [accountNo, setAccountNo] = useState(initial?.accountNo ?? "");
  const [accountName, setAccountName] = useState(initial?.accountName ?? "");
  const [hasBank, setHasBank] = useState(initial !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A BIN outside VIETQR_BANKS (stored before this form existed) must stay selectable: a plain
  // select would snap it to "" and re-saving could switch banks silently.
  const unknownBin = bin !== "" && !VIETQR_BANKS.some((bank) => bank.bin === bin);

  /**
   * The account is derived onto every member row the group pages cache, and the profile itself is
   * cached, so a successful write drops all of it rather than leaving a stale QR behind.
   */
  function clearCaches(): void {
    invalidateApiCache();
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    const name = accountName.trim();
    if (bin === "") {
      setError("Chọn ngân hàng nhận tiền.");
      return;
    }
    if (!ACCOUNT_NO.test(accountNo)) {
      setError("Số tài khoản phải gồm 6 đến 19 chữ số.");
      return;
    }
    if (name.length === 0 || name.length > 50) {
      setError("Tên chủ tài khoản phải từ 1 đến 50 ký tự.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const data = await api<{ user: User }>("/api/profile/bank", {
        method: "PUT",
        body: { bank: { bin, accountNo, accountName: name } },
      });
      setHasBank(true);
      clearCaches();
      onSaved(data.user, "saved");
    } catch (e) {
      setError(message(e, "Không lưu được tài khoản nhận tiền."));
    } finally {
      setSaving(false);
    }
  }

  async function handleClear(): Promise<void> {
    if (
      !window.confirm(
        "Xóa tài khoản nhận tiền? Mã QR của bạn sẽ không tạo được cho tới khi bạn cài lại.",
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data = await api<{ user: User }>("/api/profile/bank", {
        method: "PUT",
        body: { bank: null },
      });
      setBin("");
      setAccountNo("");
      setAccountName("");
      setHasBank(false);
      clearCaches();
      onSaved(data.user, "cleared");
    } catch (e) {
      setError(message(e, "Không xóa được tài khoản nhận tiền."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <div>
        <label className="label" htmlFor={`${fieldId}-bank`}>
          Ngân hàng
        </label>
        <select
          id={`${fieldId}-bank`}
          className="input"
          value={bin}
          onChange={(e) => setBin(e.target.value)}
          required
        >
          <option value="">Chọn ngân hàng…</option>
          {unknownBin && <option value={bin}>Ngân hàng hiện tại (BIN {bin})</option>}
          {VIETQR_BANKS.map((bank) => (
            <option key={bank.bin} value={bank.bin}>
              {bank.shortName} · {bank.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor={`${fieldId}-account`}>
          Số tài khoản
        </label>
        <div className="field">
          <Icon name="bank" />
          <input
            id={`${fieldId}-account`}
            className="input"
            inputMode="numeric"
            autoComplete="off"
            maxLength={19}
            placeholder="0123456789"
            aria-label="Số tài khoản"
            value={accountNo}
            onChange={(e) => setAccountNo(e.target.value)}
            required
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor={`${fieldId}-name`}>
          Tên chủ tài khoản
        </label>
        <div className="field">
          <Icon name="user" />
          <input
            id={`${fieldId}-name`}
            className="input"
            maxLength={50}
            placeholder="NGUYEN VAN A"
            aria-label="Tên chủ tài khoản"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            required
          />
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="row row-between">
        {hasBank ? (
          <IconButton
            icon="trash"
            label="Xóa tài khoản nhận tiền"
            variant="danger"
            showLabel
            disabled={saving}
            onClick={() => void handleClear()}
          />
        ) : (
          <span />
        )}
        <button className="btn btn-primary" type="submit" disabled={saving}>
          <Icon name="check" />
          <span>{saving ? "Đang lưu…" : "Lưu tài khoản"}</span>
        </button>
      </div>
    </form>
  );
}
