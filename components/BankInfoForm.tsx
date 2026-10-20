"use client";

import { useId, useState, type FormEvent } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import type { BankInfo, Member } from "@/lib/types";
import { VIETQR_BANKS } from "@/lib/vietqr";

const ACCOUNT_NO = /^[0-9]{6,19}$/;

interface BankInfoFormProps {
  groupId: string;
  memberId: string;
  /** The stored account, if any: the fields start filled in. */
  initial: BankInfo | null;
  /** Receives the saved member, so the caller can render its summary or QR at once. */
  onSaved: (member: Member) => void;
  /** Omitted when the form cannot be dismissed (there is no other way to get a QR). */
  onCancel?: () => void;
  submitLabel?: string;
}

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** Bank account of a member: pick the bank, type the account and its owner. */
export function BankInfoForm({
  groupId,
  memberId,
  initial,
  onSaved,
  onCancel,
  submitLabel = "Lưu",
}: BankInfoFormProps) {
  const fieldId = useId();
  const [bin, setBin] = useState(initial?.bin ?? "");
  const [accountNo, setAccountNo] = useState(initial?.accountNo ?? "");
  const [accountName, setAccountName] = useState(initial?.accountName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A BIN outside VIETQR_BANKS (typed into the API before this form existed) must stay
  // selectable: a plain select would snap it to "" and re-saving could switch banks silently.
  const unknownBin = bin !== "" && !VIETQR_BANKS.some((bank) => bank.bin === bin);

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
      const data = await api<{ member: Member }>(
        `/api/groups/${groupId}/members/${memberId}`,
        { method: "PATCH", body: { bank: { bin, accountNo, accountName: name } } },
      );
      onSaved(data.member);
    } catch (e) {
      setError(message(e, "Không lưu được tài khoản ngân hàng."));
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
        {onCancel ? (
          <IconButton icon="x" label="Hủy" showLabel disabled={saving} onClick={onCancel} />
        ) : (
          <span />
        )}
        <button className="btn btn-primary" type="submit" disabled={saving}>
          <Icon name="check" />
          <span>{saving ? "Đang lưu…" : submitLabel}</span>
        </button>
      </div>
    </form>
  );
}
