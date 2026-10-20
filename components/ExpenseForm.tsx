"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import { formatVnd, isoToLocalInput, localInputToIso, parseAmountInput } from "@/lib/format";
import { MAX_QUANTITY, presetAmount } from "@/lib/presets";
import { splitEqual } from "@/lib/split";
import type { Expense, Group, Member, Preset } from "@/lib/types";

interface ExpenseFormProps {
  groupId: string;
  /** Present when editing an existing expense. */
  expenseId?: string;
}

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** Title suggested by a preset: "Quả cầu lông" for one unit, "Quả cầu lông ×3" for more. */
function presetTitle(preset: Preset, quantity: number): string {
  return Number.isInteger(quantity) && quantity > 1 ? `${preset.name} ×${quantity}` : preset.name;
}

/** Add / edit form: type what was spent, tap the payer, tap who shares it. */
export function ExpenseForm({ groupId, expenseId }: ExpenseFormProps) {
  const router = useRouter();
  const listHref = `/groups/${groupId}/expenses`;

  const [members, setMembers] = useState<Member[]>([]);
  const [existing, setExisting] = useState<Expense | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [amountText, setAmountText] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [participants, setParticipants] = useState<Set<string>>(new Set());
  const [spentAt, setSpentAt] = useState(() => isoToLocalInput(new Date().toISOString()));
  const [note, setNote] = useState("");

  // Preset entry is an alternative way to fill the amount, never required.
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [quantityText, setQuantityText] = useState("1");
  // True while the title was filled by a preset, so a later quantity change may rewrite it;
  // typing in the title field turns it off and the user's text is never overwritten.
  const [titleIsAuto, setTitleIsAuto] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        // The group lookup is shared with the nav bar through the client cache.
        const groupData = await api<{ group: Group; members: Member[] }>(`/api/groups/${groupId}`);
        const expense = expenseId
          ? (await api<{ expense: Expense }>(`/api/groups/${groupId}/expenses/${expenseId}`)).expense
          : null;
        // Presets only help; a failure (for example the table not migrated yet) must never
        // stop the form from working, so it degrades to the plain amount field.
        const presetList = await api<{ presets: Preset[] }>(`/api/groups/${groupId}/presets`)
          .then((data) => data.presets)
          .catch(() => [] as Preset[]);
        if (cancelled) {
          return;
        }

        setMembers(groupData.members);
        setPresets(presetList);
        if (expense) {
          setExisting(expense);
          setTitle(expense.title);
          setAmountText(String(expense.amount));
          setPaidBy(expense.paidByMemberId);
          setParticipants(new Set(expense.shares.map((s) => s.memberId)));
          setSpentAt(isoToLocalInput(expense.spentAt));
          setNote(expense.note ?? "");
        } else {
          // The admin account has no member row: default the payer to the first active member.
          setPaidBy(
            groupData.group.myMemberId ||
              groupData.members.find((m) => m.removedAt === null)?.id ||
              "",
          );
          setParticipants(
            new Set(groupData.members.filter((m) => m.removedAt === null).map((m) => m.id)),
          );
        }
        setReady(true);
      } catch (e) {
        if (!cancelled) {
          setLoadError(message(e, "Không tải được dữ liệu."));
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [groupId, expenseId]);

  // Active members, plus removed ones that are already part of the expense being edited.
  const selectable = useMemo(() => {
    const keep = new Set<string>();
    if (existing) {
      keep.add(existing.paidByMemberId);
      existing.shares.forEach((s) => keep.add(s.memberId));
    }
    return members.filter((m) => m.removedAt === null || keep.has(m.id));
  }, [members, existing]);

  const amount = parseAmountInput(amountText);

  const selectedPreset = presets.find((p) => p.id === presetId) ?? null;
  const quantity = /^\d+$/.test(quantityText) ? Number(quantityText) : Number.NaN;

  /** Applies a preset x quantity to the amount (and to an auto-filled or empty title). */
  function applyPreset(preset: Preset, quantityInput: string): void {
    const qty = /^\d+$/.test(quantityInput) ? Number(quantityInput) : Number.NaN;
    const total = presetAmount(preset.unitPrice, qty);
    if (!Number.isFinite(total)) {
      return; // half-typed or out-of-range quantity: leave the amount alone
    }
    setAmountText(String(total));
    if (titleIsAuto || title.trim() === "") {
      setTitle(presetTitle(preset, qty));
      setTitleIsAuto(true);
    }
  }

  function handlePresetPick(preset: Preset): void {
    if (presetId === preset.id) {
      setPresetId(null); // tap again to go back to typing the amount
      return;
    }
    setPresetId(preset.id);
    applyPreset(preset, quantityText);
  }

  function handleQuantityChange(next: string): void {
    setQuantityText(next);
    if (selectedPreset) {
      applyPreset(selectedPreset, next);
    }
  }

  const preview = useMemo(() => {
    if (!Number.isFinite(amount) || amount < 1 || participants.size === 0) {
      return [];
    }
    return splitEqual(amount, [...participants]);
  }, [amount, participants]);

  function toggle(memberId: string): void {
    setParticipants((current) => {
      const next = new Set(current);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!Number.isFinite(amount) || amount < 1) {
      setError("Số tiền phải là số nguyên dương.");
      return;
    }
    if (participants.size === 0) {
      setError("Chọn ít nhất một người để chia.");
      return;
    }

    setSaving(true);
    try {
      const body = {
        title,
        amount,
        paidByMemberId: paidBy,
        participantMemberIds: [...participants],
        spentAt: localInputToIso(spentAt) || undefined,
        note: note.trim() === "" ? null : note,
      };
      await api(
        expenseId
          ? `/api/groups/${groupId}/expenses/${expenseId}`
          : `/api/groups/${groupId}/expenses`,
        { method: expenseId ? "PUT" : "POST", body },
      );
      router.push(listHref);
    } catch (e) {
      setError(message(e, "Không lưu được chi tiêu."));
      setSaving(false);
    }
  }

  if (loadError) {
    return <p className="error">{loadError}</p>;
  }
  if (!ready) {
    return <div className="spinner" role="status" aria-label="Đang tải" />;
  }

  return (
    <form className="card stack" onSubmit={handleSubmit}>
      <div>
        <label className="label" htmlFor="title">
          Chi tiêu gì?
        </label>
        <div className="field">
          <Icon name="receipt" />
          <input
            id="title"
            className="input"
            maxLength={100}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleIsAuto(false);
            }}
            placeholder="Ăn trưa, tiền xăng…"
            required
          />
        </div>
      </div>

      <div className="stack">
        <div className="row row-between row-nowrap">
          <span className="label meta">
            <Icon name="tag" size={18} />
            Chọn mục mẫu (không bắt buộc)
          </span>
          <Link className="btn btn-ghost" href={`/groups/${groupId}/presets`} prefetch={false}>
            <span>{presets.length === 0 ? "Tạo mục mẫu" : "Quản lý"}</span>
          </Link>
        </div>
        {presets.length > 0 && (
          <div className="row" role="group" aria-label="Mục mẫu">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="chip"
                aria-pressed={presetId === preset.id}
                onClick={() => handlePresetPick(preset)}
                title={`${preset.name}: ${formatVnd(preset.unitPrice)} / đơn vị`}
              >
                {preset.name} · {formatVnd(preset.unitPrice)}
              </button>
            ))}
          </div>
        )}
        {selectedPreset && (
          <div className="stack">
            <div className="row row-nowrap">
              <label className="label" htmlFor="quantity">
                Số lượng
              </label>
              <div className="field" style={{ maxWidth: 140 }}>
                <Icon name="plus" />
                <input
                  id="quantity"
                  className="input"
                  inputMode="numeric"
                  value={quantityText}
                  onChange={(e) => handleQuantityChange(e.target.value)}
                  aria-describedby="quantity-total"
                />
              </div>
            </div>
            {/* On its own line: beside the field this wraps mid-figure on a phone. */}
            <span id="quantity-total" className="meta">
              {Number.isFinite(presetAmount(selectedPreset.unitPrice, quantity))
                ? `${formatVnd(selectedPreset.unitPrice)} × ${quantity} = ${formatVnd(
                    presetAmount(selectedPreset.unitPrice, quantity),
                  )}`
                : `Nhập số nguyên từ 1 đến ${MAX_QUANTITY}`}
            </span>
          </div>
        )}
      </div>

      <div>
        <label className="label" htmlFor="amount">
          Số tiền (đ)
        </label>
        <div className="field">
          <Icon name="coins" />
          <input
            id="amount"
            className="input"
            inputMode="numeric"
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value);
              setPresetId(null); // typed by hand: the amount no longer follows a preset
            }}
            placeholder="120000"
            required
          />
        </div>
      </div>

      <div className="stack">
        <span className="label meta">
          <Icon name="wallet" size={18} />
          Ai trả?
        </span>
        <div className="row" role="radiogroup" aria-label="Ai trả">
          {selectable.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              className="chip"
              aria-checked={paidBy === m.id}
              aria-pressed={paidBy === m.id}
              onClick={() => setPaidBy(m.id)}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>

      <div className="stack">
        <div className="row row-between row-nowrap">
          <span className="label meta">
            <Icon name="users" size={18} />
            Chia cho ai? ({participants.size})
          </span>
          <div className="row row-nowrap">
            <IconButton
              icon="check"
              label="Tất cả"
              variant="ghost"
              showLabel
              onClick={() =>
                setParticipants(new Set(selectable.filter((m) => !m.removedAt).map((m) => m.id)))
              }
            />
            <IconButton
              icon="x"
              label="Bỏ chọn"
              variant="ghost"
              showLabel
              onClick={() => setParticipants(new Set())}
            />
          </div>
        </div>
        <div className="row" role="group" aria-label="Chia cho ai">
          {selectable.map((m) => (
            <button
              key={m.id}
              type="button"
              className="chip"
              aria-pressed={participants.has(m.id)}
              onClick={() => toggle(m.id)}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>

      {preview.length > 0 && (
        <div className="meta">
          <Icon name="scale" size={16} />
          {/* Every participant pays the same figure up to 1đ (the split rule gives the first
              `amount mod n` people base+1), so the per-person amounts are not repeated here. */}
          <span>
            {amount % preview.length === 0
              ? `Chia đều ${preview.length} người · mỗi người ${formatVnd(amount / preview.length)}`
              : `Chia đều ${preview.length} người · mỗi người ≈ ${formatVnd(
                  Math.floor(amount / preview.length),
                )} (dư ${formatVnd(amount % preview.length)})`}
          </span>
        </div>
      )}

      <div>
        <label className="label" htmlFor="spent-at">
          Thời gian
        </label>
        <div className="field">
          <Icon name="clock" />
          <input
            id="spent-at"
            className="input"
            type="datetime-local"
            value={spentAt}
            onChange={(e) => setSpentAt(e.target.value)}
            required
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="note">
          Ghi chú (không bắt buộc)
        </label>
        <div className="field">
          <Icon name="note" />
          <input
            id="note"
            className="input"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="row row-between">
        <IconButton icon="x" label="Hủy" showLabel onClick={() => router.push(listHref)} />
        <button className="btn btn-primary" type="submit" disabled={saving}>
          <Icon name="check" />
          <span>{saving ? "Đang lưu…" : expenseId ? "Lưu thay đổi" : "Thêm chi tiêu"}</span>
        </button>
      </div>
    </form>
  );
}
