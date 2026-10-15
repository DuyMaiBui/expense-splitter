"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

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

/** Add / edit form: type what was spent, pick the payer and who shares it. */
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
    return <p className="muted">Đang tải…</p>;
  }

  return (
    <form className="card stack" onSubmit={handleSubmit}>
      <div>
        <label className="label" htmlFor="title">
          Chi tiêu gì?
        </label>
        <input
          id="title"
          className="input"
          maxLength={100}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ăn trưa, tiền xăng…"
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="amount">
          Số tiền (đ)
        </label>
        <input
          id="amount"
          className="input"
          inputMode="numeric"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          placeholder="120000"
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="paid-by">
          Ai trả?
        </label>
        <select id="paid-by" className="input" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
          {selectable.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.removedAt ? " (đã xóa)" : ""}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">Chia cho ai?</legend>
        <div className="row">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setParticipants(new Set(selectable.filter((m) => !m.removedAt).map((m) => m.id)))}
          >
            Chọn tất cả
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setParticipants(new Set())}>
            Bỏ chọn
          </button>
        </div>
        {selectable.map((m) => (
          <label key={m.id} className="row" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={participants.has(m.id)}
              onChange={() => toggle(m.id)}
            />
            <span>
              {m.name}
              {m.removedAt ? " (đã xóa)" : ""}
            </span>
          </label>
        ))}
      </fieldset>

      {preview.length > 0 && (
        <div className="muted">
          Mỗi người:{" "}
          {preview.map((s) => `${nameOf(s.memberId)} ${formatVnd(s.amount)}`).join(" · ")}
        </div>
      )}

      <div>
        <label className="label" htmlFor="spent-at">
          Thời gian
        </label>
        <input
          id="spent-at"
          className="input"
          type="datetime-local"
          value={spentAt}
          onChange={(e) => setSpentAt(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="note">
          Ghi chú (không bắt buộc)
        </label>
        <input
          id="note"
          className="input"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error && <p className="error">{error}</p>}

      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? "Đang lưu…" : expenseId ? "Lưu thay đổi" : "Thêm chi tiêu"}
        </button>
        <button className="btn" type="button" onClick={() => router.push(listHref)}>
          Hủy
        </button>
      </div>
    </form>
  );
}
