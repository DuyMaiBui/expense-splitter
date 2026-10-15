"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import { formatVnd, isoToLocalInput, localInputToIso } from "@/lib/format";
import { splitEqual } from "@/lib/split";
import type { Expense, Group, Member } from "@/lib/types";

interface ExpenseFormProps {
  groupId: string;
  /** Present when editing an existing expense. */
  expenseId?: string;
}

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** "120.000", "120,000" or "120000" → 120000; anything else → NaN. */
function parseAmount(text: string): number {
  const digits = text.replace(/[.,\s]/g, "");
  return /^\d+$/.test(digits) ? Number(digits) : Number.NaN;
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
        if (cancelled) {
          return;
        }

        setMembers(groupData.members);
        if (expense) {
          setExisting(expense);
          setTitle(expense.title);
          setAmountText(String(expense.amount));
          setPaidBy(expense.paidByMemberId);
          setParticipants(new Set(expense.shares.map((s) => s.memberId)));
          setSpentAt(isoToLocalInput(expense.spentAt));
          setNote(expense.note ?? "");
        } else {
          setPaidBy(groupData.group.myMemberId);
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

  const amount = parseAmount(amountText);
  const preview = useMemo(() => {
    if (!Number.isFinite(amount) || amount < 1 || participants.size === 0) {
      return [];
    }
    return splitEqual(amount, [...participants]);
  }, [amount, participants]);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "?";

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
      <div className="field">
        <Icon name="receipt" />
        <input
          className="input"
          maxLength={100}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ăn trưa, tiền xăng…"
          aria-label="Chi tiêu gì"
          required
        />
      </div>

      <div className="field">
        <Icon name="coins" />
        <input
          className="input"
          inputMode="numeric"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          placeholder="120000"
          aria-label="Số tiền (đồng)"
          required
        />
      </div>

      <div className="stack">
        <span className="meta" title="Ai trả">
          <Icon name="wallet" size={18} />
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
          <span className="meta" title="Chia cho ai">
            <Icon name="users" size={18} />
            {participants.size}
          </span>
          <span className="row row-nowrap">
            <IconButton
              icon="check"
              label="Chọn tất cả"
              variant="ghost"
              onClick={() =>
                setParticipants(new Set(selectable.filter((m) => !m.removedAt).map((m) => m.id)))
              }
            />
            <IconButton icon="x" label="Bỏ chọn" variant="ghost" onClick={() => setParticipants(new Set())} />
          </span>
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
        <div className="meta" title="Mỗi người">
          <Icon name="scale" size={16} />
          {preview.map((s) => `${nameOf(s.memberId)} ${formatVnd(s.amount)}`).join(" · ")}
        </div>
      )}

      <div className="field">
        <Icon name="clock" />
        <input
          className="input"
          type="datetime-local"
          value={spentAt}
          onChange={(e) => setSpentAt(e.target.value)}
          aria-label="Thời gian"
          required
        />
      </div>

      <div className="field">
        <Icon name="note" />
        <input
          className="input"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ghi chú"
          aria-label="Ghi chú (không bắt buộc)"
        />
      </div>

      {error && <p className="error">{error}</p>}

      <div className="row row-between">
        <IconButton icon="x" label="Hủy" onClick={() => router.push(listHref)} />
        <button
          className="btn btn-icon btn-primary"
          type="submit"
          disabled={saving}
          aria-label={expenseId ? "Lưu thay đổi" : "Thêm chi tiêu"}
          title={expenseId ? "Lưu thay đổi" : "Thêm chi tiêu"}
        >
          <Icon name="check" />
        </button>
      </div>
    </form>
  );
}
